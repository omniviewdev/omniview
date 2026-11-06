package resource

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ============================================================================
// Concurrent finite operations (20 goroutines)
// ============================================================================

func TestConcurrent_FiniteOperations_20Goroutines(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	resourceTypes := make([]string, 20)
	for i := range resourceTypes {
		resourceTypes[i] = fmt.Sprintf("core::v1::Pod%d", i)
	}
	mock := &mockProvider{
		CatalogFunc: lifecycleTestCatalog(resourceTypes...),
		GetFunc: func(_ context.Context, request resource.GetRequest) (resource.Record, error) {
			record := canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID)
			return record, nil
		},
		EnumerateFunc: func(_ context.Context, request resource.EnumerateRequest) (resource.SourcePage, error) {
			return resource.SourcePage{Records: []resource.Record{}, Count: resource.Count{Kind: "unknown"}, Coverage: resource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}, nil
		},
		MutateFunc: func(_ context.Context, request resource.MutationRequest) (resource.Record, error) {
			return canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID), nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			key := fmt.Sprintf("core::v1::Pod%d", idx)

			request := admittedGetRequest(t, ctrl, "p1", "conn-1", key, "opaque")
			result, err := ctrl.Get(testInvocationContext(), "p1", request)
			assert.NoError(t, err)
			assert.Equal(t, request.Request.Reference, result.Record.Reference)

			target := admittedReadTarget(t, ctrl, "p1", "conn-1", key)
			_, err = ctrl.Enumerate(testInvocationContext(), "p1", HostEnumerateRequest{TargetID: target.TargetID, Request: resource.EnumerateRequest{Target: target.Target, PageSize: 20}})
			assert.NoError(t, err)

			_, err = ctrl.Mutate(testInvocationContext(), "p1", resource.MutationRequest{Route: request.Request.Route, Reference: request.Request.Reference, Operation: "create", Input: resource.Value{Kind: "null"}})
			assert.NoError(t, err)
		}(i)
	}
	wg.Wait()
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
			{
				present, err := ctrl.HasPlugin(testInvocationContext(), pluginID)
				assert.NoError(t, err)
				assert.True(t, present)
			}

			// Simulate stop by removing.
			ctrl.pluginsMu.Lock()
			if ps, ok := ctrl.plugins[pluginID]; ok {
				ps.cancel()
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
	registerMockPlugin(ctrl, "p1", connectionOverlayTestProvider())

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			conn := types.Connection{
				ID:   fmt.Sprintf("conn-%d", idx),
				Name: fmt.Sprintf("Connection %d", idx),
			}

			// Create explicit desired configuration.
			saved, err := ctrl.SaveConnectionProfile(testInvocationContext(), "p1", conn, nil)
			assert.NoError(t, err)
			assert.True(t, saved.Applied)

			// Edit the same desired profile.
			conn.Name = fmt.Sprintf("Updated Connection %d", idx)
			updated, err := ctrl.SaveConnectionProfile(testInvocationContext(), "p1", conn, nil)
			assert.NoError(t, err)
			assert.True(t, updated.Applied)

			// List
			_, _ = ctrl.ListConnections(testInvocationContext(), "p1")

			// Remove
			assert.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "p1", conn.ID))
		}(i)
	}
	wg.Wait()
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
					ps.cancel()
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
				plugins, err := ctrl.ListPlugins(testInvocationContext())
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
					ps.cancel()
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
				_, _ = ctrl.HasPlugin(testInvocationContext(), "p-volatile")
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
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: lifecycleTestCatalog("pods")})

	var wg sync.WaitGroup

	// Goroutines reading the provider.
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				provider, err := ctrl.getProvider("p1")
				if err == nil && provider != nil {
					_, _ = provider.Catalog(context.Background(), resource.CatalogRequest{Route: resource.AccessRoute{Connection: "conn-1"}})
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
			ps.cancel()
		}
		delete(ctrl.plugins, "p1")
		ctrl.pluginsMu.Unlock()
	}()

	wg.Wait()
}

// ============================================================================
// Concurrent Mixed Ops Stress Test (50 goroutines)
// ============================================================================

func TestConcurrent_MixedOps_StressTest(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		CatalogFunc: lifecycleTestCatalog("pods", "type-0", "type-1", "type-2"),
		GetFunc: func(_ context.Context, request resource.GetRequest) (resource.Record, error) {
			return canonicalTestRecord(request.Reference.Address.Provider, request.Reference.Address.Authority, request.Reference.Address.Type, request.Reference.Address.ID), nil
		},
		EnumerateFunc: func(_ context.Context, _ resource.EnumerateRequest) (resource.SourcePage, error) {
			return resource.SourcePage{Records: []resource.Record{}, Count: resource.Count{Kind: "unknown"}, Coverage: resource.Coverage{Kind: "complete"}, Consistency: "bestEffort"}, nil
		},
		GetResourceGroupsFunc: func(_ context.Context, _ resource.AccessRoute) ([]resource.ResourceGroup, error) {
			return []resource.ResourceGroup{{ID: "core"}}, nil
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
				_, _ = ctrl.Get(testInvocationContext(), "p1", admittedGetRequest(t, ctrl, "p1", connID, key, "opaque"))
			case 1:
				target := admittedReadTarget(t, ctrl, "p1", connID, key)
				_, _ = ctrl.Enumerate(testInvocationContext(), "p1", HostEnumerateRequest{TargetID: target.TargetID, Request: resource.EnumerateRequest{Target: target.Target, PageSize: 20}})
			case 2, 3:
				_, _ = ctrl.GetSourceStates(testInvocationContext(), "p1", resource.AccessRoute{Connection: connID})
			case 4:
				_, _ = ctrl.SaveConnectionProfile(testInvocationContext(), "p1", types.Connection{
					ID:   fmt.Sprintf("new-conn-%d", idx),
					Name: fmt.Sprintf("New Connection %d", idx),
				}, nil)
			case 5:
				_, _ = ctrl.ListConnections(testInvocationContext(), "p1")
			case 6, 7:
				_, _ = ctrl.Catalog(testInvocationContext(), "p1", resource.CatalogRequest{Route: resource.AccessRoute{Connection: connID}})
			case 8:
				_, _ = ctrl.GetResourceGroups(testInvocationContext(), "p1", resource.AccessRoute{Connection: connID})
			case 9:
				_, _ = ctrl.Catalog(testInvocationContext(), "p1", resource.CatalogRequest{Route: resource.AccessRoute{Connection: connID}})
			}
		}(i)
	}
	wg.Wait()

	// Basic sanity: plugin still registered and responding.
	{
		present, err := ctrl.HasPlugin(testInvocationContext(), "p1")
		require.NoError(t, err)
		require.True(t, present)
	}
	plugins, err := ctrl.ListPlugins(testInvocationContext())
	require.NoError(t, err)
	assert.Contains(t, plugins, "p1")
}
