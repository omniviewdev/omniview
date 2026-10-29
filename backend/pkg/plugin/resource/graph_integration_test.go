package resource

import (
	"context"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func newGraphPipeline(t *testing.T) (*engineWatchSink, *controller, *graph.RelationshipGraph, *indexer.Dispatcher) {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := canonicalTestCatalog("provider-a", "workload")
	catalog.Types[0].IdentityDimensions = []resourcev2.Dimension{{Name: "shard", AllowEmpty: false}}
	owner := catalog.Types[0]
	owner.Type = "owner"
	machine := canonicalTestCatalog("provider-a", "machine").Types[0]
	catalog.Types = append(catalog.Types, owner, machine)
	registerMockPlugin(ctrl, "plugin-a", &mockProvider{CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }})
	dispatcher := indexer.NewDispatcher([]indexer.ResourceIndexer{graph.NewGraphIndexer(ctrl.graph, ctrl.registryStore)})
	dispatcher.Start()
	t.Cleanup(dispatcher.Stop)
	ctrl.dispatcher = dispatcher
	ctx, cancel := context.WithCancel(invocation.HostContext(context.Background()))
	t.Cleanup(cancel)
	return &engineWatchSink{ctx: ctx, generationID: ctrl.plugins["plugin-a"].generationID, pluginID: "plugin-a", ctrl: ctrl, store: ctrl.registryStore, dispatcher: dispatcher}, ctrl, ctrl.graph, dispatcher
}

func graphPipelineRecord(t *testing.T, ctrl *controller, resourceType, id, body string) (resourcev2.AccessRoute, resourcev2.Record) {
	t.Helper()
	target := admittedReadTarget(t, ctrl, "plugin-a", "route/one", resourceType).Target
	record := canonicalTestRecord(target.Provider, target.Authority, resourceType, id)
	if resourceType != "machine" {
		record.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "shard", Value: "west"}}
	}
	value, err := resourcev2.JSONToValue([]byte(body))
	require.NoError(t, err)
	record.Body = value
	return target.Route, record
}

func setPipelineDeclarations(t *testing.T, ctrl *controller, g *graph.RelationshipGraph, plugin string, route resourcev2.AccessRoute, sourceType string, decls []resourcev2.RelationshipDescriptor) {
	t.Helper()
	source := admittedReadTarget(t, ctrl, plugin, route.Connection, sourceType).Target
	bindings := graph.DeclarationBindings{Source: graph.TargetBinding{Target: source, IdentityDimensions: []resourcev2.Dimension{{Name: "shard"}}}}
	for _, decl := range decls {
		target := admittedReadTarget(t, ctrl, plugin, route.Connection, decl.TargetType).Target
		var dimensions []resourcev2.Dimension
		if decl.TargetType == "owner" {
			dimensions = []resourcev2.Dimension{{Name: "shard"}}
		}
		bindings.Targets = append(bindings.Targets, graph.TargetBinding{Target: target, IdentityDimensions: dimensions})
	}
	require.NoError(t, g.SetBoundDeclarations(plugin, route, sourceType, decls, bindings))
}

func TestIntegration_WatchEventToGraphQuery(t *testing.T) {
	sink, ctrl, g, dispatcher := newGraphPipeline(t)
	setPipelineDeclarations(t, ctrl, g, "plugin-a", resourcev2.AccessRoute{Connection: "route/one"}, "workload", []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelRunsOn, TargetType: "machine", Label: "runs on", TargetScope: []resourcev2.ScopeEntry{}, Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "machine"}}})
	route, record := graphPipelineRecord(t, ctrl, "workload", "object/one", `{"machine":"worker/one"}`)
	sink.OnAdd(resourcev2.WatchAddPayload{Route: route, Record: record})
	dispatcher.Flush()
	entry, ok := ctrl.registryStore.Get("plugin-a", record.Reference, route)
	require.True(t, ok)
	node := graph.GraphNode{PluginID: "plugin-a", Reference: entry.Reference, Route: entry.Route}
	edges, err := g.GetRelated(node, graph.Outgoing, nil)
	require.NoError(t, err)
	require.Len(t, edges, 1)
	require.Equal(t, "worker/one", edges[0].Target.Reference.Address.ID)
	require.Equal(t, admittedReadTarget(t, ctrl, "plugin-a", route.Connection, "machine").Target.Authority, edges[0].Target.Reference.Address.Authority)
	sink.OnDelete(resourcev2.WatchDeletePayload{Route: route, Reference: record.Reference})
	dispatcher.Flush()
	_, ok = ctrl.registryStore.Get("plugin-a", record.Reference, route)
	require.False(t, ok)
	edges, err = g.GetRelated(node, graph.Outgoing, nil)
	require.NoError(t, err)
	require.Empty(t, edges)
}

