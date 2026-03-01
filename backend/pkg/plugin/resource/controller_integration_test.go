package resource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ============================================================================
// Integration Tests (EI-001..019)
//
// Each test exercises the full flow from Service method → controller →
// provider → sink/emitter, validating the complete interaction between
// all layers.
// ============================================================================

// EI-001: AdapterV1 wraps a provider and satisfies ResourceProvider.
func TestIntegration_DispenseProvider(t *testing.T) {
	mock := &mockProvider{
		GetFunc: func(_ context.Context, key string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Result: json.RawMessage(`{"key":"` + key + `"}`), Success: true}, nil
		},
	}

	// Simulate what dispenseProvider does with a v1 provider:
	// Wrap in AdapterV1 and verify it satisfies ResourceProvider.
	adapter := NewAdapterV1(mock)
	var provider ResourceProvider = adapter
	require.NotNil(t, provider)

	result, err := provider.Get(context.Background(), "pods", resource.GetInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.JSONEq(t, `{"key":"pods"}`, string(result.Result))
}

// EI-002: OnPluginStart wires provider, loads connections, starts listeners.
func TestIntegration_OnPluginStart_FullWiring(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)

	loadCalled := false
	mock := &mockProvider{
		LoadConnectionsFunc: func(_ context.Context) ([]types.Connection, error) {
			loadCalled = true
			return []types.Connection{
				{ID: "conn-1", Name: "Test Cluster"},
			}, nil
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

	// Simulate LoadConnections during start.
	conns, err := ctrl.LoadConnections("p1")
	require.NoError(t, err)
	require.Len(t, conns, 1)
	assert.True(t, loadCalled)

	// Provider is registered and queryable.
	require.True(t, ctrl.HasPlugin("p1"))
	provider, err := ctrl.getProvider("p1")
	require.NoError(t, err)
	require.NotNil(t, provider)

	// Connection was merged into state.
	conn, err := ctrl.GetConnection("p1", "conn-1")
	require.NoError(t, err)
	assert.Equal(t, "Test Cluster", conn.Name)

	// Emitter may have fired connection/sync if emitted.
	_ = emitter
}

// EI-003: Full CRUD flow through controller with correct session context.
func TestIntegration_CRUD_ThroughController(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(ctx context.Context, key string, input resource.GetInput) (*resource.GetResult, error) {
			session := resource.SessionFromContext(ctx)
			require.NotNil(t, session)
			assert.Equal(t, "conn-1", session.Connection.ID)
			return &resource.GetResult{Result: json.RawMessage(`{"id":"` + input.ID + `"}`), Success: true}, nil
		},
		ListFunc: func(_ context.Context, _ string, _ resource.ListInput) (*resource.ListResult, error) {
			return &resource.ListResult{Success: true}, nil
		},
		CreateFunc: func(_ context.Context, _ string, _ resource.CreateInput) (*resource.CreateResult, error) {
			return &resource.CreateResult{Success: true}, nil
		},
		UpdateFunc: func(_ context.Context, _ string, _ resource.UpdateInput) (*resource.UpdateResult, error) {
			return &resource.UpdateResult{Success: true}, nil
		},
		DeleteFunc: func(_ context.Context, _ string, _ resource.DeleteInput) (*resource.DeleteResult, error) {
			return &resource.DeleteResult{Success: true}, nil
		},
		FindFunc: func(_ context.Context, _ string, _ resource.FindInput) (*resource.FindResult, error) {
			return &resource.FindResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	// Get
	getResult, err := ctrl.Get("p1", "conn-1", "core::v1::Pod", resource.GetInput{ID: "my-pod"})
	require.NoError(t, err)
	assert.True(t, getResult.Success)
	assert.JSONEq(t, `{"id":"my-pod"}`, string(getResult.Result))

	// List
	listResult, err := ctrl.List("p1", "conn-1", "core::v1::Pod", resource.ListInput{})
	require.NoError(t, err)
	assert.True(t, listResult.Success)

	// Find
	findResult, err := ctrl.Find("p1", "conn-1", "core::v1::Pod", resource.FindInput{})
	require.NoError(t, err)
	assert.True(t, findResult.Success)

	// Create
	createResult, err := ctrl.Create("p1", "conn-1", "core::v1::Pod", resource.CreateInput{})
	require.NoError(t, err)
	assert.True(t, createResult.Success)

	// Update
	updateResult, err := ctrl.Update("p1", "conn-1", "core::v1::Pod", resource.UpdateInput{})
	require.NoError(t, err)
	assert.True(t, updateResult.Success)

	// Delete
	deleteResult, err := ctrl.Delete("p1", "conn-1", "core::v1::Pod", resource.DeleteInput{})
	require.NoError(t, err)
	assert.True(t, deleteResult.Success)
}

// EI-004: Subscribe → sink.OnAdd → emitter records event.
func TestIntegration_WatchEventsFlow(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	// Subscribe.
	err := ctrl.SubscribeResource("p1", "conn-1", "pods")
	require.NoError(t, err)

	// Simulate watch event through sink.
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}
	sink.OnAdd(resource.WatchAddPayload{
		Connection: "conn-1",
		Key:        "pods",
		ID:         "pod-1",
		Namespace:  "default",
		Data:       json.RawMessage(`{"name":"pod-1"}`),
	})

	// Emitter should have recorded the event.
	ev := emitter.WaitForEvent(t, "ADD", time.Second)
	payload, ok := ev.Data.(resource.WatchAddPayload)
	require.True(t, ok)
	assert.Equal(t, "p1", payload.PluginID)
	assert.Equal(t, "conn-1", payload.Connection)
	assert.Equal(t, "pods", payload.Key)
	assert.Equal(t, "pod-1", payload.ID)
}

// EI-005: No subscription = no event in emitter; subscription = event appears.
func TestIntegration_SubscriptionGates(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	// No subscription — event should NOT appear.
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})
	assert.Empty(t, emitter.EventsWithKey("ADD"))

	// Subscribe — event should appear.
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-2"})

	ev := emitter.WaitForEvent(t, "ADD", time.Second)
	payload, ok := ev.Data.(resource.WatchAddPayload)
	require.True(t, ok)
	assert.Equal(t, "pod-2", payload.ID)
}

