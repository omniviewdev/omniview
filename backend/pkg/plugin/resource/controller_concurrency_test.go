package resource

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ============================================================================
// Concurrent CRUD (20 goroutines)
// ============================================================================

func TestConcurrent_CRUD_20Goroutines(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(_ context.Context, key string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Result: json.RawMessage(`{"key":"` + key + `"}`), Success: true}, nil
		},
		ListFunc: func(_ context.Context, key string, _ resource.ListInput) (*resource.ListResult, error) {
			return &resource.ListResult{}, nil
		},
		CreateFunc: func(_ context.Context, key string, _ resource.CreateInput) (*resource.CreateResult, error) {
			return &resource.CreateResult{}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			key := fmt.Sprintf("core::v1::Pod%d", idx)

			result, err := ctrl.Get("p1", "conn-1", key, resource.GetInput{})
			assert.NoError(t, err)
			assert.NotNil(t, result)

			_, err = ctrl.List("p1", "conn-1", key, resource.ListInput{})
			assert.NoError(t, err)

			_, err = ctrl.Create("p1", "conn-1", key, resource.CreateInput{})
			assert.NoError(t, err)
		}(i)
	}
	wg.Wait()
}

// ============================================================================
// Concurrent Subscribe/Unsubscribe (100 cycles, 10 goroutines)
// ============================================================================

func TestConcurrent_SubscribeUnsubscribe_100Cycles(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	var wg sync.WaitGroup
	for g := 0; g < 10; g++ {
		wg.Add(1)
		go func(gID int) {
			defer wg.Done()
			key := fmt.Sprintf("type-%d", gID)
			for i := 0; i < 100; i++ {
				_ = ctrl.SubscribeResource("p1", "conn-1", key)
				_ = ctrl.UnsubscribeResource("p1", "conn-1", key)
			}
		}(g)
	}
	wg.Wait()
	// After equal sub/unsub, nothing should remain subscribed.
	for g := 0; g < 10; g++ {
		assert.False(t, ctrl.isSubscribed("p1", "conn-1", fmt.Sprintf("type-%d", g)))
	}
}

// ============================================================================
// Concurrent Plugin Start/Stop
// ============================================================================

func TestConcurrent_PluginStartStop(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			pluginID := fmt.Sprintf("plugin-%d", idx)
			// Register directly to avoid needing a real backend.
			registerMockPlugin(ctrl, pluginID, &mockProvider{
				LoadConnectionsFunc: func(_ context.Context) ([]types.Connection, error) {
					return nil, nil
				},
			})

			// Verify we can query the plugin.
			assert.True(t, ctrl.HasPlugin(pluginID))

			// Simulate stop by removing.
			ctrl.pluginsMu.Lock()
			if ps, ok := ctrl.plugins[pluginID]; ok {
				ps.watchCancel()
			}
			delete(ctrl.plugins, pluginID)
			ctrl.pluginsMu.Unlock()
		}(i)
	}
	wg.Wait()
}

// ============================================================================
// Concurrent Connection Ops
// ============================================================================

func TestConcurrent_ConnectionOps(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			conn := types.Connection{
				ID:   fmt.Sprintf("conn-%d", idx),
				Name: fmt.Sprintf("Connection %d", idx),
			}

			// Add
			err := ctrl.AddConnection("p1", conn)
			assert.NoError(t, err)

			// Update
			conn.Name = fmt.Sprintf("Updated Connection %d", idx)
			_, _ = ctrl.UpdateConnection("p1", conn)

			// List
			_, _ = ctrl.ListConnections("p1")

			// Remove
			_ = ctrl.RemoveConnection("p1", conn.ID)
		}(i)
	}
	wg.Wait()
}

// ============================================================================
// Concurrent Sink Emission (50 goroutines)
// ============================================================================

func TestConcurrent_SinkEmission(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	_ = ctrl.SubscribeResource("p1", "conn-1", "pods")

	sink := &engineWatchSink{pluginID: "p1", ctrl: ctrl}

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sink.OnAdd(resource.WatchAddPayload{
				Connection: "conn-1",
				Key:        "pods",
				ID:         fmt.Sprintf("pod-%d", idx),
			})
		}(i)
	}
	wg.Wait()

	// All 50 events should have been emitted.
	events := emitter.EventsWithKey("ADD")
	assert.Len(t, events, 50)
}

// ============================================================================
// Concurrent ListPlugins During Start/Stop
// ============================================================================

func TestConcurrent_ListPlugins_DuringStartStop(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var wg sync.WaitGroup

	// 5 goroutines adding/removing plugins.
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			pluginID := fmt.Sprintf("plugin-%d", idx)
			for j := 0; j < 20; j++ {
				registerMockPlugin(ctrl, pluginID, &mockProvider{})
				ctrl.pluginsMu.Lock()
				if ps, ok := ctrl.plugins[pluginID]; ok {
					ps.watchCancel()
				}
				delete(ctrl.plugins, pluginID)
				ctrl.pluginsMu.Unlock()
			}
		}(i)
	}

	// 5 goroutines listing plugins concurrently.
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				plugins, err := ctrl.ListPlugins()
				assert.NoError(t, err)
				_ = plugins
			}
		}()
	}

	wg.Wait()
}

