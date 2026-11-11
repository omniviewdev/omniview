package resource

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func demandFieldRelationships(_ context.Context, _ resourcev2.AccessRoute, typ string) ([]resourcev2.RelationshipDescriptor, error) {
	if typ != "native::Pod" {
		return nil, nil
	}
	return []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelUses, TargetType: "native::Peer", TargetScope: []resourcev2.ScopeEntry{}, Label: "uses", Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "name"}}}, nil
}

type demandRelatedResult struct {
	edges []graph.GraphEdge
	err   error
}

func demandRelated(ctx context.Context, service *GraphService, root graph.GraphNode, direction string) <-chan demandRelatedResult {
	done := make(chan demandRelatedResult, 1)
	go func() {
		result, err := service.GetRelated(ctx, graph.RelatedRequest{PluginID: root.PluginID, Reference: root.Reference, Route: root.Route, Direction: direction})
		done <- demandRelatedResult{edges: result.Edges, err: err}
	}()
	return done
}

func demandRelatedDone(t *testing.T, done <-chan demandRelatedResult) []graph.GraphEdge {
	t.Helper()
	select {
	case result := <-done:
		require.NoError(t, result.err)
		return result.edges
	case <-time.After(5 * time.Second):
		t.Fatal("finite graph did not settle")
		return nil
	}
}

func demandRecord(t *testing.T, target resourcev2.ReadTarget, id, name string) resourcev2.Record {
	t.Helper()
	record := sourceTestRecord(target, id, "incarnation/"+id)
	record.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"name": {Kind: "string", String: name}}}
	return record
}

func demandSnapshot(open scriptedSourceOpen, record resourcev2.Record) {
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
}

func TestIntegrationDemandFieldPathDoesNotAcquireTargetInventory(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = demandFieldRelationships
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := demandRecord(t, target.Target, "pod", "worker/one")
	service := NewGraphService(ctrl, nil, nil)
	done := demandRelated(testInvocationContext(), service, graph.GraphNode{PluginID: "p1", Reference: record.Reference, Route: target.Target.Route}, "outgoing")
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	require.Equal(t, "native::Pod", open.request.Target.Type)
	demandSnapshot(open, record)
	edges := demandRelatedDone(t, done)
	require.Len(t, edges, 1)
	require.Equal(t, record.Reference, edges[0].Source.Reference)
	require.Equal(t, "worker/one", edges[0].Target.Reference.Address.ID)
	peer := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Peer")
	require.Equal(t, peer.Target.Authority, edges[0].Target.Reference.Address.Authority)
	require.NotEqual(t, target.Target.Authority, peer.Target.Authority)
	require.Nil(t, edges[0].Target.Reference.Incarnation, "field reference must not invent observed existence")
	require.Empty(t, provider.opens, "field citation must not acquire target inventory")
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("finite completion retained source")
	}
}

func TestIntegrationDemandIncomingAcquiresDeclaringPopulationOnly(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = demandFieldRelationships
	registerMockPlugin(ctrl, "p1", provider)
	peer := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Peer")
	root := sourceTestRecord(peer.Target, "worker", "").Reference
	service := NewGraphService(ctrl, nil, nil)
	done := demandRelated(testInvocationContext(), service, graph.GraphNode{PluginID: "p1", Reference: root, Route: peer.Target.Route}, "incoming")
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	require.Equal(t, "native::Pod", open.request.Target.Type)
	record := demandRecord(t, open.request.Target, "pod", "worker")
	demandSnapshot(open, record)
	edges := demandRelatedDone(t, done)
	require.Len(t, edges, 1)
	require.Equal(t, record.Reference, edges[0].Source.Reference)
	require.Equal(t, root, edges[0].Target.Reference)
	require.Empty(t, provider.opens)
}

