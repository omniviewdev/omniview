package resource

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ======================== mergeConnections tests ======================== //

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

// ======================== ListConnections tests ======================== //

func TestListConnections_ReturnsFromMemory(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["test-plugin"] = []types.Connection{
		{ID: "b", Name: "Bravo"},
		{ID: "a", Name: "Alpha"},
	}

	result, err := ctrl.ListConnections("test-plugin")
	require.NoError(t, err)
	require.Len(t, result, 2)
	// ListConnections sorts by name
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

// ======================== AddConnection + ListConnections round-trip ======================== //

func TestAddConnection_ThenList(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["plugin-a"] = []types.Connection{}

	err := ctrl.AddConnection("plugin-a", types.Connection{ID: "conn-1", Name: "First"})
	require.NoError(t, err)

	err = ctrl.AddConnection("plugin-a", types.Connection{ID: "conn-2", Name: "Second"})
	require.NoError(t, err)

	result, err := ctrl.ListConnections("plugin-a")
	require.NoError(t, err)
	assert.Len(t, result, 2)
}

func TestAddConnection_NewPlugin(t *testing.T) {
	ctrl := newTestController()
	// No prior entry for "new-plugin"
	err := ctrl.AddConnection("new-plugin", types.Connection{ID: "conn-1", Name: "First"})
	require.NoError(t, err)

	result, err := ctrl.ListConnections("new-plugin")
	require.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "First", result[0].Name)
}

// ======================== GetConnection tests ======================== //

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
	ctrl.connections["p"] = []types.Connection{
		{ID: "c1", Name: "one"},
	}

	_, err := ctrl.GetConnection("p", "missing")
	require.Error(t, err)
}

// ======================== RemoveConnection tests ======================== //

func TestRemoveConnection_Success(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{
		{ID: "c1", Name: "one"},
		{ID: "c2", Name: "two"},
	}

	err := ctrl.RemoveConnection("p", "c1")
	require.NoError(t, err)

	result, err := ctrl.ListConnections("p")
	require.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "c2", result[0].ID)
}

func TestRemoveConnection_NotFound(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{
		{ID: "c1", Name: "one"},
	}

	err := ctrl.RemoveConnection("p", "missing")
	require.Error(t, err)
}

// ======================== UpdateConnection tests ======================== //

func TestUpdateConnection_Success(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{
		{ID: "c1", Name: "old-name"},
	}

	updated, err := ctrl.UpdateConnection("p", types.Connection{ID: "c1", Name: "new-name"})
	require.NoError(t, err)
	assert.Equal(t, "new-name", updated.Name)

	// Verify it persisted in memory
	conn, err := ctrl.GetConnection("p", "c1")
	require.NoError(t, err)
	assert.Equal(t, "new-name", conn.Name)
}

func TestUpdateConnection_NotFound(t *testing.T) {
	ctrl := newTestController()
	ctrl.connections["p"] = []types.Connection{
		{ID: "c1", Name: "one"},
	}

	_, err := ctrl.UpdateConnection("p", types.Connection{ID: "missing", Name: "x"})
	require.Error(t, err)
}
