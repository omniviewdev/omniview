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

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ============================================================================
// mergeConnections
// ============================================================================

func TestMergeConnections_Empty(t *testing.T) {
	result := mergeConnections(nil, nil)
	assert.Empty(t, result)
}

func TestMergeConnections_NoOverlap(t *testing.T) {
	a := []types.Connection{{ID: "a", Name: "Alpha"}}
	b := []types.Connection{{ID: "b", Name: "Bravo"}}
	result := mergeConnections(a, b)
	assert.Len(t, result, 2)
}

func TestMergeConnections_Deduplicates(t *testing.T) {
	existing := []types.Connection{
		{ID: "ctx-1", Name: "old-name"},
		{ID: "ctx-2", Name: "keep"},
	}
	incoming := []types.Connection{
		{ID: "ctx-1", Name: "new-name"},
		{ID: "ctx-3", Name: "brand-new"},
	}
	result := mergeConnections(existing, incoming)
	assert.Len(t, result, 3)

	byID := make(map[string]types.Connection)
	for _, c := range result {
		byID[c.ID] = c
	}
	assert.Equal(t, "new-name", byID["ctx-1"].Name, "newer connection should win")
	assert.Equal(t, "keep", byID["ctx-2"].Name)
	assert.Equal(t, "brand-new", byID["ctx-3"].Name)
}

// ============================================================================
// ListConnections
// ============================================================================

func TestListConnections_ReturnsFromMemory(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["test-plugin"] = []types.Connection{
		{ID: "b", Name: "Bravo"},
		{ID: "a", Name: "Alpha"},
	}

	result, err := ctrl.ListConnections("test-plugin")
	require.NoError(t, err)
	require.Len(t, result, 2)
	assert.Equal(t, "Alpha", result[0].Name)
	assert.Equal(t, "Bravo", result[1].Name)
}

func TestListConnections_EmptySlice(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["test-plugin"] = []types.Connection{}

	result, err := ctrl.ListConnections("test-plugin")
	require.NoError(t, err)
	assert.Empty(t, result)
}

// ============================================================================
// AddConnection
// ============================================================================

func TestAddConnection_ThenList(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["plugin-a"] = []types.Connection{}

	require.NoError(t, ctrl.AddConnection("plugin-a", types.Connection{ID: "conn-1", Name: "First"}))
	require.NoError(t, ctrl.AddConnection("plugin-a", types.Connection{ID: "conn-2", Name: "Second"}))

	result, err := ctrl.ListConnections("plugin-a")
	require.NoError(t, err)
	assert.Len(t, result, 2)
}

func TestAddConnection_NewPlugin(t *testing.T) {
	ctrl := newTestController()
	require.NoError(t, ctrl.AddConnection("new-plugin", types.Connection{ID: "conn-1", Name: "First"}))

	result, err := ctrl.ListConnections("new-plugin")
	require.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "First", result[0].Name)
}

func TestAddConnection_ConcurrentSafe(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_ = ctrl.AddConnection("p1", types.Connection{ID: fmt.Sprintf("c%d", idx)})
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

	conn, err := ctrl.GetConnection("p", "c2")
	require.NoError(t, err)
	assert.Equal(t, "two", conn.Name)
}

func TestGetConnection_NotFound(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{{ID: "c1", Name: "one"}}

	_, err := ctrl.GetConnection("p", "missing")
	require.Error(t, err)
}

// ============================================================================
// RemoveConnection
// ============================================================================

func TestRemoveConnection_Success(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{
		{ID: "c1", Name: "one"},
		{ID: "c2", Name: "two"},
	}

	require.NoError(t, ctrl.RemoveConnection("p", "c1"))

	result, err := ctrl.ListConnections("p")
	require.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "c2", result[0].ID)
}

func TestRemoveConnection_NotFound(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{{ID: "c1", Name: "one"}}

	err := ctrl.RemoveConnection("p", "missing")
	require.Error(t, err)
}

func TestRemoveConnection_LastConnection(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	ctrl.connsMu.Lock()
	ctrl.connections["p1"] = []types.Connection{{ID: "c1"}}
	ctrl.connsMu.Unlock()

	require.NoError(t, ctrl.RemoveConnection("p1", "c1"))

	ctrl.connsMu.RLock()
	assert.Empty(t, ctrl.connections["p1"])
	ctrl.connsMu.RUnlock()
}

// ============================================================================
// UpdateConnection
// ============================================================================