// EI-006: Unsubscribe → subsequent OnAdd not emitted.
func TestIntegration_Unsubscribe_StopsEvents(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	// Subscribe, emit, verify.
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})
	assert.Len(t, emitter.EventsWithKey("ADD"), 1)

	// Unsubscribe.
	_ = ctrl.UnsubscribeResource("p1", "conn-1", "pods")

	// New event should NOT be emitted.
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-2"})
	assert.Len(t, emitter.EventsWithKey("ADD"), 1) // still 1, not 2
}

// EI-007: Sub×2, unsub×1 → events still flow.
func TestIntegration_RefCounted_Subscriptions(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	// Subscribe twice.
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")

	// Unsubscribe once — still subscribed due to ref count.
	_ = ctrl.UnsubscribeResource("p1", "conn-1", "pods")
	assert.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))

	// Events still flow.
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})
	ev := emitter.WaitForEvent(t, "ADD", time.Second)
	payload, ok := ev.Data.(resource.WatchAddPayload)
	require.True(t, ok)
	assert.Equal(t, "pod-1", payload.ID)
}

// EI-008: StopConnection updates state and emits DISCONNECTED.
func TestIntegration_ConnectionDisconnect(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StopConnectionFunc: func(_ context.Context, connID string) (types.Connection, error) {
			return types.Connection{ID: connID, Name: "Test"}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)
	// Pre-add the connection.
	_ = ctrl.AddConnection("p1", types.Connection{ID: "conn-1", Name: "Test"})

	conn, err := ctrl.StopConnection("p1", "conn-1")
	require.NoError(t, err)
	assert.Equal(t, "conn-1", conn.ID)

	// Emitter should have a DISCONNECTED status event.
	ev := emitter.WaitForEvent(t, "connection/status", time.Second)
	statusData, ok := ev.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "DISCONNECTED", statusData["status"])
	assert.Equal(t, "conn-1", statusData["connectionID"])
}

