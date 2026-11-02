package resource

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

	v2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

type failingReadinessProvider struct {
	*mockProvider
	probes atomic.Int32
}

func (p *failingReadinessProvider) GetConnectionStatus(context.Context, string) (types.ConnectionStatus, error) {
	p.probes.Add(1)
	return types.ConnectionStatus{}, errors.New("denied B readiness")
}

func TestBorrowedInventoryDoesNotProbeOtherConnections(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := &failingReadinessProvider{mockProvider: &mockProvider{
		CatalogFunc: func(context.Context, v2.CatalogRequest) (v2.Catalog, error) {
			return v2.Catalog{Provider: "fixture", Revision: "1", Types: []v2.ResourceType{}, Coverage: v2.Coverage{Kind: "complete", Paths: []string{}}}, nil
		},
		StartConnectionFunc: func(_ context.Context, id string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &types.Connection{ID: id, Name: "Allowed"}}, nil
		},
		StopConnectionFunc: func(_ context.Context, id string) (types.Connection, error) {
			return types.Connection{ID: id, Name: "Allowed"}, nil
		},
	}}
	registerMockPlugin(ctrl, "owner", provider)
	ctrl.connsMu.Lock()
	ctrl.connections["owner"] = []types.Connection{{ID: "A", Name: "Allowed", Data: map[string]any{"credential": "sentinel"}}, {ID: "B", Name: "Denied"}}
	ctrl.connsMu.Unlock()
	_, err := ctrl.StartConnection(testInvocationContext(), "owner", "A")
	require.NoError(t, err)
	provider.probes.Store(0)
	inventory := ctrl.BorrowableConnections("owner")
	require.Len(t, inventory, 2)
	byID := map[string]BorrowableConnection{}
	for _, entry := range inventory {
		byID[entry.ID] = entry
	}
	require.True(t, byID["A"].Started)
	require.False(t, byID["B"].Started)
	require.Equal(t, "Allowed", byID["A"].Name)
	require.Zero(t, provider.probes.Load())
	ctrl.connsMu.Lock()
	ctrl.connections["owner"][0].Name = "Renamed"
	ctrl.connsMu.Unlock()
	inventory = ctrl.BorrowableConnections("owner")
	require.True(t, inventory[0].Started)
	require.Equal(t, "Renamed", inventory[0].Name)
	_, err = ctrl.StopConnection(testInvocationContext(), "owner", "A")
	require.NoError(t, err)
	inventory = ctrl.BorrowableConnections("owner")
	require.False(t, inventory[0].Started)
	require.Equal(t, "A", inventory[0].ID)
	_, err = ctrl.StartConnection(testInvocationContext(), "owner", "A")
	require.NoError(t, err)
	inventory = ctrl.BorrowableConnections("owner")
	require.True(t, inventory[0].Started)
	registerMockPlugin(ctrl, "owner", provider)
	inventory = ctrl.BorrowableConnections("owner")
	require.False(t, inventory[0].Started)
}

func TestBorrowedInventoryFencesResetAndStaleStart(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	entered, release := make(chan struct{}), make(chan struct{})
	provider := &mockProvider{StartConnectionFunc: func(_ context.Context, id string) (types.ConnectionStatus, error) {
		close(entered)
		<-release
		return types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &types.Connection{ID: id, Name: "Cluster"}}, nil
	}}
	registerMockPlugin(ctrl, "owner", provider)
	ctrl.connsMu.Lock()
	ctrl.connections["owner"] = []types.Connection{{ID: "A", Name: "Cluster"}}
	ctrl.connsMu.Unlock()
	done := make(chan error, 1)
	go func() { _, err := ctrl.StartConnection(testInvocationContext(), "owner", "A"); done <- err }()
	<-entered
	require.NoError(t, ctrl.invalidateProfileRoutes("owner", []string{"A"}))
	ctrl.connsMu.Lock()
	ctrl.connections["owner"] = []types.Connection{{ID: "A", Name: "Replacement"}}
	ctrl.connsMu.Unlock()
	close(release)
	<-done
	inventory := ctrl.BorrowableConnections("owner")
	require.Len(t, inventory, 1)
	require.False(t, inventory[0].Started)
}

func TestRepeatedStartPreservesCatalogObservation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	connection := types.Connection{ID: "A", Name: "Cluster"}
	provider := &mockProvider{
		CatalogFunc: func(context.Context, v2.CatalogRequest) (v2.Catalog, error) {
			return epochTestCatalog("stable"), nil
		},
		StartConnectionFunc: func(context.Context, string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &connection}, nil
		},
	}
	registerMockPlugin(ctrl, "owner", provider)
	ctrl.connsMu.Lock()
	ctrl.connections["owner"] = []types.Connection{connection}
	ctrl.connsMu.Unlock()
	ctx := testInvocationContext()
	_, err := ctrl.StartConnection(ctx, "owner", connection.ID)
	require.NoError(t, err)
	route := v2.AccessRoute{Connection: connection.ID}
	_, observation, err := ctrl.ObserveCatalog(ctx, "owner", route)
	require.NoError(t, err)
	_, err = ctrl.StartConnection(ctx, "owner", connection.ID)
	require.NoError(t, err)
	_, err = ctrl.Catalog(WithObservation(ctx, observation), "owner", v2.CatalogRequest{Route: route})
	require.NoError(t, err, "an idempotent start must retain the existing source observation")
}
