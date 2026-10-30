package resource

import (
	"context"
	"errors"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

func TestWatchStartupFailureRollsBackBeforeSourcesStart(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	var loaded atomic.Int32
	provider := &mockProvider{LoadConnectionsFunc: func(context.Context) ([]types.Connection, error) {
		loaded.Add(1)
		return nil, nil
	}, ListenForEventsFunc: func(context.Context, resource.WatchEventSink, func() error) error {
		return &resource.ResourceOperationError{Code: "FORBIDDEN", Message: "native event access denied"}
	}}
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, provider)})
	err := ctrl.OnPluginStart("proof", defaultMeta(), backend)
	var denied *resource.ResourceOperationError
	require.ErrorAs(t, err, &denied)
	require.Equal(t, "FORBIDDEN", denied.Code)
	present, inspectErr := ctrl.HasPlugin(testInvocationContext(), "proof")
	require.NoError(t, inspectErr)
	require.False(t, present)
	require.Zero(t, loaded.Load(), "failed stream registration must not admit connection sources")
}

func TestWatchStartupStopCancelsPendingActualRPC(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	entered := make(chan struct{})
	stopped := make(chan struct{})
	provider := &mockProvider{ListenForEventsFunc: func(ctx context.Context, _ resource.WatchEventSink, _ func() error) error {
		defer close(stopped)
		close(entered)
		<-ctx.Done()
		return ctx.Err()
	}}
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, provider)})
	done := make(chan error, 1)
	go func() { done <- ctrl.OnPluginStart("proof", defaultMeta(), backend) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("actual event RPC did not reach pending registration")
	}
	require.NoError(t, ctrl.OnPluginStop("proof", defaultMeta()))
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("stopped plugin startup did not return its registration failure")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("stopped plugin retained its actual server registration")
	}
	present, inspectErr := ctrl.HasPlugin(testInvocationContext(), "proof")
	require.NoError(t, inspectErr)
	require.False(t, present)
}

func TestWatchStartupTimeoutReturnsFailureAndRetiresActualRPC(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	scheduled := make(chan *controlledActionTimer, 1)
	ctrl.watchAfterFunc = func(d time.Duration, fn func()) actionTimer {
		require.Equal(t, 10*time.Second, d, "production readiness deadline must remain unchanged")
		timer := &controlledActionTimer{fn: fn}
		scheduled <- timer
		return timer
	}
	entered := make(chan struct{})
	stopped := make(chan struct{})
	provider := &mockProvider{ListenForEventsFunc: func(ctx context.Context, _ resource.WatchEventSink, _ func() error) error {
		defer close(stopped)
		close(entered)
		<-ctx.Done()
		return ctx.Err()
	}}
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, provider)})
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginShutdown("proof", defaultMeta())) })
	done := make(chan error, 1)
	go func() { done <- ctrl.OnPluginStart("proof", defaultMeta(), backend) }()
	var timer *controlledActionTimer
	select {
	case timer = <-scheduled:
	case <-time.After(time.Second):
		t.Fatal("startup did not schedule its readiness deadline")
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("actual event RPC did not reach pending registration")
	}
	// Fire the production expiry callback only after the actual gRPC handler
	// is blocked. No real deadline wait or fake transport is needed.
	timer.fn()
	select {
	case err := <-done:
		require.ErrorIs(t, err, context.DeadlineExceeded)
	case <-time.After(time.Second):
		t.Fatal("expired startup did not return failure")
	}
	require.True(t, timer.stopped)
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("timed-out startup retained its actual server registration")
	}
	present, inspectErr := ctrl.HasPlugin(testInvocationContext(), "proof")
	require.NoError(t, inspectErr)
	require.False(t, present)
}

type pausedFailedStartStore struct {
	registry.Store
	armed   atomic.Bool
	entered chan struct{}
	release chan struct{}
}

func (s *pausedFailedStartStore) DeleteByConnection(pluginID, connectionID string) []registry.ResourceEntry {
	if s.armed.CompareAndSwap(true, false) {
		close(s.entered)
		<-s.release
	}
	return s.Store.DeleteByConnection(pluginID, connectionID)
}