func TestIntegrationDemandOwnershipReversesDeclaringEdge(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = func(ctx context.Context, route resourcev2.AccessRoute, typ string) ([]resourcev2.RelationshipDescriptor, error) {
		declarations, err := demandFieldRelationships(ctx, route, typ)
		for i := range declarations {
			declarations[i].Direction = resourcev2.EdgeIncoming
			declarations[i].Type = resourcev2.RelOwns
		}
		return declarations, err
	}
	registerMockPlugin(ctrl, "p1", provider)
	peer := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Peer")
	root := sourceTestRecord(peer.Target, "parent", "").Reference
	done := demandRelated(testInvocationContext(), NewGraphService(ctrl, nil, nil), graph.GraphNode{PluginID: "p1", Reference: root, Route: peer.Target.Route}, "outgoing")
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	record := demandRecord(t, open.request.Target, "child", "parent")
	demandSnapshot(open, record)
	edges := demandRelatedDone(t, done)
	require.Len(t, edges, 1)
	require.Equal(t, resourcev2.RelOwns, edges[0].Type)
	require.Equal(t, root, edges[0].Source.Reference)
	require.Equal(t, record.Reference, edges[0].Target.Reference)
	require.Empty(t, provider.opens)
}

func TestIntegrationDemandFiniteCancellationReleasesNativeWorkAndPools(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = demandFieldRelationships
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := demandRecord(t, target.Target, "pod", "peer")
	ctx, cancel := context.WithCancel(testInvocationContext())
	done := demandRelated(ctx, NewGraphService(ctrl, nil, nil), graph.GraphNode{PluginID: "p1", Reference: record.Reference, Route: target.Target.Route}, "outgoing")
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	cancel()
	select {
	case result := <-done:
		require.Error(t, result.err)
		require.Nil(t, result.edges)
	case <-time.After(time.Second):
		t.Fatal("finite cancellation did not return")
	}
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("finite cancellation retained provider work")
	}
	require.Zero(t, ctrl.graphRetained.used)
	require.Zero(t, ctrl.graphScratch.used)
	require.Zero(t, ctrl.graphMetadata.used)
	require.Zero(t, ctrl.graphResults.used)
}

func TestIntegrationDemandBlockedDeclarationsCannotPublishAfterReset(t *testing.T) {
	ctrl, events := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	var calls atomic.Int32
	provider.GetRelationshipsFunc = func(ctx context.Context, route resourcev2.AccessRoute, typ string) ([]resourcev2.RelationshipDescriptor, error) {
		declarations, err := demandFieldRelationships(ctx, route, typ)
		if typ == "native::Pod" {
			if calls.Add(1) == 1 {
				close(entered)
				select {
				case <-release:
				case <-ctx.Done():
					return nil, ctx.Err()
				}
				declarations[0].Label = "old"
			} else {
				declarations[0].Label = "new"
			}
		}
		return declarations, err
	}
	registerMockPlugin(ctrl, "p1", provider)
	old := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	oldRecord := demandRecord(t, old.Target, "pod", "peer")
	service := NewGraphService(ctrl, nil, nil)
	oldDone := demandRelated(testInvocationContext(), service, graph.GraphNode{PluginID: "p1", Reference: oldRecord.Reference, Route: old.Target.Route}, "outgoing")
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("declaration barrier not reached")
	}
	require.NoError(t, ctrl.invalidateProfileRoutes("p1", []string{"conn-1"}))
	current := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	view := sourceTestOpen(t, ctrl, current)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID)
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	record := demandRecord(t, current.Target, "pod", "peer")
	demandSnapshot(open, record)
	waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == "following"
	})
	related, err := service.GetRelated(testInvocationContext(), graph.RelatedRequest{PluginID: "p1", Reference: record.Reference, Route: current.Target.Route, Direction: "outgoing"})
	edges := related.Edges
	require.NoError(t, err)
	require.Len(t, edges, 1)
	require.Equal(t, "new", edges[0].Label)
	once.Do(func() { close(release) })
	select {
	case old := <-oldDone:
		require.Error(t, old.err)
		require.Nil(t, old.edges)
	case <-time.After(time.Second):
		t.Fatal("retired declaration call did not return")
	}
	related, err = service.GetRelated(testInvocationContext(), graph.RelatedRequest{PluginID: "p1", Reference: record.Reference, Route: current.Target.Route, Direction: "outgoing"})
	edges = related.Edges
	require.NoError(t, err)
	require.Len(t, edges, 1)
	require.Equal(t, "new", edges[0].Label)
}