func TestIntegration_OwnershipChain(t *testing.T) {
	sink, ctrl, g, dispatcher := newGraphPipeline(t)
	setPipelineDeclarations(t, ctrl, g, "plugin-a", resourcev2.AccessRoute{Connection: "route/one"}, "workload", []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelOwns, TargetType: "owner", Label: "owned by", Direction: resourcev2.EdgeIncoming, ScopeExtractors: []resourcev2.ScopeExtractor{{Dimension: "shard", FieldPath: "placement"}}, Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "owner"}}})
	route, record := graphPipelineRecord(t, ctrl, "workload", "child", `{"placement":"west","owner":"parent"}`)
	sink.OnAdd(resourcev2.WatchAddPayload{Route: route, Record: record})
	dispatcher.Flush()
	parent := record.Reference
	parent.Address.Type = "owner"
	parent.Address.Authority = admittedReadTarget(t, ctrl, "plugin-a", route.Connection, "owner").Target.Authority
	parent.Address.ID = "parent"
	edges, err := g.GetRelated(graph.GraphNode{PluginID: "plugin-a", Reference: parent, Route: route}, graph.Outgoing, nil)
	require.NoError(t, err)
	require.Len(t, edges, 1)
	require.Equal(t, resourcev2.RelOwns, edges[0].Type)
	require.Equal(t, record.Reference, edges[0].Target.Reference)
}

func TestIntegration_ClusterScopedTarget(t *testing.T) {
	sink, ctrl, g, dispatcher := newGraphPipeline(t)
	setPipelineDeclarations(t, ctrl, g, "plugin-a", resourcev2.AccessRoute{Connection: "route/one"}, "workload", []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelUses, TargetType: "machine", TargetScope: []resourcev2.ScopeEntry{}, Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "volume"}}})
	route, record := graphPipelineRecord(t, ctrl, "workload", "claim", `{"volume":"disk"}`)
	sink.OnAdd(resourcev2.WatchAddPayload{Route: route, Record: record})
	dispatcher.Flush()
	edges := g.EdgesFrom((graph.GraphNode{PluginID: "plugin-a", Reference: record.Reference, Route: route}).Key())
	require.Len(t, edges, 1)
	require.Empty(t, edges[0].Target.Reference.Address.Scope)
	require.Equal(t, "disk", edges[0].Target.Reference.Address.ID)
}

func TestIntegration_ConnectionTeardown(t *testing.T) {
	sink, ctrl, g, dispatcher := newGraphPipeline(t)
	setPipelineDeclarations(t, ctrl, g, "plugin-a", resourcev2.AccessRoute{Connection: "route/one"}, "workload", []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelRunsOn, TargetType: "machine", Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "machine"}}})
	var first resourcev2.ResourceReference
	for _, id := range []string{"one", "two", "three"} {
		route, record := graphPipelineRecord(t, ctrl, "workload", id, `{"machine":"worker"}`)
		if id == "one" {
			first = record.Reference
		}
		sink.OnAdd(resourcev2.WatchAddPayload{Route: route, Record: record})
	}
	dispatcher.Flush()
	require.Len(t, ctrl.registryStore.ScanByResourceKey("plugin-a", "route/one", "workload"), 3)
	removed := ctrl.registryStore.DeleteByConnection("plugin-a", "route/one")
	for _, entry := range removed {
		dispatcher.Enqueue(indexer.Event{Type: indexer.EventDelete, Entry: entry})
	}
	g.RemoveEdgesForConnection("plugin-a", "route/one")
	dispatcher.Flush()
	require.Empty(t, ctrl.registryStore.ScanByResourceKey("plugin-a", "route/one", "workload"))
	require.Empty(t, g.EdgesFrom((graph.GraphNode{PluginID: "plugin-a", Reference: first, Route: resourcev2.AccessRoute{Connection: "route/one"}}).Key()))
}
