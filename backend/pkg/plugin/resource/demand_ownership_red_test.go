package resource

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// This fixture exposes relationships and sources independently. Neither support
// advertisement requests connection-owned acquisition.
type demandOwnershipRelationshipProvider struct {
	*scriptedSourceProvider
}

func (p *demandOwnershipRelationshipProvider) Features(context.Context) (resourcev2.FeatureSet, error) {
	return resourcev2.FeatureSet{Traits: []resourcev2.Feature{resourcev2.FeatureConnections, resourcev2.FeatureSourceSessions, resourcev2.FeatureRelationships}}, nil
}

func demandOwnershipTestProvider() *demandOwnershipRelationshipProvider {
	return &demandOwnershipRelationshipProvider{scriptedSourceProvider: &scriptedSourceProvider{
		mockProvider: &mockProvider{
			CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
				catalog := canonicalTestCatalog("p1", "native::Pod")
				catalog.Types = append(catalog.Types, canonicalTestCatalog("p1", "native::Peer").Types[0])
				for i := range catalog.Types {
					catalog.Types[i].DefaultRepresentation = "native"
					catalog.Types[i].Capabilities = append(catalog.Types[i].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
				}
				return catalog, nil
			},
			StartConnectionFunc: func(_ context.Context, id string) (types.ConnectionStatus, error) {
				return types.ConnectionStatus{Connection: &types.Connection{ID: id}, Status: types.ConnectionStatusConnected}, nil
			},
		},
		opens: make(chan scriptedSourceOpen, 16),
	}}
}

func TestDemandOwnershipConnectionDoesNotWaitForUnrequestedRelationships(t *testing.T) {
	ctrl, events := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	var declarationCalls atomic.Int32
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	provider.GetRelationshipsFunc = func(ctx context.Context, _ resourcev2.AccessRoute, _ string) ([]resourcev2.RelationshipDescriptor, error) {
		declarationCalls.Add(1)
		select {
		case <-release:
			return nil, resourcev2.NewError("UNAVAILABLE", "optional relationship service unavailable")
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	registerMockPlugin(ctrl, "p1", provider)
	type startResult struct {
		status types.ConnectionStatus
		err    error
	}
	done := make(chan startResult, 1)
	go func() {
		status, err := ctrl.StartConnection(testInvocationContext(), "p1", "conn-1")
		done <- startResult{status: status, err: err}
	}()

	var started startResult
	select {
	case started = <-done:
	case <-time.After(5 * time.Second):
		t.Error("connection readiness waited for an unrequested relationship service")
		unblock()
		select {
		case started = <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("connection did not finish after releasing optional relationship work")
		}
	}
	require.NoError(t, started.err)
	require.Equal(t, types.ConnectionStatusConnected, started.status.Status)
	require.Len(t, events.EventsWithKey(EventConnectionStatus), 1)
	assert.Zero(t, declarationCalls.Load(), "support discovery must not acquire relationship declarations without a graph consumer")
	states, err := ctrl.GetSourceStates(testInvocationContext(), "p1", resourcev2.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
	assert.Empty(t, states.Types, "an idle connection must not own inventory")
	assert.Empty(t, provider.opens, "an idle connection must not open a provider source")

	// A demanded collection must still be readable, complete, shared, and live.
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	first := sourceTestOpen(t, ctrl, target)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", first.ViewID)
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	require.Equal(t, "native::Pod", open.request.Target.Type)
	second := sourceTestOpen(t, ctrl, target)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", second.ViewID)
	assert.Empty(t, provider.opens, "compatible views must share the selected acquisition")
	record := sourceTestRecord(target.Target, "pod", "pod-incarnation")
	record.Body, err = resourcev2.JSONToValue([]byte(`{"name":"pod","spec":{"containers":[{"name":"app","image":"example/app:1"}]}}`))
	require.NoError(t, err)
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	for _, view := range []HostSourceViewOpened{first, second} {
		snapshot := waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
			return event.Kind == "snapshot" && len(event.Records) == 1
		})
		require.Equal(t, record, snapshot.Records[0].Record)
		boundary := waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
			return event.Kind == "snapshotEnd" && event.ViewGeneration == snapshot.ViewGeneration && event.Status != nil && event.Status.State == "following"
		})
		require.NotNil(t, boundary.Status.Coverage)
		require.Equal(t, resourcev2.EnumerationExhausted, boundary.Status.Coverage.Enumeration)
	}
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", first.ViewID))
	select {
	case <-open.stream.closed:
		t.Fatal("closing one view stopped another view's acquisition")
	default:
	}
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", second.ViewID))
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("final consumer close did not stop the selected source")
	}
	assert.Empty(t, provider.opens, "reading Pods must not acquire unrelated Peer inventory")
	assert.Zero(t, declarationCalls.Load(), "ordinary collection reads must not request relationship enrichment")
}

