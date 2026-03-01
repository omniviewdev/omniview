package resource

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

func TestAdapterV1_CompileTimeCheck(t *testing.T) {
	var _ ResourceProvider = (*AdapterV1)(nil)
}

func TestAdapterV1_CRUD_Passthrough(t *testing.T) {
	ctx := context.Background()

	tp := resourcetest.NewTestProvider(t,
		resourcetest.WithGetFunc(func(_ context.Context, key string, _ resource.GetInput) (*resource.GetResult, error) {
			return &resource.GetResult{Success: true, Result: json.RawMessage(`{"key":"` + key + `"}`)}, nil
		}),
		resourcetest.WithListFunc(func(_ context.Context, key string, _ resource.ListInput) (*resource.ListResult, error) {
			return &resource.ListResult{Success: true}, nil
		}),
	)

	adapter := NewAdapterV1(tp)

	// Get
	gr, err := adapter.Get(ctx, "pods", resource.GetInput{})
	require.NoError(t, err)
	assert.True(t, gr.Success)
	assert.Contains(t, string(gr.Result), "pods")

	// List
	lr, err := adapter.List(ctx, "pods", resource.ListInput{})
	require.NoError(t, err)
	assert.True(t, lr.Success)

	// Find (default)
	fr, err := adapter.Find(ctx, "pods", resource.FindInput{})
	require.NoError(t, err)
	assert.NotNil(t, fr)

	// Create (default)
	cr, err := adapter.Create(ctx, "pods", resource.CreateInput{Input: json.RawMessage(`{}`)})
	require.NoError(t, err)
	assert.NotNil(t, cr)

	// Update (default)
	ur, err := adapter.Update(ctx, "pods", resource.UpdateInput{Input: json.RawMessage(`{}`)})
	require.NoError(t, err)
	assert.NotNil(t, ur)

	// Delete (default)
	dr, err := adapter.Delete(ctx, "pods", resource.DeleteInput{})
	require.NoError(t, err)
	assert.NotNil(t, dr)
}

func TestAdapterV1_CRUD_ErrorPropagation(t *testing.T) {
	ctx := context.Background()
	wantErr := errors.New("boom")

	tp := resourcetest.NewTestProvider(t,
		resourcetest.WithGetFunc(func(_ context.Context, _ string, _ resource.GetInput) (*resource.GetResult, error) {
			return nil, wantErr
		}),
	)

	adapter := NewAdapterV1(tp)

	_, err := adapter.Get(ctx, "pods", resource.GetInput{})
	assert.ErrorIs(t, err, wantErr)
}

func TestAdapterV1_ConnectionLifecycle_Passthrough(t *testing.T) {
	ctx := context.Background()

	tp := resourcetest.NewTestProvider(t,
		resourcetest.WithLoadConnectionsFunc(func(_ context.Context) ([]types.Connection, error) {
			return []types.Connection{{ID: "c1", Name: "Cluster1"}}, nil
		}),
	)

	adapter := NewAdapterV1(tp)

	// StartConnection (default)
	cs, err := adapter.StartConnection(ctx, "c1")
	require.NoError(t, err)
	assert.Equal(t, types.ConnectionStatusConnected, cs.Status)

	// StopConnection (default)
	conn, err := adapter.StopConnection(ctx, "c1")
	require.NoError(t, err)
	assert.Equal(t, "c1", conn.ID)

	// LoadConnections (custom)
	conns, err := adapter.LoadConnections(ctx)
	require.NoError(t, err)
	require.Len(t, conns, 1)
	assert.Equal(t, "Cluster1", conns[0].Name)

	// ListConnections (default)
	lc, err := adapter.ListConnections(ctx)
	require.NoError(t, err)
	assert.NotNil(t, lc)

	// GetConnection (default)
	gc, err := adapter.GetConnection(ctx, "c1")
	require.NoError(t, err)
	assert.Equal(t, "c1", gc.ID)

	// GetConnectionNamespaces (default)
	ns, err := adapter.GetConnectionNamespaces(ctx, "c1")
	require.NoError(t, err)
	assert.Contains(t, ns, "default")

	// UpdateConnection (default)
	uc, err := adapter.UpdateConnection(ctx, types.Connection{ID: "c1"})
	require.NoError(t, err)
	assert.Equal(t, "c1", uc.ID)

	// DeleteConnection (default)
	err = adapter.DeleteConnection(ctx, "c1")
	require.NoError(t, err)
}