func TestIntegrationDemandTwoOwnersReleaseIndependently(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = demandFieldRelationships
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := demandRecord(t, target.Target, "pod", "peer")
	service := NewGraphService(ctrl, nil, nil)
	owners := []context.Context{invocation.NewScope(invocation.TrustedUI).Context(context.Background()), invocation.NewScope(invocation.TrustedUI).Context(context.Background())}
	snapshots := []chan HostGraphObservationSnapshot{make(chan HostGraphObservationSnapshot, 16), make(chan HostGraphObservationSnapshot, 16)}
	opened := make([]HostGraphObservationOpened, 2)
	for i := range owners {
		index := i
		request := HostGraphObservationRequest{ClientToken: uuid.NewString(), PluginID: "p1", Reference: record.Reference, Route: target.Target.Route, Kind: "related", Direction: "outgoing"}
		var err error
		opened[i], err = service.openObservation(owners[i], context.Background(), request, func(snapshot HostGraphObservationSnapshot) { snapshots[index] <- snapshot })
		require.NoError(t, err)
		t.Cleanup(func() { _ = service.closeObservation(owners[index], opened[index].ObservationID) })
		require.NoError(t, service.syncObservation(owners[i], opened[i].ObservationID))
	}
	opens := []scriptedSourceOpen{sourceNextOpen(t, provider.scriptedSourceProvider), sourceNextOpen(t, provider.scriptedSourceProvider)}
	for _, open := range opens {
		demandSnapshot(open, record)
	}
	for _, updates := range snapshots {
		for {
			select {
			case snapshot := <-updates:
				if snapshot.State == "ready" {
					require.Len(t, snapshot.Edges, 1)
					goto ready
				}
			case <-time.After(5 * time.Second):
				t.Fatal("graph owner did not become ready")
			}
		}
	ready:
	}
	require.NoError(t, service.closeObservation(owners[0], opened[0].ObservationID))
	var remaining *scriptedSourceStream
	closed := 0
	for _, open := range opens {
		select {
		case <-open.stream.closed:
			closed++
		default:
			remaining = open.stream
		}
	}
	require.Equal(t, 1, closed)
	require.NotNil(t, remaining)
	updated := demandRecord(t, target.Target, "pod", "updated-peer")
	sourceSend(remaining, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(updated)}}}}})
	for {
		select {
		case snapshot := <-snapshots[1]:
			if snapshot.State == "ready" && len(snapshot.Edges) == 1 && snapshot.Edges[0].Target.Reference.Address.ID == "updated-peer" {
				return
			}
		case <-time.After(5 * time.Second):
			t.Fatal("remaining graph owner lost live population")
		}
	}
}

