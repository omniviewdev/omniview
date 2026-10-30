package resource

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ============================================================================
// ListConnections
// ============================================================================

func TestListConnections_ReturnsFromMemory(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["test-plugin"] = []types.Connection{
		{ID: "b", Name: "Bravo"},
		{ID: "a", Name: "Alpha"},
	}

	result, err := ctrl.ListConnections(testInvocationContext(), "test-plugin")
	require.NoError(t, err)
	require.Len(t, result, 2)
	assert.Equal(t, "Alpha", result[0].Name)
	assert.Equal(t, "Bravo", result[1].Name)
}

func TestListConnections_EmptySlice(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["test-plugin"] = []types.Connection{}

	result, err := ctrl.ListConnections(testInvocationContext(), "test-plugin")
	require.NoError(t, err)
	assert.Empty(t, result)
}

func TestListConnections_BeforeConnectionsLoad(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)

	result, err := ctrl.ListConnections(testInvocationContext(), "test-plugin")
	require.NoError(t, err)
	require.NotNil(t, result, "the binding must receive [] rather than null")
	assert.Empty(t, result)

	// A read before initialization must not prevent later discovery.
	registerMockPlugin(ctrl, "test-plugin", &mockProvider{
		LoadConnectionsFunc: func(context.Context) ([]types.Connection, error) {
			return []types.Connection{{ID: "kind-kind", Name: "kind-kind"}}, nil
		},
	})
	_, err = ctrl.LoadConnections(testInvocationContext(), "test-plugin")
	require.NoError(t, err)

	result, err = ctrl.ListConnections(testInvocationContext(), "test-plugin")
	require.NoError(t, err)
	assert.Equal(t, []types.Connection{{ID: "kind-kind", Name: "kind-kind"}}, result)
}

// ============================================================================
// SaveConnectionProfile: new desired records
// ============================================================================

func TestSaveConnectionProfile_ThenList(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "plugin-a", connectionOverlayTestProvider())

	requireSavedConnectionProfile(t, ctrl, "plugin-a", types.Connection{ID: "conn-1", Name: "First"})
	requireSavedConnectionProfile(t, ctrl, "plugin-a", types.Connection{ID: "conn-2", Name: "Second"})

	result, err := ctrl.ListConnections(testInvocationContext(), "plugin-a")
	require.NoError(t, err)
	assert.Len(t, result, 2)
}

func TestSaveConnectionProfile_NewPlugin(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "new-plugin", connectionOverlayTestProvider())
	requireSavedConnectionProfile(t, ctrl, "new-plugin", types.Connection{ID: "conn-1", Name: "First"})

	result, err := ctrl.ListConnections(testInvocationContext(), "new-plugin")
	require.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "First", result[0].Name)
}

func TestSaveConnectionProfile_ConcurrentCreates(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", connectionOverlayTestProvider())

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "p1", types.Connection{ID: fmt.Sprintf("c%d", idx)})
			assert.NoError(t, err)
		}(i)
	}
	wg.Wait()

	ctrl.connsMu.RLock()
	assert.Len(t, ctrl.connections["p1"], 10)
	ctrl.connsMu.RUnlock()
}

// ============================================================================
// GetConnection
// ============================================================================

func TestGetConnection_Found(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{
		{ID: "c1", Name: "one"},
		{ID: "c2", Name: "two"},
	}

	conn, err := ctrl.GetConnection(testInvocationContext(), "p", "c2")
	require.NoError(t, err)
	assert.Equal(t, "two", conn.Name)
}

func TestGetConnection_NotFound(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{{ID: "c1", Name: "one"}}

	_, err := ctrl.GetConnection(testInvocationContext(), "p", "missing")
	require.Error(t, err)
}

// ============================================================================
// RemoveConnection
// ============================================================================

