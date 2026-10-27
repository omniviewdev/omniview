package resource

import (
	"context"
	"errors"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
	"github.com/stretchr/testify/require"
)

func TestWatchStartupFailureRollsBackBeforeSourcesStart(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	var loaded atomic.Int32
	provider := resourcetest.NewTestProvider(t,
		resourcetest.WithLoadConnectionsFunc(func(context.Context) ([]types.Connection, error) {
			loaded.Add(1)
			return nil, nil
		}),
		resourcetest.WithListenForEventsFunc(func(context.Context, resource.WatchEventSink, func() error) error {
			return &resource.ResourceOperationError{Code: "FORBIDDEN", Message: "native event access denied"}
		}),
	)
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
	provider := resourcetest.NewTestProvider(t,
		resourcetest.WithListenForEventsFunc(func(ctx context.Context, _ resource.WatchEventSink, _ func() error) error {
			defer close(stopped)
			close(entered)
			<-ctx.Done()
			return ctx.Err()
		}),
	)
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
	provider := resourcetest.NewTestProvider(t,
		resourcetest.WithListenForEventsFunc(func(ctx context.Context, _ resource.WatchEventSink, _ func() error) error {
			defer close(stopped)
			close(entered)
			<-ctx.Done()
			return ctx.Err()
		}),
	)
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
	oldProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithListenForEventsFunc(func(context.Context, resource.WatchEventSink, func() error) error {
			store.armed.Store(true)
			return failed
		}),
	)
	oldDone := make(chan error, 1)
	oldBackend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": oldProvider})
	go func() { oldDone <- ctrl.OnPluginStart("proof", defaultMeta(), oldBackend) }()
	<-store.entered
	// Ownership stays visible through retirement, while actual provider calls
	// are unavailable. This existing consumer API also schedules the old gap.
	retiring, err := ctrl.ListPlugins(testInvocationContext())
	require.NoError(t, err)
	retirementFenced := slices.Contains(retiring, "proof")

	meta := resource.ResourceMeta{Group: "proof", Version: "v1", Kind: "Replacement"}
	replacement := resourcetest.NewTestProvider(t,
		resourcetest.WithLoadConnectionsFunc(func(context.Context) ([]types.Connection, error) {
			return []types.Connection{{ID: "replacement"}}, nil
		}),
	)
	replacement.GetResourceTypesFunc = func(context.Context, string) (map[string]resource.ResourceMeta, error) {
		return map[string]resource.ResourceMeta{meta.Key(): meta}, nil
	}
	replacement.GetRelationshipsFunc = func(context.Context, string) ([]resource.RelationshipDescriptor, error) {
		return []resource.RelationshipDescriptor{{Type: resource.RelOwns, TargetResourceKey: "replacement-target"}}, nil
	}
	actionStopped := make(chan struct{})
	replacement.StreamActionFunc = func(ctx context.Context, _ string, _ string, _ resource.ActionInput, events chan<- resource.ActionEvent) error {
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
	go func() {
		err := ctrl.OnPluginStart("proof", defaultMeta(), replacementBackend)
		if err == nil {
			ctrl.subs.Subscribe("proof", "replacement", meta.Key())
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
	discovered, err := ctrl.GetResourceTypes(ctx, "proof", "replacement")
	require.NoError(t, err)
	require.Contains(t, discovered, meta.Key())
	connection, err := ctrl.GetConnection(ctx, "proof", "replacement")
	require.NoError(t, err)
	require.Equal(t, "replacement", connection.ID)
	require.NoError(t, ctrl.SubscribeResource(ctx, "proof", "replacement", meta.Key()))
	sink := &engineWatchSink{pluginID: "proof", ctrl: ctrl, store: ctrl.registryStore, dispatcher: ctrl.dispatcher}
	sink.OnAdd(resource.WatchAddPayload{Connection: "replacement", Key: meta.Key(), ID: "replacement-visible"})
	require.Len(t, emitter.EventsWithKey("proof/replacement/"+meta.Key()+"/ADD"), 1)
	handle, err := ctrl.StreamAction(ctx, "proof", "replacement", meta.Key(), "verify-admission", resource.ActionInput{})
	require.NoError(t, err)
	require.NotEmpty(t, handle)
	require.NoError(t, ctrl.CancelStreamAction(ctx, handle))
	select {
	case <-actionStopped:
	case <-time.After(time.Second):
		t.Fatal("replacement action did not retire after consumer cancellation")
	}
	require.Len(t, ctrl.graph.GetDeclarations(meta.Key()), 1, "retired cleanup erased replacement declarations")
	present, err := ctrl.HasPlugin(testInvocationContext(), "proof")
	require.NoError(t, err)
	require.True(t, present)
}

func TestWatchStartupFailurePreservesPersistedConnectionsThroughFailedUnloadAndReload(t *testing.T) {
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
	require.NoError(t, saveToLocalStore(storeRoot, map[string][]types.Connection{pluginID: saved}))
	require.NoError(t, saveToLocalStore(otherRoot, map[string][]types.Connection{otherID: unrelated}))
	ctrl.OnPluginInit(pluginID, defaultMeta())
	ctrl.OnPluginInit(otherID, defaultMeta())
	loaded, err := ctrl.ListConnections(testInvocationContext(), pluginID)
	require.NoError(t, err)
	require.Equal(t, expected, loaded, "initialization must load the actual persisted configuration")

	otherProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithLoadConnectionsFunc(func(context.Context) ([]types.Connection, error) {
			return nil, nil
		}),
	)
	otherBackend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, otherProvider)})
	require.NoError(t, ctrl.OnPluginStart(otherID, defaultMeta(), otherBackend))
	t.Cleanup(func() { require.NoError(t, ctrl.OnPluginShutdown(otherID, defaultMeta())) })
	otherDeclaration := resource.RelationshipDescriptor{Type: resource.RelUses, TargetResourceKey: "proof::v1::Unrelated"}
	seedRuntime := func(owner, connection string, declaration resource.RelationshipDescriptor) graph.GraphNode {
		node := graph.GraphNode{PluginID: owner, ConnectionID: connection, ResourceKey: resourceKey, ID: "source"}
		target := node
		target.ID = "target"
		ctrl.registryStore.Put(registry.ResourceEntry{PluginID: owner, ConnectionID: connection, ResourceKey: resourceKey, ID: node.ID})
		ctrl.subs.Subscribe(owner, connection, resourceKey)
		ctrl.graph.SetDeclarations(owner, resourceKey, []resource.RelationshipDescriptor{declaration})
		ctrl.graph.AddEdge(graph.GraphEdge{Source: node, Target: target, Type: declaration.Type})
		return node
	}
	retiredNode := seedRuntime(pluginID, expected[0].ID, resource.RelationshipDescriptor{Type: resource.RelOwns, TargetResourceKey: "proof::v1::Retired"})
	unrelatedNode := seedRuntime(otherID, unrelated[0].ID, otherDeclaration)

	var discoveries atomic.Int32
	failedProvider := resourcetest.NewTestProvider(t,
		resourcetest.WithLoadConnectionsFunc(func(context.Context) ([]types.Connection, error) {
			discoveries.Add(1)
			return nil, nil
		}),
		resourcetest.WithListenForEventsFunc(func(context.Context, resource.WatchEventSink, func() error) error {
			return &resource.ResourceOperationError{Code: "FORBIDDEN", Message: "native registration denied"}
		}),
	)
	failedBackend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, failedProvider)})
	var denied *resource.ResourceOperationError
	require.ErrorAs(t, ctrl.OnPluginStart(pluginID, defaultMeta(), failedBackend), &denied)
	require.Equal(t, "FORBIDDEN", denied.Code)
	require.Zero(t, discoveries.Load(), "failed registration must not rediscover or replace saved configuration")
	present, err := ctrl.HasPlugin(testInvocationContext(), pluginID)
	require.NoError(t, err)
	require.False(t, present)
	handle, err := ctrl.StreamAction(testInvocationContext(), pluginID, expected[0].ID, resourceKey, "unavailable", resource.ActionInput{})
	require.Error(t, err)
	require.Empty(t, handle)
	require.False(t, ctrl.subs.IsSubscribed(pluginID, expected[0].ID, resourceKey))
	require.Empty(t, ctrl.registryStore.ScanByResourceKey(pluginID, expected[0].ID, resourceKey))
	retiredEdges, err := ctrl.graph.GetRelated(retiredNode, graph.Both, nil)
	require.NoError(t, err)
	require.Empty(t, retiredEdges)
	require.Equal(t, []resource.RelationshipDescriptor{otherDeclaration}, ctrl.graph.GetDeclarations(resourceKey))
	ctrl.actions.mu.Lock()
	actionAdmissionStopped := ctrl.actions.blocked[pluginID]
	ctrl.actions.mu.Unlock()
	require.True(t, actionAdmissionStopped, "the failed generation's action ownership must retire")

	// The loader records the failed start, then failed unload calls shutdown,
	// which delegates to normal stop and persists before removing connections.
	require.NoError(t, ctrl.OnPluginShutdown(pluginID, defaultMeta()))
	stoppedConnections, err := ctrl.ListConnections(testInvocationContext(), pluginID)
	require.Equal(t, "NOT_FOUND", requireAppError(t, err).Code)
	require.Empty(t, stoppedConnections, "normal failed-plugin stop must still retire its in-memory connection cache")
	persisted, err := loadFromLocalStore(storeRoot)
	require.NoError(t, err)
	require.Equal(t, expected, persisted[pluginID], "failed unload must not overwrite saved connections with an empty store")
	persistedOther, err := loadFromLocalStore(otherRoot)
	require.NoError(t, err)
	require.Equal(t, unrelated, persistedOther[otherID])
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
	restored, err := fresh.ListConnections(testInvocationContext(), pluginID)
	require.NoError(t, err)
	require.Equal(t, expected, restored, "a fresh controller must recover configuration from disk, not the retired runtime")
	replacement := resourcetest.NewTestProvider(t,
		resourcetest.WithLoadConnectionsFunc(func(context.Context) ([]types.Connection, error) {
			return nil, nil
		}),
	)
	replacementBackend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": setupGRPCProvider(t, replacement)})
	require.NoError(t, fresh.OnPluginStart(pluginID, defaultMeta(), replacementBackend))
	t.Cleanup(func() { require.NoError(t, fresh.OnPluginShutdown(pluginID, defaultMeta())) })
	restored, err = fresh.ListConnections(testInvocationContext(), pluginID)
	require.NoError(t, err)
	require.Equal(t, expected, restored, "successful replacement must retain saved configurations even without provider rediscovery")
}