func TestIntegrationDemandIncomingSameTypeDoesNotNarrowDeclaringScope(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	catalog, err := provider.CatalogFunc(context.Background(), resourcev2.CatalogRequest{})
	require.NoError(t, err)
	catalog.Types = catalog.Types[:1]
	catalog.Types[0].IdentityDimensions = []resourcev2.Dimension{{Name: "namespace"}}
	catalog.Types[0].QueryDimensions = []resourcev2.Dimension{{Name: "namespace"}}
	for i := range catalog.Types[0].Capabilities {
		catalog.Types[0].Capabilities[i].Scope = resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}}
	}
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }
	provider.GetRelationshipsFunc = func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.RelationshipDescriptor, error) {
		return []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelUses, TargetType: "native::Pod", ScopeExtractors: []resourcev2.ScopeExtractor{{Dimension: "namespace", FieldPath: "targetNamespace"}}, Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "target"}}}, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	target, err := ctrl.ResolveTarget(testInvocationContext(), "p1", ResolveTargetRequest{Route: resourcev2.AccessRoute{Connection: "conn-1"}, Type: "native::Pod", Representation: "native", Scope: resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}}})
	require.NoError(t, err)
	root := sourceTestRecord(target.Target, "root", "").Reference
	root.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "wanted"}}
	done := demandRelated(testInvocationContext(), NewGraphService(ctrl, nil, nil), graph.GraphNode{PluginID: "p1", Reference: root, Route: target.Target.Route}, "incoming")
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	require.Equal(t, resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}}, open.request.Target.Scope)
	foreign := sourceTestRecord(open.request.Target, "foreign-source", "foreign-incarnation")
	foreign.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "elsewhere"}}
	foreign.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"target": {Kind: "string", String: "root"}, "targetNamespace": {Kind: "string", String: "wanted"}}}
	demandSnapshot(open, foreign)
	edges := demandRelatedDone(t, done)
	require.Len(t, edges, 1)
	require.Equal(t, foreign.Reference, edges[0].Source.Reference)
	require.Equal(t, root, edges[0].Target.Reference)
}

func TestIntegrationDemandRejectsReplacedRootIncarnation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = demandFieldRelationships
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := demandRecord(t, target.Target, "pod", "peer")
	old := record.Reference
	oldToken := "retired-incarnation"
	old.Incarnation = &oldToken
	done := demandRelated(testInvocationContext(), NewGraphService(ctrl, nil, nil), graph.GraphNode{PluginID: "p1", Reference: old, Route: target.Target.Route}, "outgoing")
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	demandSnapshot(open, record)
	select {
	case result := <-done:
		require.Error(t, result.err)
		require.Nil(t, result.edges)
	case <-time.After(5 * time.Second):
		t.Fatal("stale root incarnation did not settle")
	}
}

func TestIntegrationDemandSelectorAcquiresMappedCandidateScope(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	catalog, err := provider.CatalogFunc(context.Background(), resourcev2.CatalogRequest{})
	require.NoError(t, err)
	for i := range catalog.Types {
		catalog.Types[i].IdentityDimensions = []resourcev2.Dimension{{Name: "namespace"}}
		catalog.Types[i].QueryDimensions = []resourcev2.Dimension{{Name: "namespace"}}
		for j := range catalog.Types[i].Capabilities {
			catalog.Types[i].Capabilities[j].Scope = resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeAny}}
		}
	}
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }
	provider.GetRelationshipsFunc = func(_ context.Context, _ resourcev2.AccessRoute, typ string) ([]resourcev2.RelationshipDescriptor, error) {
		if typ != "native::Pod" {
			return nil, nil
		}
		return []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelUses, TargetType: "native::Peer", ScopeExtractors: []resourcev2.ScopeExtractor{{Dimension: "namespace", FieldPath: "candidateNamespace"}}, Extractor: &resourcev2.RelationshipExtractor{Method: "labelSelector", FieldPath: "selector"}}}, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	selected := []string{"selected"}
	target, err := ctrl.ResolveTarget(testInvocationContext(), "p1", ResolveTargetRequest{Route: resourcev2.AccessRoute{Connection: "conn-1"}, Type: "native::Pod", Representation: "native", Scope: resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeOneOf, Values: &selected}}})
	require.NoError(t, err)
	record := sourceTestRecord(target.Target, "pod", "pod-incarnation")
	record.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "selected"}}
	record.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"candidateNamespace": {Kind: "string", String: "candidates"}, "selector": {Kind: "map", Map: map[string]resourcev2.Value{"app": {Kind: "string", String: "web"}}}}}
	done := demandRelated(testInvocationContext(), NewGraphService(ctrl, nil, nil), graph.GraphNode{PluginID: "p1", Reference: record.Reference, Route: target.Target.Route}, "outgoing")
	source := sourceNextOpen(t, provider.scriptedSourceProvider)
	require.Equal(t, target.Target.Scope, source.request.Target.Scope)
	demandSnapshot(source, record)
	candidates := sourceNextOpen(t, provider.scriptedSourceProvider)
	wanted := []string{"candidates"}
	require.Equal(t, "native::Peer", candidates.request.Target.Type)
	require.Equal(t, resourcev2.QueryScope{{Dimension: "namespace", Match: resourcev2.ScopeOneOf, Values: &wanted}}, candidates.request.Target.Scope)
	peer := sourceTestRecord(candidates.request.Target, "peer", "peer-incarnation")
	peer.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "candidates"}}
	sourceSend(candidates.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(peer), Metadata: &resourcev2.ResourceMetadata{Labels: map[string]string{"app": "web"}}}}}})
	sourceSend(candidates.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	edges := demandRelatedDone(t, done)
	require.Len(t, edges, 1)
	require.Equal(t, peer.Reference, edges[0].Target.Reference)
	require.Empty(t, provider.opens)
}

