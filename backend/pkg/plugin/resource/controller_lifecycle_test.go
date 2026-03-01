package resource

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ============================================================================
// OnPluginInit
// ============================================================================

func TestOnPluginInit_InitializesConnectionSlice(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.OnPluginInit("p1", defaultMeta())

	ctrl.connsMu.RLock()
	conns, ok := ctrl.connections["p1"]
	ctrl.connsMu.RUnlock()
	assert.True(t, ok)
	assert.Empty(t, conns)
}

func TestOnPluginInit_HandlesMissingStore(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	// No GOB file on disk — should not panic.
	assert.NotPanics(t, func() {
		ctrl.OnPluginInit("nonexistent-plugin", defaultMeta())
	})
}

// ============================================================================
// OnPluginStart
// ============================================================================

func TestOnPluginStart_RegistersProvider(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		LoadConnectionsFunc: func(_ context.Context) ([]types.Connection, error) {
			return nil, nil
		},
		ListenForEventsFunc: func(ctx context.Context, _ resource.WatchEventSink) error {
			<-ctx.Done()
			return nil
		},
		WatchConnectionsFunc: func(ctx context.Context, _ chan<- []types.Connection) error {
			<-ctx.Done()
			return nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	ctrl.pluginsMu.RLock()
	_, ok := ctrl.plugins["p1"]
	ctrl.pluginsMu.RUnlock()
	assert.True(t, ok)
}

func TestOnPluginStart_VersionStored(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{}
	registerMockPlugin(ctrl, "p1", mock)

	ctrl.pluginsMu.RLock()
	ps := ctrl.plugins["p1"]
	ctrl.pluginsMu.RUnlock()
	assert.Equal(t, 1, ps.version)
}

func TestOnPluginStart_DoubleStart_CancelsOld(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var oldCancelCalled bool
	oldCtx, oldCancel := context.WithCancel(context.Background())
	ctrl.plugins["p1"] = &pluginState{
		provider:    &mockProvider{},
		version:     1,
		watchCancel: func() { oldCancelCalled = true; oldCancel() },
	}
	ctrl.connections["p1"] = []types.Connection{}

	// Register again — should cancel old.
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	// Give a moment for cancel propagation.
	assert.True(t, oldCancelCalled || oldCtx.Err() != nil,
		"old watch context should have been cancelled")
}

// ============================================================================
// OnPluginStop
// ============================================================================

func TestOnPluginStop_RemovesPlugin(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	err := ctrl.OnPluginStop("p1", defaultMeta())
	require.NoError(t, err)

	ctrl.pluginsMu.RLock()
	_, ok := ctrl.plugins["p1"]
	ctrl.pluginsMu.RUnlock()
	assert.False(t, ok)
}

func TestOnPluginStop_CancelsWatchCtx(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var cancelled bool
	ctx, cancel := context.WithCancel(context.Background())
	ctrl.plugins["p1"] = &pluginState{
		provider: &mockProvider{},
		version:  1,
		watchCancel: func() {
			cancelled = true
			cancel()
		},
	}
	ctrl.connections["p1"] = []types.Connection{}

	_ = ctrl.OnPluginStop("p1", defaultMeta())
	assert.True(t, cancelled || ctx.Err() != nil)
}

func TestOnPluginStop_RemovesConnections(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	ctrl.connections["p1"] = []types.Connection{{ID: "c1"}}

	_ = ctrl.OnPluginStop("p1", defaultMeta())

	ctrl.connsMu.RLock()
	_, ok := ctrl.connections["p1"]
	ctrl.connsMu.RUnlock()
	assert.False(t, ok)
}

func TestOnPluginStop_RemovesSubscriptions(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	ctrl.subs.Subscribe("p1", "c1", "pods")

	_ = ctrl.OnPluginStop("p1", defaultMeta())

	assert.False(t, ctrl.subs.IsSubscribed("p1", "c1", "pods"))
}

// ============================================================================
// OnPluginShutdown
// ============================================================================

func TestOnPluginShutdown_DelegatesStop(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	err := ctrl.OnPluginShutdown("p1", defaultMeta())
	require.NoError(t, err)

	ctrl.pluginsMu.RLock()
	_, ok := ctrl.plugins["p1"]
	ctrl.pluginsMu.RUnlock()
	assert.False(t, ok)
}

// ============================================================================
// ListPlugins / HasPlugin
// ============================================================================

func TestListPlugins_ReturnsRegistered(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	registerMockPlugin(ctrl, "p2", &mockProvider{})

	plugins, err := ctrl.ListPlugins()
	require.NoError(t, err)
	assert.Len(t, plugins, 2)
	assert.Contains(t, plugins, "p1")
	assert.Contains(t, plugins, "p2")
}

func TestHasPlugin_TrueAndFalse(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	assert.True(t, ctrl.HasPlugin("p1"))
	assert.False(t, ctrl.HasPlugin("nonexistent"))
}

// ============================================================================
// listenForWatchEvents
// ============================================================================

func TestListenForWatchEvents_ContextCancel(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ListenForEventsFunc: func(ctx context.Context, _ resource.WatchEventSink) error {
			<-ctx.Done()
			return nil
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	done := make(chan struct{})
	go func() {
		ctrl.listenForWatchEvents("p1", mock, ctx, sink)
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("listenForWatchEvents did not exit after context cancel")
	}
}

func TestListenForWatchEvents_ProviderError_CrashRecovery(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	errorProvider := &mockProvider{
		ListenForEventsFunc: func(_ context.Context, _ resource.WatchEventSink) error {
			return assert.AnError
		},
	}

	ctx := context.Background()
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		ctrl.listenForWatchEvents("p1", errorProvider, ctx, sink)
	}()
	wg.Wait()

	// Should have emitted crash event.
	events := emitter.EventsWithKey("plugin/crash")
	assert.NotEmpty(t, events)
}

func TestListenForWatchEvents_ProviderError_ContextDone_NoCrash(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Already cancelled.

	errorProvider := &mockProvider{
		ListenForEventsFunc: func(_ context.Context, _ resource.WatchEventSink) error {
			return assert.AnError
		},
	}
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	ctrl.listenForWatchEvents("p1", errorProvider, ctx, sink)

	events := emitter.EventsWithKey("plugin/crash")
	assert.Empty(t, events, "should not crash if context already done")
}

// ============================================================================
// listenForConnectionEvents
// ============================================================================

func TestListenForConnectionEvents_NewConnsMerged(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctrl.connections["p1"] = []types.Connection{}

	provider := &mockProvider{
		WatchConnectionsFunc: func(ctx context.Context, stream chan<- []types.Connection) error {
			stream <- []types.Connection{{ID: "c1", Name: "New"}}
			<-ctx.Done()
			return nil
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	go ctrl.listenForConnectionEvents("p1", provider, ctx)

	// Wait for merge.
	assert.Eventually(t, func() bool {
		ctrl.connsMu.RLock()
		defer ctrl.connsMu.RUnlock()
		return len(ctrl.connections["p1"]) > 0
	}, 2*time.Second, 10*time.Millisecond)

	cancel()
}

func TestListenForConnectionEvents_EmitsSync(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	ctrl.connections["p1"] = []types.Connection{}

	provider := &mockProvider{
		WatchConnectionsFunc: func(ctx context.Context, stream chan<- []types.Connection) error {
			stream <- []types.Connection{{ID: "c1"}}
			<-ctx.Done()
			return nil
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	go ctrl.listenForConnectionEvents("p1", provider, ctx)

	emitter.WaitForEvent(t, "p1/connection/sync", 2*time.Second)
	cancel()
}

// ============================================================================
// Helpers
// ============================================================================

func defaultMeta() config.PluginMeta {
	return config.PluginMeta{}
}