func TestRemoveConnection_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p", connectionOverlayTestProvider(types.Connection{ID: "c1", Name: "one"}, types.Connection{ID: "c2", Name: "two"}))
	_, err := ctrl.LoadConnections(testInvocationContext(), "p")
	require.NoError(t, err)

	require.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "p", "c1"))

	result, err := ctrl.ListConnections(testInvocationContext(), "p")
	require.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "c2", result[0].ID)
}

func TestRemoveConnection_NotFound(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p", connectionOverlayTestProvider(types.Connection{ID: "c1", Name: "one"}))

	err := ctrl.RemoveConnection(testInvocationContext(), "p", "missing")
	require.Error(t, err)
}

func TestRemoveConnection_LastConnection(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", connectionOverlayTestProvider(types.Connection{ID: "c1"}))
	_, err := ctrl.LoadConnections(testInvocationContext(), "p1")
	require.NoError(t, err)

	require.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "p1", "c1"))

	ctrl.connsMu.RLock()
	assert.Empty(t, ctrl.connections["p1"])
	ctrl.connsMu.RUnlock()
}

// ============================================================================
// SaveConnectionProfile: edits and overrides
// ============================================================================

func TestSaveConnectionProfile_UpdatesExisting(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p", connectionOverlayTestProvider(types.Connection{ID: "c1", Name: "old-name"}))

	updated := requireSavedConnectionProfile(t, ctrl, "p", types.Connection{ID: "c1", Name: "new-name"})
	require.NotNil(t, updated.Profile.Connection)
	assert.Equal(t, "new-name", updated.Profile.Connection.Name)
	assert.Equal(t, "override", updated.Profile.Source)

	conn, err := ctrl.GetConnection(testInvocationContext(), "p", "c1")
	require.NoError(t, err)
	assert.Equal(t, "new-name", conn.Name)
}

func TestSaveConnectionProfile_CreatesMissingManualProfile(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p", connectionOverlayTestProvider(types.Connection{ID: "c1", Name: "one"}))

	result := requireSavedConnectionProfile(t, ctrl, "p", types.Connection{ID: "missing", Name: "x"})
	assert.Equal(t, "manual", result.Profile.Source)
	connection, err := ctrl.GetConnection(testInvocationContext(), "p", "missing")
	require.NoError(t, err)
	assert.Equal(t, "x", connection.Name)
}

func TestSaveConnectionProfile_ConcurrentUpdates(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", connectionOverlayTestProvider(types.Connection{ID: "c1", Name: "initial"}))

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "p1", types.Connection{ID: "c1", Name: "updated"})
			assert.NoError(t, err)
		}()
	}
	wg.Wait()

	conn, err := ctrl.GetConnection(testInvocationContext(), "p1", "c1")
	require.NoError(t, err)
	assert.Equal(t, "updated", conn.Name)
}

// ============================================================================
// StartConnection (with provider delegation)
// ============================================================================