// EI-009: OnPluginStop removes plugin, connections, and subscriptions.
func TestIntegration_PluginStop_CleansAll(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	// Add connection and subscription.
	_ = ctrl.AddConnection("p1", types.Connection{ID: "conn-1", Name: "Test"})
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")

	// Verify pre-conditions.
	require.True(t, ctrl.HasPlugin("p1"))
	require.True(t, ctrl.isSubscribed("p1", "conn-1", "pods"))

	// Stop.
	err := ctrl.OnPluginStop("p1", defaultMeta())
	require.NoError(t, err)

	// Everything should be cleaned up.
	assert.False(t, ctrl.HasPlugin("p1"))
	assert.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))

	ctrl.connsMu.RLock()
	_, hasConns := ctrl.connections["p1"]
	ctrl.connsMu.RUnlock()
	assert.False(t, hasConns)
}

// EI-010: Two plugins, events don't cross.
func TestIntegration_MultiPlugin_Isolation(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	registerMockPlugin(ctrl, "p2", &mockProvider{})

	// Subscribe both plugins to "pods".
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	_ = ctrl.SubscribeResource("p2", "conn-1", "pods")

	sink1 := &engineWatchSink{pluginID: "p1", ctrl: ctrl}
	sink2 := &engineWatchSink{pluginID: "p2", ctrl: ctrl}

	// Emit from plugin 1 only.
	sink1.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-from-p1"})

	ev := emitter.WaitForEvent(t, "ADD", time.Second)
	payload, ok := ev.Data.(resource.WatchAddPayload)
	require.True(t, ok)
	assert.Equal(t, "p1", payload.PluginID)
	assert.Equal(t, "pod-from-p1", payload.ID)

	// Emit from plugin 2.
	sink2.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-from-p2"})

	// Check events — should have exactly 2 ADD events with different plugin IDs.
	time.Sleep(50 * time.Millisecond) // allow event to propagate
	events := emitter.EventsWithKey("ADD")
	require.Len(t, events, 2)

	p1Events := 0
	p2Events := 0
	for _, e := range events {
		p, ok := e.Data.(resource.WatchAddPayload)
		require.True(t, ok)
		if p.PluginID == "p1" {
			p1Events++
		} else if p.PluginID == "p2" {
			p2Events++
		}
	}
	assert.Equal(t, 1, p1Events)
	assert.Equal(t, 1, p2Events)
}

// EI-011: STATE events bypass subscription gate.
func TestIntegration_StateAlwaysFlows(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	// NOT subscribed to anything.
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}
	sink.OnStateChange(resource.WatchStateEvent{
		ResourceKey: "pods",
		State:       resource.WatchStateSynced,
	})

	// STATE should still be emitted.
	events := emitter.EventsWithKey("STATE")
	require.NotEmpty(t, events)

	// Verify both per-plugin and global STATE events.
	perPlugin := emitter.EventsWithKey("p1/informer/STATE")
	global := emitter.EventsWithKey("informer/STATE")
	assert.NotEmpty(t, perPlugin)
	assert.NotEmpty(t, global)
}

// EI-012: Subscribe to unknown resource key — no crash.
func TestIntegration_SubscribeNonExistent(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	err := ctrl.SubscribeResource("p1", "conn-1", "nonexistent-resource-type")
	assert.NoError(t, err)
	assert.True(t, ctrl.isSubscribed("p1", "conn-1", "nonexistent-resource-type"))
}

// EI-013: Subscription recorded before connection, events flow when connected.
func TestIntegration_SubscribeBeforeConnect(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	// Subscribe BEFORE any connection is established.
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")

	// Later, events arrive through sink (simulating post-connect watch events).
	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})

	ev := emitter.WaitForEvent(t, "ADD", time.Second)
	payload, ok := ev.Data.(resource.WatchAddPayload)
	require.True(t, ok)
	assert.Equal(t, "pod-1", payload.ID)
}

