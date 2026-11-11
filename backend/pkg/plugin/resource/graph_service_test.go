package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func graphTestNode(plugin, connection, resourceType, namespace, id string) graph.GraphNode {
	scope := []resourcev2.ScopeEntry{}
	if namespace != "" {
		scope = append(scope, resourcev2.ScopeEntry{Dimension: "namespace", Value: namespace})
	}
	return graph.GraphNode{PluginID: plugin, Route: resourcev2.AccessRoute{Connection: connection}, Reference: resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: plugin, Authority: "authority:" + connection, Type: resourceType, Scope: scope, ID: id}}}
}

func validateGraphTestReference(_ context.Context, plugin string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) error {
	if err := resourcev2.ValidateAddress(reference.Address); err != nil {
		return err
	}
	if reference.Address.Provider != plugin || reference.Address.Authority != "authority:"+route.Connection {
		return resourcev2.NewError("INVALID_REQUEST", "route authority mismatch")
	}
	return nil
}

func TestGraphServiceRendersAdmittedProjectionShapes(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	service := NewGraphService(ctrl, nil, nil)
	service.validateReference = validateGraphTestReference
	g := graph.NewRelationshipGraph()
	defer g.Close()
	root := graphTestNode("k8s", "c1", "pod", "default", "nginx")
	target := graphTestNode("k8s", "c1", "node", "", "worker")
	g.AddEdge(graph.GraphEdge{Source: root, Target: target, Type: resourcev2.RelRunsOn, Label: "runs on"})
	for _, kind := range []string{"related", "chain", "tree", "subgraph"} {
		t.Run(kind, func(t *testing.T) {
			typ := string(resourcev2.RelRunsOn)
			request := HostGraphObservationRequest{PluginID: root.PluginID, Route: root.Route, Reference: root.Reference, Kind: kind, Direction: "outgoing", RelationshipType: &typ, MaxDepth: 2, UpDepth: 2, DownDepth: 2}
			result, err := service.graphResult(testInvocationContext(), g, request, 0)
			require.NoError(t, err)
			switch kind {
			case "related":
				require.Len(t, result.Edges, 1)
			case "chain":
				require.Len(t, result.Chain[0], 1)
			case "tree":
				require.Len(t, result.Tree.Children, 1)
			case "subgraph":
				require.Len(t, result.Subgraph.Edges, 1)
			}
		})
	}
}

func newGraphPeerFixture(t *testing.T) (*controller, *graph.RelationshipGraph, graph.GraphNode, graph.GraphNode, *resourcev2.Catalog) {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	sourceCatalog := canonicalTestCatalog("source-provider", "source/type")
	peerCatalog := canonicalTestCatalog("peer-provider", "peer/type")
	registerMockPlugin(ctrl, "source-plugin", &mockProvider{CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		return sourceCatalog, nil
	}})
	registerMockPlugin(ctrl, "peer-plugin", &mockProvider{CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return peerCatalog, nil }})
	sourceRequest := admittedGetRequest(t, ctrl, "source-plugin", "source-route", "source/type", "source-id").Request
	peerRequest := admittedGetRequest(t, ctrl, "peer-plugin", "peer-route", "peer/type", "peer-id").Request
	source := graph.GraphNode{PluginID: "source-plugin", Route: sourceRequest.Route, Reference: sourceRequest.Reference}
	peer := graph.GraphNode{PluginID: "peer-plugin", Route: peerRequest.Route, Reference: peerRequest.Reference}
	g := graph.NewRelationshipGraph()
	t.Cleanup(g.Close)
	g.AddEdge(graph.GraphEdge{Source: source, Target: peer, Type: resourcev2.RelUses, Label: "uses peer"})
	return ctrl, g, source, peer, &peerCatalog
}

func graphPeerRequest(root graph.GraphNode, kind string) HostGraphObservationRequest {
	typ := string(resourcev2.RelUses)
	return HostGraphObservationRequest{PluginID: root.PluginID, Route: root.Route, Reference: root.Reference, Kind: kind, Direction: "both", RelationshipType: &typ, MaxDepth: 2, UpDepth: 2, DownDepth: 2}
}

