package resource

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestGraphObservationCloseBeforeOpenCannotResurrectDemand(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	root := sourceTestRecord(target.Target, "pod", "")
	service := NewGraphService(ctrl, nil, nil)
	token := uuid.NewString()
	require.NoError(t, service.closeObservation(testInvocationContext(), token))
	_, err := service.openObservation(testInvocationContext(), context.Background(), HostGraphObservationRequest{ClientToken: token, PluginID: "p1", Route: target.Target.Route, Reference: root.Reference, Kind: "related", Direction: "outgoing"}, func(HostGraphObservationSnapshot) {})
	require.Error(t, err)
	require.Empty(t, provider.opens)
}

func TestGraphDemandPopulationUsesOriginalOperationAndRejectsDeniedScope(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = func(_ context.Context, _ resourcev2.AccessRoute, typ string) ([]resourcev2.RelationshipDescriptor, error) {
		if typ != "native::Pod" {
			return nil, nil
		}
		return []resourcev2.RelationshipDescriptor{{Type: resourcev2.RelUses, TargetType: "native::Peer", Extractor: &resourcev2.RelationshipExtractor{Method: "labelSelector", FieldPath: "spec.selector"}}}, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := sourceTestRecord(target.Target, "pod", "")
	original := invocation.NewScope(invocation.TrustedUI)
	seen := false
	boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(p invocation.Principal, operation string, target invocation.Target) error {
		require.Equal(t, original.Principal(), p)
		require.NotEqual(t, "resource.OpenSourceView", operation)
		if target.ResourceType == "native::Peer" {
			seen = true
			require.Equal(t, "graph.GetRelated", operation)
			return errors.New("peer denied")
		}
		return nil
	}))
	ctrl.boundary = boundary
	service := NewGraphService(ctrl, nil, boundary)
	result, err := service.GetRelated(original.Context(context.Background()), graph.RelatedRequest{PluginID: "p1", Reference: record.Reference, Route: target.Target.Route, Direction: "outgoing"})
	require.Error(t, err)
	require.Empty(t, result.Edges)
	require.True(t, seen)
	require.Empty(t, provider.opens, "denied plan must not start any populations")
}

func TestGraphObservationRetainsSelectedSourceUntilIndependentClose(t *testing.T) {
	ctrl, events := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = demandFieldRelationships
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	view := sourceTestOpen(t, ctrl, target)
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	record := sourceTestRecord(target.Target, "pod", "incarnation")
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == "following"
	})
	service := NewGraphService(ctrl, nil, nil)
	life, cancel := context.WithCancel(context.Background())
	defer cancel()
	snapshots := make(chan HostGraphObservationSnapshot, 16)
	request := HostGraphObservationRequest{ClientToken: uuid.NewString(), PluginID: "p1", Route: target.Target.Route, Reference: record.Reference, Kind: "related", Direction: "outgoing"}
	observation, err := service.openObservation(testInvocationContext(), life, request, func(snapshot HostGraphObservationSnapshot) { snapshots <- snapshot })
	require.NoError(t, err)
	require.NoError(t, service.syncObservation(testInvocationContext(), observation.ObservationID))
	for {
		select {
		case snapshot := <-snapshots:
			if snapshot.State == "ready" {
				goto ready
			}
		case <-time.After(5 * time.Second):
			t.Fatal("graph observation did not reach complete boundary")
		}
	}
ready:
	require.Empty(t, provider.opens, "same-owner exact graph population must share selected source")
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
	select {
	case <-open.stream.closed:
		t.Fatal("view close stopped graph-owned population")
	default:
	}
	require.NoError(t, service.closeObservation(testInvocationContext(), observation.ObservationID))
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("final graph close did not stop source")
	}
}

func TestGraphDemandAggregateRetentionPressureFailsOnlyGraph(t *testing.T) {
	ctrl, events := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = demandFieldRelationships
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	view := sourceTestOpen(t, ctrl, target)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID)
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	record := sourceTestRecord(target.Target, "pod", "")
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == "following"
	})
	require.True(t, ctrl.graphRetained.reserve(maxGraphAggregateRetainedBytes))
	service := NewGraphService(ctrl, nil, nil)
	result, err := service.GetRelated(testInvocationContext(), graph.RelatedRequest{PluginID: "p1", Reference: record.Reference, Route: target.Target.Route, Direction: "outgoing"})
	require.Error(t, err)
	require.Empty(t, result.Edges)
	ctrl.graphRetained.release(maxGraphAggregateRetainedBytes)
	sourceSend(open.stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(sourceTestRecord(target.Target, "next", ""))}}}}})
	waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "changes" && len(event.Upserts) == 1 })
}