func TestAdapterV1_Watch_Passthrough(t *testing.T) {
	ctx := context.Background()

	tp := resourcetest.NewTestProvider(t)
	adapter := NewAdapterV1(tp)

	// StartConnectionWatch
	err := adapter.StartConnectionWatch(ctx, "c1")
	require.NoError(t, err)

	// StopConnectionWatch
	err = adapter.StopConnectionWatch(ctx, "c1")
	require.NoError(t, err)

	// GetWatchState
	ws, err := adapter.GetWatchState(ctx, "c1")
	require.NoError(t, err)
	assert.NotNil(t, ws)

	// HasWatch
	hw := adapter.HasWatch(ctx, "c1")
	assert.False(t, hw)

	// EnsureResourceWatch
	err = adapter.EnsureResourceWatch(ctx, "c1", "pods")
	require.NoError(t, err)

	// StopResourceWatch
	err = adapter.StopResourceWatch(ctx, "c1", "pods")
	require.NoError(t, err)

	// RestartResourceWatch
	err = adapter.RestartResourceWatch(ctx, "c1", "pods")
	require.NoError(t, err)

	// IsResourceWatchRunning
	running, err := adapter.IsResourceWatchRunning(ctx, "c1", "pods")
	require.NoError(t, err)
	assert.False(t, running)
}

func TestAdapterV1_TypeMetadata_Passthrough(t *testing.T) {
	ctx := context.Background()

	tp := resourcetest.NewTestProvider(t)
	adapter := NewAdapterV1(tp)

	groups := adapter.GetResourceGroups(ctx, "c1")
	assert.NotNil(t, groups)

	_, err := adapter.GetResourceGroup(ctx, "g1")
	require.NoError(t, err)

	types := adapter.GetResourceTypes(ctx, "c1")
	assert.NotNil(t, types)

	_, err = adapter.GetResourceType(ctx, "t1")
	require.NoError(t, err)

	ht := adapter.HasResourceType(ctx, "t1")
	assert.False(t, ht)

	_, err = adapter.GetResourceDefinition(ctx, "t1")
	require.NoError(t, err)

	caps, err := adapter.GetResourceCapabilities(ctx, "pods")
	require.NoError(t, err)
	assert.True(t, caps.CanGet)

	_, err = adapter.GetResourceSchema(ctx, "c1", "pods")
	require.NoError(t, err)

	_, err = adapter.GetFilterFields(ctx, "c1", "pods")
	require.NoError(t, err)
}

func TestAdapterV1_Actions_Passthrough(t *testing.T) {
	ctx := context.Background()

	tp := resourcetest.NewTestProvider(t)
	adapter := NewAdapterV1(tp)

	_, err := adapter.GetActions(ctx, "pods")
	require.NoError(t, err)

	result, err := adapter.ExecuteAction(ctx, "pods", "restart", resource.ActionInput{})
	require.NoError(t, err)
	assert.True(t, result.Success)

	ch := make(chan resource.ActionEvent, 1)
	err = adapter.StreamAction(ctx, "pods", "restart", resource.ActionInput{}, ch)
	require.NoError(t, err)
}

func TestAdapterV1_Health_Passthrough(t *testing.T) {
	ctx := context.Background()

	tp := resourcetest.NewTestProvider(t)
	adapter := NewAdapterV1(tp)

	_, err := adapter.GetHealth(ctx, "c1", "pods", nil)
	require.NoError(t, err)

	_, err = adapter.GetResourceEvents(ctx, "c1", "pods", "pod-1", "default", 10)
	require.NoError(t, err)

	// Editor schemas + relationships (exercising remaining methods)
	_, err = adapter.GetEditorSchemas(ctx, "c1")
	require.NoError(t, err)

	_, err = adapter.GetRelationships(ctx, "pods")
	require.NoError(t, err)

	_, err = adapter.ResolveRelationships(ctx, "c1", "pods", "pod-1", "default")
	require.NoError(t, err)
}