func TestStartConnection_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
			return resource.Catalog{Provider: "connections", Revision: "inventory", Types: []resource.ResourceType{}, Coverage: resource.Coverage{Kind: "complete", Paths: []string{}}}, nil
		},
		StartConnectionFunc: func(_ context.Context, id string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{
				Status:     types.ConnectionStatusConnected,
				Connection: &types.Connection{ID: id, Name: "MyCluster"},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	cs, err := ctrl.StartConnection(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	assert.Equal(t, types.ConnectionStatusConnected, cs.Status)
}

func TestStartConnection_EmitsStatusEvent(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StartConnectionFunc: func(_ context.Context, id string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{
				Status:     types.ConnectionStatusConnected,
				Connection: &types.Connection{ID: id, Name: "MyCluster"},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, _ = ctrl.StartConnection(testInvocationContext(), "p1", "conn-1")

	events := emitter.EventsWithKey("connection/status")
	require.NotEmpty(t, events)
	payload, ok := events[0].Data[0].(ConnectionStatusPayload)
	require.True(t, ok)
	assert.Equal(t, "p1", payload.PluginID)
	assert.Equal(t, "conn-1", payload.ConnectionID)
}

func TestStartConnection_FailedConnection(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StartConnectionFunc: func(_ context.Context, _ string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{}, errors.New("auth failed")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.StartConnection(testInvocationContext(), "p1", "conn-1")
	assert.Error(t, err)
}

// ============================================================================
// StopConnection (with provider delegation)
// ============================================================================

func TestStopConnection_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StopConnectionFunc: func(_ context.Context, id string) (types.Connection, error) {
			return types.Connection{ID: id, Name: "MyCluster"}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	conn, err := ctrl.StopConnection(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	assert.Equal(t, "conn-1", conn.ID)
}

func TestStopConnection_EmitsDisconnected(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StopConnectionFunc: func(_ context.Context, id string) (types.Connection, error) {
			return types.Connection{ID: id, Name: "MyCluster"}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, _ = ctrl.StopConnection(testInvocationContext(), "p1", "conn-1")

	events := emitter.EventsWithKey("connection/status")
	require.NotEmpty(t, events)
	payload, ok := events[0].Data[0].(ConnectionStatusPayload)
	require.True(t, ok)
	assert.Equal(t, "DISCONNECTED", payload.Status)
}

// ============================================================================
// LoadConnections (with provider delegation)
// ============================================================================

func TestLoadConnections_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		LoadConnectionsFunc: func(_ context.Context) ([]types.Connection, error) {
			return []types.Connection{{ID: "c1"}, {ID: "c2"}}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	conns, err := ctrl.LoadConnections(testInvocationContext(), "p1")
	require.NoError(t, err)
	assert.Len(t, conns, 2)
}

func TestLoadConnections_EmptyReturn(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		LoadConnectionsFunc: func(_ context.Context) ([]types.Connection, error) {
			return nil, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	conns, err := ctrl.LoadConnections(testInvocationContext(), "p1")
	require.NoError(t, err)
	assert.Empty(t, conns)
}

// ============================================================================
// ListAllConnections
// ============================================================================

func TestListAllConnections_ReturnsCopy(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	ctrl.connsMu.Lock()
	ctrl.connections["p1"] = []types.Connection{{ID: "c1"}}
	ctrl.connsMu.Unlock()

	result, err := ctrl.ListAllConnections(testInvocationContext())
	require.NoError(t, err)

	// Map key mutation should not affect internal state.
	result["p1"] = nil

	ctrl.connsMu.RLock()
	assert.Len(t, ctrl.connections["p1"], 1)
	ctrl.connsMu.RUnlock()
}

func TestListAllConnections_ReturnsSliceCopy(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	ctrl.connsMu.Lock()
	ctrl.connections["p1"] = []types.Connection{
		{ID: "c1", Name: "Bravo"},
		{ID: "c2", Name: "Alpha"},
	}
	ctrl.connsMu.Unlock()

	result, err := ctrl.ListAllConnections(testInvocationContext())
	require.NoError(t, err)

	// Sorting the returned slice must not mutate internal state.
	slices.SortFunc(result["p1"], func(a, b types.Connection) int {
		return cmp.Compare(a.Name, b.Name)
	})

	// Internal order should be unchanged (Bravo first).
	ctrl.connsMu.RLock()
	assert.Equal(t, "Bravo", ctrl.connections["p1"][0].Name)
	ctrl.connsMu.RUnlock()
}

func TestListAllConnections_MultiplePlugins(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	registerMockPlugin(ctrl, "p2", &mockProvider{})
	ctrl.connsMu.Lock()
	ctrl.connections["p1"] = []types.Connection{{ID: "c1"}}
	ctrl.connections["p2"] = []types.Connection{{ID: "c2"}, {ID: "c3"}}
	ctrl.connsMu.Unlock()

	result, err := ctrl.ListAllConnections(testInvocationContext())
	require.NoError(t, err)
	assert.Len(t, result["p1"], 1)
	assert.Len(t, result["p2"], 2)
}

// ============================================================================
// ScopeValues
// ============================================================================

func TestScopeValues_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ScopeValuesFunc: func(_ context.Context, route resource.AccessRoute, dimension string) ([]string, error) {
			assert.Equal(t, "conn-1", route.Connection)
			assert.Equal(t, "namespace", dimension)
			return []string{"default", "kube-system"}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	ns, err := ctrl.ScopeValues(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "namespace")
	require.NoError(t, err)
	assert.Contains(t, ns, "default")
	assert.Contains(t, ns, "kube-system")
}

func TestScopeValues_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		ScopeValuesFunc: func(_ context.Context, _ resource.AccessRoute, _ string) ([]string, error) {
			return nil, errors.New("ns error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.ScopeValues(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "namespace")
	assert.Error(t, err)
}

func TestCatalogOnlyConnectionOperationsAreExplicitlyUnsupported(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "catalog-only", &catalogOnlyProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		catalog := canonicalTestCatalog("proof", "pods")
		catalog.Types[0].Capabilities = nil
		return catalog, nil
	}})
	for name, call := range map[string]func() error{
		"load": func() error { _, err := ctrl.LoadConnections(testInvocationContext(), "catalog-only"); return err },
		"start": func() error {
			_, err := ctrl.StartConnection(testInvocationContext(), "catalog-only", "explicit")
			return err
		},
		"stop": func() error {
			_, err := ctrl.StopConnection(testInvocationContext(), "catalog-only", "explicit")
			return err
		},
		"check": func() error {
			_, err := ctrl.CheckConnection(testInvocationContext(), "catalog-only", "explicit")
			return err
		},
		"scope": func() error {
			_, err := ctrl.ScopeValues(testInvocationContext(), "catalog-only", resource.AccessRoute{Connection: "explicit"}, "namespace")
			return err
		},
		"save-profile": func() error {
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "catalog-only", types.Connection{ID: "explicit"})
			return err
		},
		"remove-profile": func() error { return ctrl.RemoveConnection(testInvocationContext(), "catalog-only", "explicit") },
		"reset-profile": func() error {
			_, err := ctrl.ResetConnectionProfile(testInvocationContext(), "catalog-only", "explicit")
			return err
		},
	} {
		t.Run(name, func(t *testing.T) { require.Equal(t, "UNSUPPORTED", requireAppError(t, call()).Code) })
	}
}

// ============================================================================
// Full round-trip
// ============================================================================

func TestConnectionLifecycle_FullRoundTrip(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", connectionOverlayTestProvider())

	requireSavedConnectionProfile(t, ctrl, "p1", types.Connection{ID: "c1", Name: "Test"})

	conns, err := ctrl.ListConnections(testInvocationContext(), "p1")
	require.NoError(t, err)
	require.Len(t, conns, 1)

	updated := requireSavedConnectionProfile(t, ctrl, "p1", types.Connection{ID: "c1", Name: "Updated"})
	require.NotNil(t, updated.Profile.Connection)
	assert.Equal(t, "Updated", updated.Profile.Connection.Name)

	got, err := ctrl.GetConnection(testInvocationContext(), "p1", "c1")
	require.NoError(t, err)
	assert.Equal(t, "Updated", got.Name)

	require.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "p1", "c1"))

	conns, err = ctrl.ListConnections(testInvocationContext(), "p1")
	require.NoError(t, err)
	assert.Empty(t, conns)
}

func requireSavedConnectionProfile(t *testing.T, ctrl *controller, pluginID string, connection types.Connection) ConnectionProfileResult {
	t.Helper()
	result, err := ctrl.SaveConnectionProfile(testInvocationContext(), pluginID, connection)
	require.NoError(t, err)
	require.True(t, result.Applied)
	require.True(t, result.Profile.Active)
	require.NotNil(t, result.Profile.Connection)
	require.Equal(t, connection.ID, result.Profile.Connection.ID)
	return result
}