func TestSourceInterestSharingUsesSelectedOperationalContract(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	catalog, err := provider.CatalogFunc(context.Background(), resourcev2.CatalogRequest{})
	require.NoError(t, err)
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	first := sourceTestOpen(t, ctrl, target)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", first.ViewID)
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	catalog.Types[0].Representations = append(catalog.Types[0].Representations, resourcev2.Representation{ID: "other-format", Revision: "other-r1"})
	catalog.Types[0].DefaultRepresentation = "other-format"
	catalog.Revision = "presentation-only"
	second := sourceTestOpen(t, ctrl, target)
	require.Empty(t, provider.opens, "an unselected format/default cannot fork the selected source")
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", first.ViewID))
	select {
	case <-open.stream.closed:
		t.Fatal("independent interest lost source")
	default:
	}
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", second.ViewID))
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("final interest failed to close source")
	}
}

func TestAdvertisedConnectionInterestOutlivesViewWithoutGraphBootstrap(t *testing.T) {
	ctrl, events := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	catalog, err := provider.CatalogFunc(context.Background(), resourcev2.CatalogRequest{})
	require.NoError(t, err)
	catalog.Types[0].AcquireOnConnect = true
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }
	provider.GetRelationshipsFunc = func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.RelationshipDescriptor, error) {
		t.Error("explicit source policy must not request graph declarations")
		return nil, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	_, err = ctrl.StartConnection(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	open := sourceNextOpen(t, provider.scriptedSourceProvider)
	require.Len(t, events.EventsWithKey(EventConnectionStatus), 1)
	require.Equal(t, "native::Pod", open.request.Target.Type)
	require.Equal(t, resourcev2.SourceModeSnapshotAndUpdates, open.request.Mode)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	view := sourceTestOpen(t, ctrl, target)
	require.Empty(t, provider.opens)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
	select {
	case <-open.stream.closed:
		t.Fatal("view close retired independent advertised interest")
	default:
	}
	ctrl.sources.closeConnectionInterests("p1", "conn-1")
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("final connection-policy release did not stop native source")
	}
}

func TestGraphObservationOtherOwnerCannotActivateOrClose(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := sourceTestRecord(target.Target, "pod", "")
	service := NewGraphService(ctrl, nil, nil)
	request := HostGraphObservationRequest{ClientToken: uuid.NewString(), PluginID: "p1", Route: target.Target.Route, Reference: record.Reference, Kind: "related", Direction: "outgoing"}
	opened, err := service.openObservation(testInvocationContext(), context.Background(), request, func(HostGraphObservationSnapshot) {})
	require.NoError(t, err)
	other := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	require.Error(t, service.syncObservation(other, opened.ObservationID))
	require.NoError(t, service.closeObservation(other, opened.ObservationID))
	service.mu.Lock()
	require.Len(t, service.observations, 1)
	service.mu.Unlock()
	require.NoError(t, service.closeObservation(testInvocationContext(), opened.ObservationID))
	require.Empty(t, provider.opens)
}

func TestGraphObservationAggregateReservationPressureStartsNoSource(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := sourceTestRecord(target.Target, "pod", "")
	service := NewGraphService(ctrl, nil, nil)
	require.True(t, ctrl.graphMetadata.reserveLimit(maxGraphAggregateMetadataBytes, maxGraphAggregateMetadataBytes))
	_, err := service.openObservation(testInvocationContext(), context.Background(), HostGraphObservationRequest{ClientToken: uuid.NewString(), PluginID: "p1", Route: target.Target.Route, Reference: record.Reference, Kind: "related", Direction: "outgoing"}, func(HostGraphObservationSnapshot) {})
	require.Error(t, err)
	ctrl.graphMetadata.release(maxGraphAggregateMetadataBytes)
	require.Empty(t, provider.opens)
}