func TestGraphServicePeerDenialRejectsWholeResult(t *testing.T) {
	for _, kind := range []string{"related", "chain", "tree", "subgraph"} {
		t.Run(kind, func(t *testing.T) {
			ctrl, g, root, peer, _ := newGraphPeerFixture(t)
			denied := false
			boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
				if target.Provider == peer.PluginID && target.Connection == peer.Route.Connection && target.ResourceType == peer.Reference.Address.Type {
					denied = true
					return errors.New("peer denied")
				}
				return nil
			}))
			service := NewGraphService(ctrl, nil, boundary)
			result, err := service.graphResult(testInvocationContext(), g, graphPeerRequest(root, kind), 0)
			require.Error(t, err)
			require.Empty(t, result.State)
			require.True(t, denied)
		})
	}
}

func TestGraphServiceStalePeerRejectsWholeResultWithoutRewritingCitation(t *testing.T) {
	for _, change := range []string{"type", "authority"} {
		for _, kind := range []string{"related", "chain", "tree", "subgraph"} {
			t.Run(change+"/"+kind, func(t *testing.T) {
				ctrl, g, root, peer, catalog := newGraphPeerFixture(t)
				if change == "type" {
					catalog.Types = canonicalTestCatalog(catalog.Provider, "replacement/type").Types
				} else {
					catalog.Provider = "replacement-provider"
				}
				catalog.Revision = "replacement-cohort"
				service := NewGraphService(ctrl, nil, nil)
				result, err := service.graphResult(testInvocationContext(), g, graphPeerRequest(root, kind), 0)
				require.Error(t, err)
				require.Empty(t, result.State)
				cached := g.EdgesFrom(root.Key())
				require.Len(t, cached, 1)
				require.Equal(t, peer.Reference, cached[0].Target.Reference)
			})
		}
	}
}

func TestGraphServiceCurrentPeerRetainsIndependentCitation(t *testing.T) {
	ctrl, g, root, peer, _ := newGraphPeerFixture(t)
	service := NewGraphService(ctrl, nil, nil)
	validations := 0
	service.validateReference = func(ctx context.Context, plugin string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) error {
		if plugin == peer.PluginID {
			validations++
			require.Equal(t, peer.Route, route)
			require.Equal(t, peer.Reference, ref)
		}
		return ctrl.ValidateReference(ctx, plugin, route, ref)
	}
	result, err := service.graphResult(testInvocationContext(), g, graphPeerRequest(root, "subgraph"), 0)
	require.NoError(t, err)
	require.Equal(t, 1, validations)
	require.Equal(t, peer.Reference, result.Subgraph.Edges[0].Target.Reference)
}

func TestGraphServiceExtractionFailureRejectsEveryShape(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	service := NewGraphService(ctrl, nil, nil)
	service.validateReference = validateGraphTestReference
	g := graph.NewRelationshipGraph()
	defer g.Close()
	root := graphTestNode("provider", "route", "source", "", "one")
	g.RecordDeclarationError(root.PluginID, root.Route, root.Reference.Address.Type, errors.New("target binding missing"))
	for _, kind := range []string{"related", "chain", "tree", "subgraph"} {
		result, err := service.graphResult(testInvocationContext(), g, graphPeerRequest(root, kind), 0)
		require.Error(t, err)
		require.Empty(t, result.State)
	}
}

func TestGraphServiceRequiresCurrentRouteValidator(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	service := NewGraphService(ctrl, nil, nil)
	service.validateReference = nil
	root := graphTestNode("provider", "route", "source", "", "one")
	result, err := service.GetRelated(testInvocationContext(), graph.RelatedRequest{PluginID: root.PluginID, Reference: root.Reference, Route: root.Route, Direction: "outgoing"})
	require.Error(t, err)
	require.Empty(t, result.Edges)
}