func TestUpdateConnection_Success(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{{ID: "c1", Name: "old-name"}}

	updated, err := ctrl.UpdateConnection("p", types.Connection{ID: "c1", Name: "new-name"})
	require.NoError(t, err)
	assert.Equal(t, "new-name", updated.Name)

	conn, err := ctrl.GetConnection("p", "c1")
	require.NoError(t, err)
	assert.Equal(t, "new-name", conn.Name)
}

func TestUpdateConnection_NotFound(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{{ID: "c1", Name: "one"}}

	_, err := ctrl.UpdateConnection("p", types.Connection{ID: "missing", Name: "x"})
	require.Error(t, err)
}

func TestUpdateConnection_ConcurrentSafe(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})
	ctrl.connsMu.Lock()
	ctrl.connections["p1"] = []types.Connection{{ID: "c1", Name: "initial"}}
	ctrl.connsMu.Unlock()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = ctrl.UpdateConnection("p1", types.Connection{ID: "c1", Name: "updated"})
		}()
	}
	wg.Wait()

	conn, err := ctrl.GetConnection("p1", "c1")
	require.NoError(t, err)
	assert.Equal(t, "updated", conn.Name)
}

// ============================================================================
// StartConnection (with provider delegation)
// ============================================================================

func TestStartConnection_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StartConnectionFunc: func(_ context.Context, id string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{
				Status:     types.ConnectionStatusConnected,
				Connection: &types.Connection{ID: id, Name: "MyCluster"},
			}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	cs, err := ctrl.StartConnection("p1", "conn-1")
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

	_, _ = ctrl.StartConnection("p1", "conn-1")

	events := emitter.EventsWithKey("connection/status")
	require.NotEmpty(t, events)
	data, ok := events[0].Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "p1", data["pluginID"])
	assert.Equal(t, "conn-1", data["connectionID"])
}

func TestStartConnection_FailedConnection(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		StartConnectionFunc: func(_ context.Context, _ string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{}, errors.New("auth failed")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.StartConnection("p1", "conn-1")
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

	conn, err := ctrl.StopConnection("p1", "conn-1")
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

	_, _ = ctrl.StopConnection("p1", "conn-1")

	events := emitter.EventsWithKey("connection/status")
	require.NotEmpty(t, events)
	data, ok := events[0].Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "DISCONNECTED", data["status"])
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

	conns, err := ctrl.LoadConnections("p1")
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

	conns, err := ctrl.LoadConnections("p1")
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

	result, err := ctrl.ListAllConnections()
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

	result, err := ctrl.ListAllConnections()
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

	result, err := ctrl.ListAllConnections()
	require.NoError(t, err)
	assert.Len(t, result["p1"], 1)
	assert.Len(t, result["p2"], 2)
}

// ============================================================================
// GetConnectionNamespaces
// ============================================================================

func TestGetConnectionNamespaces_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetConnectionNamespacesFunc: func(_ context.Context, _ string) ([]string, error) {
			return []string{"default", "kube-system"}, nil
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	ns, err := ctrl.GetConnectionNamespaces("p1", "conn-1")
	require.NoError(t, err)
	assert.Contains(t, ns, "default")
	assert.Contains(t, ns, "kube-system")
}

func TestGetConnectionNamespaces_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{
		GetConnectionNamespacesFunc: func(_ context.Context, _ string) ([]string, error) {
			return nil, errors.New("ns error")
		},
	}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetConnectionNamespaces("p1", "conn-1")
	assert.Error(t, err)
}

// ============================================================================
// Full round-trip
// ============================================================================

func TestConnectionLifecycle_FullRoundTrip(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{})

	require.NoError(t, ctrl.AddConnection("p1", types.Connection{ID: "c1", Name: "Test"}))

	conns, err := ctrl.ListConnections("p1")
	require.NoError(t, err)
	require.Len(t, conns, 1)

	updated, err := ctrl.UpdateConnection("p1", types.Connection{ID: "c1", Name: "Updated"})
	require.NoError(t, err)
	assert.Equal(t, "Updated", updated.Name)

	got, err := ctrl.GetConnection("p1", "c1")
	require.NoError(t, err)
	assert.Equal(t, "Updated", got.Name)

	require.NoError(t, ctrl.RemoveConnection("p1", "c1"))

	conns, err = ctrl.ListConnections("p1")
	require.NoError(t, err)
	assert.Empty(t, conns)
}