type replacementAttemptBackend struct {
	plugintypes.PluginBackend
	requested chan struct{}
}

func (b *replacementAttemptBackend) Dispense(name string) (interface{}, error) {
	provider, err := b.PluginBackend.Dispense(name)
	close(b.requested)
	return provider, err
}

func TestWatchStartupFailedCleanupCannotEraseReplacement(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	store := &pausedFailedStartStore{Store: ctrl.registryStore, entered: make(chan struct{}), release: make(chan struct{})}
	ctrl.registryStore = store
	defer func() {
		select {
		case <-store.release:
		default:
			close(store.release)
		}
	}()
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginShutdown("proof", defaultMeta())) })
	ctrl.connections["proof"] = []types.Connection{{ID: "previous"}}
	failed := errors.New("registration rejected")
	oldProvider := &mockProvider{ListenForEventsFunc: func(context.Context, resource.WatchEventSink, func() error) error {
		store.armed.Store(true)
		return failed
	}}
	oldDone := make(chan error, 1)
	oldBackend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": oldProvider})
	go func() { oldDone <- ctrl.OnPluginStart("proof", defaultMeta(), oldBackend) }()
	<-store.entered
	// Ownership stays visible through retirement, while actual provider calls
	// are unavailable. This existing consumer API also schedules the old gap.
	retiring, err := ctrl.ListPlugins(testInvocationContext())
	require.NoError(t, err)
	retirementFenced := slices.Contains(retiring, "proof")

	const resourceType = "proof::v1::Replacement"
	replacement := &mockProvider{LoadConnectionsFunc: func(context.Context) ([]types.Connection, error) {
		return []types.Connection{{ID: "replacement"}}, nil
	}}
	replacement.CatalogFunc = func(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
		catalog, err := lifecycleTestCatalog(resourceType, "replacement-target")(ctx, request)
		for i := range catalog.Types {
			catalog.Types[i].DefaultRepresentation = "native"
		}
		return catalog, err
	}
	replacement.GetRelationshipsFunc = func(_ context.Context, _ resource.AccessRoute, sourceType string) ([]resource.RelationshipDescriptor, error) {
		if sourceType != resourceType {
			return []resource.RelationshipDescriptor{}, nil
		}
		return []resource.RelationshipDescriptor{{Type: resource.RelOwns, TargetType: "replacement-target", TargetScope: []resource.ScopeEntry{}}}, nil
	}
	actionStopped := make(chan struct{})
	replacement.StreamActionFunc = func(ctx context.Context, _ resource.ActionRequest, events chan<- resource.ActionEvent) error {
		defer close(actionStopped)
		events <- resource.ActionEvent{Type: "ready"}
		<-ctx.Done()
		return nil
	}
	replaced := make(chan error, 1)
	replacementBackend := &replacementAttemptBackend{
		PluginBackend: plugintypes.NewInProcessBackend(map[string]interface{}{"resource": replacement}),
		requested:     make(chan struct{}),
	}
	var replacementSubscription HostSubscription
	go func() {
		err := ctrl.OnPluginStart("proof", defaultMeta(), replacementBackend)
		if err == nil {
			replacementSubscription = admittedSubscription(t, ctrl, "proof", "replacement", resourceType)
			err = ctrl.SubscribeResource(testInvocationContext(), "proof", replacementSubscription)
		}
		replaced <- err
	}()
	select {
	case <-replacementBackend.requested:
	case <-time.After(time.Second):
		t.Fatal("replacement did not attempt actual provider negotiation")
	}
	var replacementErr error
	if !retirementFenced {
		// The old implementation permits publication in this exact gap.
		// Finish it before allowing retired cleanup to resume.
		replacementErr = <-replaced
	}
	close(store.release)
	require.ErrorIs(t, <-oldDone, failed)
	if retirementFenced {
		replacementErr = <-replaced
	}
	require.NoError(t, replacementErr)
	ctx := testInvocationContext()
	discovered, err := ctrl.Catalog(ctx, "proof", resource.CatalogRequest{Route: resource.AccessRoute{Connection: "replacement"}})
	require.NoError(t, err)
	require.Equal(t, resourceType, discovered.Types[0].Type)
	connection, err := ctrl.GetConnection(ctx, "proof", "replacement")
	require.NoError(t, err)
	require.Equal(t, "replacement", connection.ID)
	require.NoError(t, ctrl.SubscribeResource(ctx, "proof", replacementSubscription))
	target := replacementSubscription.Target
	sink := &engineWatchSink{ctx: ctx, generationID: ctrl.plugins["proof"].generationID, pluginID: "proof", ctrl: ctrl, store: ctrl.registryStore, dispatcher: ctrl.dispatcher}
	sink.OnAdd(resource.WatchAddPayload{Route: target.Route, Record: canonicalTestRecord(target.Provider, target.Authority, target.Type, "replacement-visible"), Guarantee: resource.BestEffortGuarantee})
	require.Len(t, emitter.EventsWithKey("proof/replacement/"+resourceType+"/ADD"), 1)
	handle, err := ctrl.StreamAction(ctx, "proof", admittedActionRequest(t, ctrl, "proof", "replacement", resourceType, "verify-admission"))
	require.NoError(t, err)
	require.NotEmpty(t, handle)
	require.NoError(t, ctrl.CancelStreamAction(ctx, handle))
	select {
	case <-actionStopped:
	case <-time.After(time.Second):
		t.Fatal("replacement action did not retire after consumer cancellation")
	}
	declarations, _, declared := ctrl.graph.GetBoundDeclarations("proof", target.Route, resourceType)
	require.True(t, declared)
	require.Len(t, declarations, 1, "retired cleanup erased replacement declarations")
	present, err := ctrl.HasPlugin(testInvocationContext(), "proof")
	require.NoError(t, err)
	require.True(t, present)
}