// Exhaust actual graph extraction scratch while publishing a large selected
// source. Optional pressure must fail graph only, never block selected commit.
func TestDemandOwnershipSaturatedOptionalIndexDoesNotBlockSelectedSnapshot(t *testing.T) {
	ctrl, events := newTestControllerWithEmitter(t)
	relationshipProvider := demandOwnershipTestProvider()
	relationshipProvider.GetRelationshipsFunc = demandFieldRelationships
	registerMockPlugin(ctrl, "p1", relationshipProvider)
	provider := relationshipProvider.scriptedSourceProvider
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	view := sourceTestOpen(t, ctrl, target)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID)
	open := sourceNextOpen(t, provider)
	service := NewGraphService(ctrl, nil, nil)
	root := sourceTestRecord(target.Target, "pod-0", "")
	ctx, err := service.admit(testInvocationContext(), "graph.GetRelated", "p1", root.Reference, target.Target.Route)
	require.NoError(t, err)
	demand, err := service.newDemand(ctx, HostGraphObservationRequest{PluginID: "p1", Reference: root.Reference, Route: target.Target.Route, Kind: "related", Direction: "outgoing"})
	require.NoError(t, err)
	require.True(t, demand.scratch.reserveLimit(maxGraphAggregateScratchBytes, maxGraphAggregateScratchBytes))
	defer func() { demand.scratch.release(maxGraphAggregateScratchBytes); demand.close() }()
	graphDone := make(chan error, 1)
	go func() { _, err := demand.evaluate(ctx); graphDone <- err }()

	// Preserve the real large membership and full-body delivery control.
	const records = 10_002
	for offset := 0; offset < records; offset += defaultSourceMaxBatchItems {
		batch := make([]resourcev2.SourceObservation, 0, defaultSourceMaxBatchItems)
		for id := offset; id < min(offset+defaultSourceMaxBatchItems, records); id++ {
			record := sourceTestRecord(target.Target, fmt.Sprintf("pod-%d", id), "")
			batch = append(batch, resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)})
		}
		sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: batch}})
	}
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))

	boundary := waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == "following"
	})
	require.NotNil(t, boundary.Status.Coverage)
	require.Equal(t, resourcev2.EnumerationExhausted, boundary.Status.Coverage.Enumeration)
	delivered := 0
	for _, emitted := range events.EventsWithKey(view.Topic) {
		if len(emitted.Data) == 1 {
			if event, ok := emitted.Data[0].(HostSourceViewEvent); ok && event.Kind == "snapshot" {
				delivered += len(event.Records)
			}
		}
	}
	require.Equal(t, records, delivered, "optional index pressure must not truncate selected data")
	select {
	case err := <-graphDone:
		require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	case <-time.After(5 * time.Second):
		t.Fatal("saturated graph did not fail independently")
	}
}