func TestIntegrationDemandBoundedRelatedPreservesCompleteNative20KCorpus(t *testing.T) {
	for _, scenario := range []struct {
		name     string
		limit    int
		deny     bool
		wantCode string
	}{
		{name: "bounded", limit: 1000},
		{name: "whole", wantCode: "RESOURCE_LIMIT"},
		{name: "deniedOmittedCitation", limit: 1000, deny: true, wantCode: "FORBIDDEN"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			provider := demandOwnershipTestProvider()
			provider.GetRelationshipsFunc = demandFieldRelationships
			registerMockPlugin(ctrl, "p1", provider)
			peer := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Peer")
			root := sourceTestRecord(peer.Target, "worker", "").Reference
			boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
				if scenario.deny && operation == "graph.GetRelated" && target.Object == "pod-19999" {
					return resourcev2.NewError("FORBIDDEN", "omitted citation denied")
				}
				return nil
			}))
			ctrl.boundary = boundary
			service := NewGraphService(ctrl, nil, boundary)
			type result struct {
				related graph.RelatedResult
				err     error
			}
			done := make(chan result, 1)
			go func() {
				related, err := service.GetRelated(testInvocationContext(), graph.RelatedRequest{PluginID: "p1", Reference: root, Route: peer.Target.Route, Direction: "incoming", Limit: scenario.limit})
				done <- result{related, err}
			}()
			open := sourceNextOpen(t, provider.scriptedSourceProvider)
			require.Equal(t, "native::Pod", open.request.Target.Type)
			for start := 0; start < 20000; start += 16 {
				observations := make([]resourcev2.SourceObservation, 0, 16)
				for id := start; id < start+16; id++ {
					record := demandRecord(t, open.request.Target, fmt.Sprintf("pod-%05d", id), "worker")
					observations = append(observations, resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)})
				}
				sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: observations}})
			}
			sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
			select {
			case outcome := <-done:
				if scenario.wantCode != "" {
					require.Error(t, outcome.err)
					require.Equal(t, scenario.wantCode, requireAppError(t, outcome.err).Code)
					require.Empty(t, outcome.related.Edges)
				} else {
					require.NoError(t, outcome.err)
					require.Len(t, outcome.related.Edges, 1000)
					require.True(t, outcome.related.Truncated)
					for _, edge := range outcome.related.Edges {
						require.Equal(t, root.Address, edge.Target.Reference.Address)
					}
				}
			case <-time.After(30 * time.Second):
				t.Fatal("complete native 20k graph query did not settle")
			}
			require.Empty(t, provider.opens, "field relationships must not acquire target inventory")
			select {
			case <-open.stream.closed:
			case <-time.After(time.Second):
				t.Fatal("finite graph retained native work")
			}
		})
	}
}