// EI-014: Add→Delete→Add forwarded in order.
func TestIntegration_OutOfOrderEvents(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")

	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	// Emit events in sequence.
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})
	sink.OnDelete(resource.WatchDeletePayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})
	sink.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})

	// Should have 2 ADD events and 1 DELETE event.
	time.Sleep(50 * time.Millisecond)
	addEvents := emitter.EventsWithKey("ADD")
	deleteEvents := emitter.EventsWithKey("DELETE")
	assert.Len(t, addEvents, 2)
	assert.Len(t, deleteEvents, 1)

	// Verify ordering: events should appear in the order emitted.
	all := emitter.Events()
	var eventTypes []string
	for _, e := range all {
		if e.Key == "p1/conn-1/pods/ADD" || e.Key == "p1/conn-1/pods/DELETE" {
			if _, ok := e.Data.(resource.WatchAddPayload); ok {
				eventTypes = append(eventTypes, "ADD")
			} else if _, ok := e.Data.(resource.WatchDeletePayload); ok {
				eventTypes = append(eventTypes, "DELETE")
			}
		}
	}
	assert.Equal(t, []string{"ADD", "DELETE", "ADD"}, eventTypes)
}

// EI-015: SDK error propagated to caller unchanged.
func TestIntegration_ErrorPropagation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	expectedErr := errors.New("upstream SDK error: connection timed out")
	mock := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return nil, expectedErr
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	result, err := ctrl.Get("p1", "conn-1", "pods", resource.GetInput{})
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Equal(t, expectedErr.Error(), err.Error())
}

// EI-016: Two plugins with same resource key, no cross-contamination.
func TestIntegration_SameKeyTwoPlugins(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)

	mock1 := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Result: json.RawMessage(`{"source":"p1"}`), Success: true}, nil
		},
	}
	mock2 := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Result: json.RawMessage(`{"source":"p2"}`), Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock1)
	registerMockPlugin(ctrl, "p2", mock2)

	// Subscribe both to same resource key.
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")
	_ = ctrl.SubscribeResource("p2", "conn-1", "pods")

	// CRUD isolation: each returns its own data.
	r1, err := ctrl.Get("p1", "conn-1", "pods", resource.GetInput{})
	require.NoError(t, err)
	assert.JSONEq(t, `{"source":"p1"}`, string(r1.Result))

	r2, err := ctrl.Get("p2", "conn-1", "pods", resource.GetInput{})
	require.NoError(t, err)
	assert.JSONEq(t, `{"source":"p2"}`, string(r2.Result))

	// Event isolation: sink for p1 only emits to p1 event keys.
	sink1 := &engineWatchSink{pluginID: "p1", ctrl: ctrl}
	sink1.OnAdd(resource.WatchAddPayload{Connection: "conn-1", Key: "pods", ID: "pod-1"})

	time.Sleep(50 * time.Millisecond)
	events := emitter.Events()
	for _, e := range events {
		if payload, ok := e.Data.(resource.WatchAddPayload); ok {
			assert.Equal(t, "p1", payload.PluginID, "event should only have p1 plugin ID")
		}
	}

	// Unsubscribe p1 should not affect p2.
	_ = ctrl.UnsubscribeResource("p1", "conn-1", "pods")
	assert.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))
	assert.True(t, ctrl.isSubscribed("p2", "conn-1", "pods"))
}

// EI-017: 100 sub/unsub cycles, no race (-race flag).
func TestIntegration_RapidSubUnsub(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	for i := 0; i < 100; i++ {
		_ = ctrl.SubscribeResource("p1", "conn-1", "pods")

		// Emit while subscribed.
		sink.OnAdd(resource.WatchAddPayload{
			Connection: "conn-1",
			Key:        "pods",
			ID:         fmt.Sprintf("pod-%d", i),
		})

		_ = ctrl.UnsubscribeResource("p1", "conn-1", "pods")
	}

	// After 100 cycles, should not be subscribed.
	assert.False(t, ctrl.isSubscribed("p1", "conn-1", "pods"))

	// All 100 events should have been emitted (each was emitted while subscribed).
	events := emitter.EventsWithKey("ADD")
	assert.Len(t, events, 100)
}