// ============================================================================
// Concurrent HasPlugin During Start/Stop
// ============================================================================

func TestConcurrent_HasPlugin_DuringStartStop(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	var wg sync.WaitGroup

	// Goroutines registering/removing a plugin.
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				registerMockPlugin(ctrl, "p-volatile", &mockProvider{})
				ctrl.pluginsMu.Lock()
				if ps, ok := ctrl.plugins["p-volatile"]; ok {
					ps.watchCancel()
				}
				delete(ctrl.plugins, "p-volatile")
				ctrl.pluginsMu.Unlock()
			}
		}()
	}

	// Goroutines checking HasPlugin.
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				_ = ctrl.HasPlugin("p-volatile")
			}
		}()
	}

	wg.Wait()
}

// ============================================================================
// Concurrent GetProvider During Stop
// ============================================================================

func TestConcurrent_GetProvider_DuringStop(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{}, nil
		},
	})

	var wg sync.WaitGroup

	// Goroutines reading the provider.
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				provider, err := ctrl.getProvider("p1")
				if err == nil && provider != nil {
					_, _ = provider.Get(context.Background(), "pods", resource.GetInput{})
				}
			}
		}()
	}

	// One goroutine removing the plugin midway.
	wg.Add(1)
	go func() {
		defer wg.Done()
		ctrl.pluginsMu.Lock()
		if ps, ok := ctrl.plugins["p1"]; ok {
			ps.watchCancel()
		}
		delete(ctrl.plugins, "p1")
		ctrl.pluginsMu.Unlock()
	}()

	wg.Wait()
}

// ============================================================================
// Concurrent Watch Ops
// ============================================================================

func TestConcurrent_WatchOps(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StartConnectionWatchFunc: func(_ context.Context, _ string) error {
			return nil
		},
		StopConnectionWatchFunc: func(_ context.Context, _ string) error {
			return nil
		},
		EnsureResourceWatchFunc: func(_ context.Context, _, _ string) error {
			return nil
		},
		RestartResourceWatchFunc: func(_ context.Context, _, _ string) error {
			return nil
		},
		IsResourceWatchRunningFunc: func(_ context.Context, _, _ string) (bool, error) {
			return true, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	var wg sync.WaitGroup
	ops := []func(){
		func() { _ = ctrl.StartConnectionWatch("p1", "conn-1") },
		func() { _ = ctrl.StopConnectionWatch("p1", "conn-1") },
		func() { _ = ctrl.EnsureResourceWatch("p1", "conn-1", "pods") },
		func() { _ = ctrl.StopResourceWatch("p1", "conn-1", "pods") },
		func() { _ = ctrl.RestartResourceWatch("p1", "conn-1", "pods") },
		func() {
			_, _ = ctrl.IsResourceWatchRunning("p1", "conn-1", "pods")
		},
	}

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				op := ops[rand.Intn(len(ops))]
				op()
			}
		}()
	}
	wg.Wait()
}

// ============================================================================
// Concurrent Mixed Ops Stress Test (50 goroutines)
// ============================================================================

func TestConcurrent_MixedOps_StressTest(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetFunc: func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{}, nil
		},
		ListFunc: func(_ context.Context, _ string, _ resource.ListInput) (*resource.ListResult, error) {
			return &resource.ListResult{}, nil
		},
		StartConnectionWatchFunc: func(_ context.Context, _ string) error {
			return nil
		},
		StopConnectionWatchFunc: func(_ context.Context, _ string) error {
			return nil
		},
		EnsureResourceWatchFunc: func(_ context.Context, _, _ string) error {
			return nil
		},
		GetResourceGroupsFunc: func(_ context.Context, _ string) map[string]resource.ResourceGroup {
			return map[string]resource.ResourceGroup{"core": {ID: "core"}}
		},
		HasResourceTypeFunc: func(_ context.Context, _ string) bool {
			return true
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			connID := fmt.Sprintf("conn-%d", idx%5)
			key := fmt.Sprintf("type-%d", idx%3)

			switch idx % 10 {
			case 0:
				_, _ = ctrl.Get("p1", connID, key, resource.GetInput{})
			case 1:
				_, _ = ctrl.List("p1", connID, key, resource.ListInput{})
			case 2:
				_ = ctrl.SubscribeResource("p1", connID, key)
			case 3:
				_ = ctrl.UnsubscribeResource("p1", connID, key)
			case 4:
				_ = ctrl.AddConnection("p1", types.Connection{
					ID:   fmt.Sprintf("new-conn-%d", idx),
					Name: fmt.Sprintf("New Connection %d", idx),
				})
			case 5:
				_, _ = ctrl.ListConnections("p1")
			case 6:
				_ = ctrl.StartConnectionWatch("p1", connID)
			case 7:
				_ = ctrl.EnsureResourceWatch("p1", connID, key)
			case 8:
				_ = ctrl.GetResourceGroups("p1", connID)
			case 9:
				_ = ctrl.HasResourceType("p1", key)
			}
		}(i)
	}
	wg.Wait()

	// Basic sanity: plugin still registered and responding.
	require.True(t, ctrl.HasPlugin("p1"))
	plugins, err := ctrl.ListPlugins()
	require.NoError(t, err)
	assert.Contains(t, plugins, "p1")
}