type readinessCloseProvider struct {
	*mockProvider
	closeCalls atomic.Int32
	closeErr   error
}

func (p *readinessCloseProvider) Close() error {
	p.closeCalls.Add(1)
	return p.closeErr
}

func TestWatchStartupFailurePreservesDesiredProfilesThroughFailedUnloadAndReload(t *testing.T) {
	const pluginID = "failed-watch"
	const otherID = "unrelated"
	const resourceKey = "proof::v1::Task"
	ctrl, _ := newTestControllerWithEmitter(t)
	storeRoot, err := ctrl.pluginStoreFn(pluginID)
	require.NoError(t, err)
	otherRoot, err := ctrl.pluginStoreFn(otherID)
	require.NoError(t, err)
	saved := []types.Connection{
		{
			ID: "primary", Name: "Alpha saved configuration",
			Data: map[string]any{"endpoint": "unix:///private-fixture/proof.sock", "context": "opaque/%2F"},
			Lifecycle: types.ConnectionLifecycle{AutoConnect: &types.ConnectionAutoConnect{
				Enabled: false, Triggers: []types.ConnectionAutoConnectTrigger{types.ConnectionAutoConnectTriggerPluginStart},
				Retry: types.ConnectionAutoConnectRetryOnChange,
			}},
			LastRefresh: time.Date(2026, time.October, 26, 12, 0, 0, 0, time.UTC),
		},
		{ID: "secondary", Name: "Beta saved configuration", Data: map[string]any{"endpoint": "memory://secondary"}},
	}
	expected := append([]types.Connection(nil), saved...)
	for i := range expected {
		expected[i].LastRefresh = time.Time{}
	}
	unrelated := []types.Connection{{ID: "other", Name: "Unrelated configuration", Data: map[string]any{"marker": "untouched"}}}
	registerMockPlugin(ctrl, pluginID, connectionOverlayTestProvider())
	registerMockPlugin(ctrl, otherID, connectionOverlayTestProvider())
	for _, connection := range saved {
		requireSavedConnectionProfile(t, ctrl, pluginID, connection)
	}
	for _, connection := range unrelated {
		requireSavedConnectionProfile(t, ctrl, otherID, connection)
	}
	expectedStored, err := readDesiredConnections(storeRoot)
	require.NoError(t, err)
	expectedOtherStored, err := readDesiredConnections(otherRoot)
	require.NoError(t, err)
	loaded, err := ctrl.ListConnections(testInvocationContext(), pluginID)
	require.NoError(t, err)
	require.ElementsMatch(t, expected, loaded, "explicit save must apply effective source configuration and persist desired profiles")

	otherProvider := &readinessCloseProvider{mockProvider: connectionOverlayTestProvider()}
	otherProvider.CatalogFunc = lifecycleTestCatalog(resourceKey, "proof::v1::Unrelated")
	otherBackend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, otherProvider)})
	require.NoError(t, ctrl.OnPluginStart(otherID, defaultMeta(), otherBackend))
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginShutdown(otherID, defaultMeta())) })
	otherDeclaration := resource.RelationshipDescriptor{Type: resource.RelUses, TargetType: "proof::v1::Unrelated", TargetScope: []resource.ScopeEntry{}}
	seedRuntime := func(owner, connection string, declaration resource.RelationshipDescriptor) graph.GraphNode {
		reference := canonicalTestRecord("proof", "fixture:"+connection, resourceKey, "source").Reference
		node := graph.GraphNode{PluginID: owner, Reference: reference, Route: resource.AccessRoute{Connection: connection}}
		target := node
		target.Reference.Address.ID = "target"
		target.Reference.Address.Type = declaration.TargetType
		target.Reference.Address.Authority = "fixture:target:" + connection
		ctrl.registryStore.Put(registry.ResourceEntry{PluginID: owner, Reference: reference, Route: node.Route})
		scope := invocation.NewScope(invocation.Host)
		subscription := HostSubscription{TargetID: "seed:" + owner + ":" + connection, Target: resource.ReadTarget{Route: node.Route, Provider: reference.Address.Provider, Authority: reference.Address.Authority, Type: resourceKey, Scope: resource.QueryScope{}, Representation: "native"}}
		require.NoError(t, ctrl.subs.Subscribe(scope.Context(context.Background()), scope.Principal(), owner, subscription))
		ctrl.pluginsMu.RLock()
		epoch := ctrl.plugins[owner].sourceEpoch[connection]
		ctrl.pluginsMu.RUnlock()
		require.NoError(t, ctrl.graph.SetBoundDeclarations(owner, node.Route, resourceKey, []resource.RelationshipDescriptor{declaration}, graph.DeclarationBindings{
			Source:      graph.TargetBinding{Target: subscription.Target, IdentityDimensions: []resource.Dimension{}},
			Targets:     []graph.TargetBinding{{Target: resource.ReadTarget{Route: target.Route, Provider: target.Reference.Address.Provider, Authority: target.Reference.Address.Authority, Type: declaration.TargetType, Scope: resource.QueryScope{}, Representation: "native"}, IdentityDimensions: []resource.Dimension{}}},
			SourceEpoch: epoch,
		}))
		ctrl.graph.AddEdge(graph.GraphEdge{Source: node, Target: target, Type: declaration.Type})
		return node
	}
	retiredNode := seedRuntime(pluginID, expected[0].ID, resource.RelationshipDescriptor{Type: resource.RelOwns, TargetType: "proof::v1::Retired", TargetScope: []resource.ScopeEntry{}})
	unrelatedNode := seedRuntime(otherID, unrelated[0].ID, otherDeclaration)

	var discoveries atomic.Int32
	closeFailure := &resource.ResourceOperationError{Code: "PROVIDER_ERROR", Message: "native close failed"}
	failedProvider := &readinessCloseProvider{closeErr: closeFailure, mockProvider: &mockProvider{LoadConnectionsFunc: func(context.Context) ([]types.Connection, error) {
		discoveries.Add(1)
		return nil, nil
	}, ListenForEventsFunc: func(context.Context, resource.WatchEventSink, func() error) error {
		return &resource.ResourceOperationError{Code: "FORBIDDEN", Message: "native registration denied"}
	}}}
	failedBackend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, failedProvider)})
	var denied *resource.ResourceOperationError
	require.ErrorAs(t, ctrl.OnPluginStart(pluginID, defaultMeta(), failedBackend), &denied)
	require.Equal(t, "FORBIDDEN", denied.Code)
	require.Zero(t, discoveries.Load(), "failed registration must not rediscover or replace saved configuration")
	require.EqualValues(t, 1, failedProvider.closeCalls.Load(), "failed registration must close its source even when native close fails")
	present, err := ctrl.HasPlugin(testInvocationContext(), pluginID)
	require.NoError(t, err)
	require.False(t, present)
	handle, err := ctrl.StreamAction(testInvocationContext(), pluginID, resource.ActionRequest{Route: resource.AccessRoute{Connection: expected[0].ID}, Reference: retiredNode.Reference, Action: "unavailable", Input: resource.Value{Kind: "null"}})
	require.Error(t, err)
	require.Empty(t, handle)
	require.False(t, ctrl.subs.IsSubscribed(pluginID, expected[0].ID, resourceKey))
	require.Empty(t, ctrl.registryStore.ScanByResourceKey(pluginID, expected[0].ID, resourceKey))
	retiredEdges, err := ctrl.graph.GetRelated(retiredNode, graph.Both, nil)
	require.NoError(t, err)
	require.Empty(t, retiredEdges)
	otherDeclarations, _, declared := ctrl.graph.GetBoundDeclarations(otherID, unrelatedNode.Route, resourceKey)
	require.True(t, declared)
	require.Equal(t, []resource.RelationshipDescriptor{otherDeclaration}, otherDeclarations)
	ctrl.actions.mu.Lock()
	actionAdmissionStopped := ctrl.actions.blocked[pluginID]
	ctrl.actions.mu.Unlock()
	require.True(t, actionAdmissionStopped, "the failed generation's action ownership must retire")

	// Failed unload retires runtime state, never replacing desired profiles with
	// a discovery snapshot or an empty runtime inventory.
	require.NoError(t, ctrl.OnPluginShutdown(pluginID, defaultMeta()))
	require.EqualValues(t, 1, failedProvider.closeCalls.Load(), "later unload must not close the failed source twice")
	stoppedConnections, err := ctrl.ListConnections(testInvocationContext(), pluginID)
	require.NoError(t, err)
	require.Empty(t, stoppedConnections, "normal failed-plugin stop must still retire its in-memory connection cache")
	persisted, err := readDesiredConnections(storeRoot)
	require.NoError(t, err)
	require.Equal(t, expectedStored, persisted, "failed unload must preserve explicit desired profiles")
	persistedOther, err := readDesiredConnections(otherRoot)
	require.NoError(t, err)
	require.Equal(t, expectedOtherStored, persistedOther)
	otherConnections, err := ctrl.ListConnections(testInvocationContext(), otherID)
	require.NoError(t, err)
	require.Equal(t, unrelated, otherConnections)
	otherPresent, err := ctrl.HasPlugin(testInvocationContext(), otherID)
	require.NoError(t, err)
	require.True(t, otherPresent)
	require.True(t, ctrl.subs.IsSubscribed(otherID, unrelated[0].ID, resourceKey))
	require.Len(t, ctrl.registryStore.ScanByResourceKey(otherID, unrelated[0].ID, resourceKey), 1)
	unrelatedEdges, err := ctrl.graph.GetRelated(unrelatedNode, graph.Both, nil)
	require.NoError(t, err)
	require.Len(t, unrelatedEdges, 1)

	fresh, _ := newTestControllerWithEmitter(t)
	fresh.pluginStoreFn = ctrl.pluginStoreFn
	fresh.OnPluginInit(pluginID, defaultMeta())
	beforeReplay, err := fresh.ListConnections(testInvocationContext(), pluginID)
	require.NoError(t, err)
	require.Empty(t, beforeReplay, "desired profiles are inactive until the fresh provider applies their overlay")
	replacement := &readinessCloseProvider{mockProvider: connectionOverlayTestProvider()}
	replacementBackend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, replacement)})
	require.NoError(t, fresh.OnPluginStart(pluginID, defaultMeta(), replacementBackend))
	t.Cleanup(func() { require.NoError(t, fresh.OnPluginShutdown(pluginID, defaultMeta())) })
	restored, err := fresh.ListConnections(testInvocationContext(), pluginID)
	require.NoError(t, err)
	require.ElementsMatch(t, expected, restored, "successful replacement must apply durable desired profiles even without native rediscovery")
}