func TestDemandOwnershipGraphRejectsUnobservedAndPartialCandidateInventory(t *testing.T) {
	ctrl, events := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = func(_ context.Context, _ resourcev2.AccessRoute, resourceType string) ([]resourcev2.RelationshipDescriptor, error) {
		if resourceType != "native::Pod" {
			return nil, nil
		}
		return []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelUses, TargetType: "native::Peer", TargetScope: []resourcev2.ScopeEntry{}, Label: "selects", Extractor: &resourcev2.RelationshipExtractor{Method: "labelSelector", FieldPath: "spec.selector"}}}, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	_, err := ctrl.StartConnection(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	view := sourceTestOpen(t, ctrl, target)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID)
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	record := sourceTestRecord(target.Target, "pod", "")
	record.Body, err = resourcev2.JSONToValue([]byte(`{"spec":{"selector":{"app":"web"}}}`))
	require.NoError(t, err)
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	snapshot := waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshot" && len(event.Records) == 1
	})
	require.Equal(t, record, snapshot.Records[0].Record)
	boundary := waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.ViewGeneration == snapshot.ViewGeneration && event.Status != nil && event.Status.State == "following"
	})
	require.NotNil(t, boundary.Status.Coverage)
	require.Equal(t, resourcev2.EnumerationExhausted, boundary.Status.Coverage.Enumeration)
	service := NewGraphService(ctrl, nil, nil)
	query := func(t *testing.T, unknown bool) {
		t.Helper()
		ctx, cancel := context.WithTimeout(testInvocationContext(), 5*time.Second)
		defer cancel()
		done := make(chan demandRelatedResult, 1)
		go func() {
			result, err := service.GetRelated(ctx, graph.RelatedRequest{PluginID: "p1", Reference: record.Reference, Route: target.Target.Route, Direction: "outgoing"})
			done <- demandRelatedResult{edges: result.Edges, err: err}
		}()
		if unknown {
			select {
			case candidate := <-provider.opens:
				require.Equal(t, "native::Peer", candidate.request.Target.Type)
				cancel()
			case result := <-done:
				assert.Error(t, result.err, "unobserved population cannot produce a complete empty result")
				assert.Nil(t, result.edges)
				return
			case <-ctx.Done():
				t.Fatal("graph did not acquire its candidate population")
			}
		}
		select {
		case result := <-done:
			assert.Error(t, result.err, "a selector without complete candidate inventory cannot produce a complete empty result")
			assert.Nil(t, result.edges, "incomplete graph reads must not return partial whole results")
		case <-time.After(5 * time.Second):
			t.Fatal("incomplete finite graph did not settle")
		}
	}
	t.Run("unobservedCandidates", func(t *testing.T) { query(t, true) })

	peerTarget := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Peer")
	peerView := sourceTestOpen(t, ctrl, peerTarget)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", peerView.ViewID)
	partial := sourceNextOpen(t, provider.scriptedSourceProvider)
	sourceSend(partial.stream, sourceBoundary(resourcev2.EnumerationPartial))
	partialEnd := waitSourceView(t, events, peerView.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == "following"
	})
	require.NotNil(t, partialEnd.Status.Coverage)
	require.Equal(t, resourcev2.EnumerationPartial, partialEnd.Status.Coverage.Enumeration)
	t.Run("partialCandidates", func(t *testing.T) { query(t, false) })

	// Completing the real candidate population must restore useful graph data;
	// rejecting every graph read is not an acceptable way to satisfy this test.
	t.Run("completeCandidates", func(t *testing.T) {
		require.NoError(t, ctrl.RefreshSourceView(testInvocationContext(), "p1", peerView.ViewID))
		complete := sourceNextOpen(t, provider.scriptedSourceProvider)
		peer := sourceTestRecord(peerTarget.Target, "matching-peer", "peer-incarnation")
		sourceSend(complete.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(peer), Metadata: &resourcev2.ResourceMetadata{Labels: map[string]string{"app": "web"}}}}}})
		sourceSend(complete.stream, sourceBoundary(resourcev2.EnumerationExhausted))
		// Refresh can replay the old committed partial snapshot in a new view
		// generation. That replay does not prove the replacement source committed.
		population := waitSourceView(t, events, peerView.Topic, func(event HostSourceViewEvent) bool {
			return event.Kind == "snapshot" && event.ViewGeneration != partialEnd.ViewGeneration && len(event.Records) == 1
		})
		require.Equal(t, peer, population.Records[0].Record)
		completed := waitSourceView(t, events, peerView.Topic, func(event HostSourceViewEvent) bool {
			return event.Kind == "snapshotEnd" && event.ViewGeneration == population.ViewGeneration && event.Status != nil && event.Status.State == "following"
		})
		require.NotNil(t, completed.Status.Coverage)
		require.Equal(t, resourcev2.EnumerationExhausted, completed.Status.Coverage.Enumeration)
		result, err := service.GetRelated(testInvocationContext(), graph.RelatedRequest{PluginID: "p1", Reference: record.Reference, Route: target.Target.Route, Direction: "outgoing"})
		edges := result.Edges
		require.NoError(t, err)
		require.Len(t, edges, 1)
		require.Equal(t, record.Reference, edges[0].Source.Reference)
		require.Equal(t, target.Target.Route, edges[0].Source.Route)
		require.Equal(t, peer.Reference, edges[0].Target.Reference)
		require.Equal(t, peerTarget.Target.Route, edges[0].Target.Route)
		require.Equal(t, resourcev2.RelUses, edges[0].Type)
		require.Equal(t, "selects", edges[0].Label)
	})
}