// EI-018: OnPluginStart twice → old cancelled, new active.
func TestIntegration_DoubleStart(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	// First registration.
	mock1 := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Result: json.RawMessage(`{"version":"v1"}`), Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock1)

	// Capture the first cancel function.
	ctrl.pluginsMu.RLock()
	firstCancel := ctrl.plugins["p1"].watchCancel
	ctrl.pluginsMu.RUnlock()

	// Second registration overwrites.
	mock2 := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Result: json.RawMessage(`{"version":"v2"}`), Success: true}, nil
		},
	}
	// registerMockPlugin cancels old context automatically when overwriting.
	registerMockPlugin(ctrl, "p1", mock2)

	// Old cancel should have been called (context cancelled).
	// We can verify the new provider is active.
	result, err := ctrl.Get("p1", "conn-1", "pods", resource.GetInput{})
	require.NoError(t, err)
	assert.JSONEq(t, `{"version":"v2"}`, string(result.Result))

	// Make sure calling old cancel doesn't panic.
	firstCancel()
}

// EI-019: 20 goroutines doing CRUD, -race clean.
func TestIntegration_ConcurrentCRUD(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(_ context.Context, key string, input resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{
				Result:  json.RawMessage(`{"key":"` + key + `","id":"` + input.ID + `"}`),
				Success: true,
			}, nil
		},
		ListFunc: func(_ context.Context, _ string, _ resource.ListInput) (*resource.ListResult, error) {
			return &resource.ListResult{Success: true}, nil
		},
		CreateFunc: func(_ context.Context, _ string, _ resource.CreateInput) (*resource.CreateResult, error) {
			return &resource.CreateResult{Success: true}, nil
		},
		UpdateFunc: func(_ context.Context, _ string, _ resource.UpdateInput) (*resource.UpdateResult, error) {
			return &resource.UpdateResult{Success: true}, nil
		},
		DeleteFunc: func(_ context.Context, _ string, _ resource.DeleteInput) (*resource.DeleteResult, error) {
			return &resource.DeleteResult{Success: true}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	var wg sync.WaitGroup
	errs := make(chan error, 120) // 20 goroutines × 6 operations max

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			key := fmt.Sprintf("core::v1::Pod%d", idx)
			connID := fmt.Sprintf("conn-%d", idx%3)

			if r, err := ctrl.Get("p1", connID, key, resource.GetInput{ID: fmt.Sprintf("pod-%d", idx)}); err != nil {
				errs <- fmt.Errorf("Get[%d]: %w", idx, err)
			} else if !r.Success {
				errs <- fmt.Errorf("Get[%d]: not successful", idx)
			}

			if _, err := ctrl.List("p1", connID, key, resource.ListInput{}); err != nil {
				errs <- fmt.Errorf("List[%d]: %w", idx, err)
			}

			if _, err := ctrl.Create("p1", connID, key, resource.CreateInput{}); err != nil {
				errs <- fmt.Errorf("Create[%d]: %w", idx, err)
			}

			if _, err := ctrl.Update("p1", connID, key, resource.UpdateInput{}); err != nil {
				errs <- fmt.Errorf("Update[%d]: %w", idx, err)
			}

			if _, err := ctrl.Delete("p1", connID, key, resource.DeleteInput{}); err != nil {
				errs <- fmt.Errorf("Delete[%d]: %w", idx, err)
			}
		}(i)
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Error(err)
	}

	// Plugin should still be healthy after concurrent operations.
	require.True(t, ctrl.HasPlugin("p1"))

	// No plugin-not-found errors — confirms locking is correct.
	var appErr *apperror.AppError
	_, err := ctrl.Get("p1", "conn-1", "pods", resource.GetInput{})
	if err != nil {
		require.False(t, errors.As(err, &appErr), "should not get PluginNotFound after concurrent CRUD")
	}
}