func TestGraphKnownNoDeclarationsDoesNotAcquireObjectInventory(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	provider.GetRelationshipsFunc = func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.RelationshipDescriptor, error) {
		return nil, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	record := sourceTestRecord(target.Target, "pod", "")
	result, err := NewGraphService(ctrl, nil, nil).GetRelated(testInvocationContext(), graph.RelatedRequest{PluginID: "p1", Reference: record.Reference, Route: target.Target.Route, Direction: "both"})
	require.NoError(t, err)
	require.Empty(t, result.Edges)
	require.Empty(t, provider.opens, "positive empty declaration metadata does not need object acquisition")
}

func TestSourceInterestFreshOpenDoesNotWaitForRetiredFailedSession(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	first := sourceTestOpen(t, ctrl, target)
	oldOpen := sourceNextOpen(t, provider)
	sourceSend(oldOpen.stream, resourcev2.SourceFrame{Failed: &resourcev2.SourceFailure{Code: "FORBIDDEN", Message: "initial acquisition denied"}})
	waitSourceView(t, events, first.Topic, func(event HostSourceViewEvent) bool { return event.Status != nil && event.Status.State == "failed" })
	ctrl.sources.mu.Lock()
	view := ctrl.sources.views[first.ViewID]
	interest := ctrl.sources.viewInterests[first.ViewID]
	ctrl.sources.mu.Unlock()
	require.NotNil(t, view)
	require.NotNil(t, interest)
	t.Cleanup(func() { ctrl.RetireSourceOwner(view.owner) })
	// Pause public Close after view removal, then pause old session teardown.
	// New explicit acquisition must not inherit that failed, unowned session.
	view.mu.Lock()
	viewLocked, sourceLocked := true, false
	defer func() {
		if viewLocked {
			view.mu.Unlock()
		}
		if sourceLocked {
			view.session.mu.Unlock()
		}
	}()
	closed := make(chan error, 1)
	go func() { closed <- ctrl.CloseSourceView(testInvocationContext(), "p1", first.ViewID) }()
	require.Eventually(t, func() bool {
		ctrl.sources.mu.Lock()
		defer ctrl.sources.mu.Unlock()
		return ctrl.sources.views[first.ViewID] == nil
	}, time.Second, time.Millisecond)
	view.session.mu.Lock()
	sourceLocked = true
	view.mu.Unlock()
	viewLocked = false
	require.Eventually(t, func() bool {
		ctrl.sources.mu.Lock()
		defer ctrl.sources.mu.Unlock()
		return ctrl.sources.interests[interest.id] == nil
	}, time.Second, time.Millisecond)
	type opened struct {
		view HostSourceViewOpened
		err  error
	}
	fresh := make(chan opened, 1)
	go func() {
		view, err := ctrl.OpenSourceView(testInvocationContext(), "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "ifSupported"})
		fresh <- opened{view: view, err: err}
	}()
	var next HostSourceViewOpened
	select {
	case result := <-fresh:
		require.NoError(t, result.err)
		next = result.view
	case <-time.After(time.Second):
		t.Fatal("explicit new acquisition waited for failed unowned session teardown")
	}
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", next.ViewID)
	require.NoError(t, ctrl.SyncSourceView(testInvocationContext(), "p1", next.ViewID))
	nextOpen := sourceNextOpen(t, provider)
	record := sourceTestRecord(target.Target, "recovered", "fresh-incarnation")
	sourceSend(nextOpen.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	sourceSend(nextOpen.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	snapshot := waitSourceView(t, events, next.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshot" && len(event.Records) == 1 })
	require.Equal(t, record, snapshot.Records[0].Record)
	waitSourceView(t, events, next.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.ViewGeneration == snapshot.ViewGeneration && event.Status != nil && event.Status.State == "following"
	})
	view.session.mu.Unlock()
	sourceLocked = false
	select {
	case err := <-closed:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("old close did not finish")
	}
}

func TestAdvertisedConnectionPolicyUsesNativeOwnerAndSurvivesWindowRetirement(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	catalog, err := provider.CatalogFunc(context.Background(), resourcev2.CatalogRequest{})
	require.NoError(t, err)
	catalog.Types[0].AcquireOnConnect = true
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }
	provider.GetRelationshipsFunc = func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.RelationshipDescriptor, error) {
		t.Error("native policy must not acquire graph metadata")
		return nil, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	window := invocation.NewScope(invocation.TrustedUI)
	ctx := window.Context(context.Background())
	_, err = ctrl.StartConnection(ctx, "p1", "conn-1")
	require.NoError(t, err)
	native := sourceNextOpen(t, provider.scriptedSourceProvider)
	require.Eventually(t, func() bool {
		ctrl.sources.mu.Lock()
		defer ctrl.sources.mu.Unlock()
		return len(ctrl.sources.connectionInterests) == 1
	}, time.Second, time.Millisecond)
	ctrl.sources.mu.Lock()
	var nativeCtx context.Context
	for _, interest := range ctrl.sources.connectionInterests {
		nativeCtx = interest.ctx
	}
	ctrl.sources.mu.Unlock()
	nativeRequest, ok := invocation.FromContext(nativeCtx)
	require.True(t, ok)
	require.Equal(t, invocation.Host, nativeRequest.Principal().Origin())
	require.Equal(t, "resource.OpenSourceView", nativeRequest.Operation())
	target, err := ctrl.ResolveTarget(ctx, "p1", ResolveTargetRequest{Route: native.request.Target.Route, Type: native.request.Target.Type, Representation: "native"})
	require.NoError(t, err)
	view, err := ctrl.OpenSourceView(ctx, "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "ifSupported"})
	require.NoError(t, err)
	require.NoError(t, ctrl.SyncSourceView(ctx, "p1", view.ViewID))
	owned := sourceNextOpen(t, provider.scriptedSourceProvider)
	ctrl.sources.mu.Lock()
	ownedInterest := ctrl.sources.viewInterests[view.ViewID]
	ctrl.sources.mu.Unlock()
	require.NotNil(t, ownedInterest)
	ownedRequest, ok := invocation.FromContext(ownedInterest.ctx)
	require.True(t, ok)
	require.Equal(t, window.Principal(), ownedRequest.Principal())
	require.NotEqual(t, nativeRequest.Principal().Owner(), ownedRequest.Principal().Owner())
	ctrl.sources.mu.Lock()
	require.Len(t, ctrl.sources.connectionInterests, 1)
	require.Len(t, ctrl.sources.interests, 2)
	ctrl.sources.mu.Unlock()
	ctrl.RetireSourceOwner(window.Principal().Owner())
	select {
	case <-owned.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("window retirement retained its source")
	}
	select {
	case <-native.stream.closed:
		t.Fatal("window retirement stopped native connection policy")
	default:
	}
	ctrl.sources.closeConnectionInterests("p1", "conn-1")
	select {
	case <-native.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("connection retirement retained policy source")
	}
}

func TestAdvertisedConnectionPolicyWithdrawalRetiresOnlyPolicyInterest(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := demandOwnershipTestProvider()
	catalog, err := provider.CatalogFunc(context.Background(), resourcev2.CatalogRequest{})
	require.NoError(t, err)
	catalog.Types[0].AcquireOnConnect = true
	var catalogMu sync.Mutex
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalogMu.Lock()
		defer catalogMu.Unlock()
		current := catalog
		current.Types = append([]resourcev2.ResourceType(nil), catalog.Types...)
		return current, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	_, err = ctrl.StartConnection(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	native := sourceNextOpen(t, provider.scriptedSourceProvider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	view := sourceTestOpen(t, ctrl, target)
	require.Empty(t, provider.opens, "same native principal/exact selection may share policy source")
	catalogMu.Lock()
	catalog.Types[0].AcquireOnConnect = false
	catalog.Revision = "policy-withdrawn"
	catalogMu.Unlock()
	// A current support observation withdraws policy ownership without IO.
	// The independently owned view still needs this source.
	ctx, err := ctrl.admit(testInvocationContext(), "resource.OpenSourceView", readTarget("p1", target.Target))
	require.NoError(t, err)
	admission, current, err := ctrl.routeCatalog(ctx, "p1", target.Target.Route)
	require.NoError(t, err)
	require.NoError(t, ctrl.sources.observeConnectionPolicies(ctx, "p1", target.Target.Route, current, admission))
	ctrl.sources.mu.Lock()
	require.Empty(t, ctrl.sources.connectionInterests)
	require.Len(t, ctrl.sources.interests, 1)
	ctrl.sources.mu.Unlock()
	select {
	case <-native.stream.closed:
		t.Fatal("policy withdrawal stopped another interest")
	default:
	}
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
	select {
	case <-native.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("final view close retained source")
	}
}
