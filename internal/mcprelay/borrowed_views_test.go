package mcprelay

import (
	"context"
	"errors"
	"testing"

	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

func TestBorrowedPolicyAndToolViewsUseConsumerScope(t *testing.T) {
	cfg := DefaultConfig("test-token")
	cfg.Global.Preset = PresetAll
	tool := ToolInfo{MCPName: "flux_status", PluginID: "flux", PluginName: "Flux", Name: "status", Scope: ScopeConnection, ConnectionOwner: "kubernetes", Status: StatusOK}
	connections := &fakeConnections{connections: map[string][]sdktypes.Connection{}, stateErr: errors.New("unrelated readiness must not be probed")}
	relay := &Relay{cfg: cfg, catalog: []ToolInfo{tool}, connections: connections, registered: map[string]bool{"flux_status": true}}
	relay.borrowedConnections = func(_ context.Context, consumer, owner string, startedOnly bool) ([]sdktypes.Connection, error) {
		require.Equal(t, "flux", consumer)
		require.Equal(t, "kubernetes", owner)
		if startedOnly {
			return nil, nil
		}
		return []sdktypes.Connection{{ID: "prod", Name: "Production"}}, nil
	}
	service := &ServiceWrapper{Relay: relay}
	views, err := service.ListTools(Scope{PluginID: "flux", ConnectionID: "prod"})
	require.NoError(t, err)
	require.Len(t, views, 1)
	require.Equal(t, "prod", views[0].ConnectionID)
	require.False(t, views[0].Ready)
	policies, err := service.ListConnectionPolicies()
	require.NoError(t, err)
	require.Len(t, policies, 1)
	require.Equal(t, "flux", policies[0].PluginID)
	require.Equal(t, "Production", policies[0].ConnectionName)
}

func TestUnavailableBorrowedOwnerDoesNotBreakOtherSettings(t *testing.T) {
	cfg := DefaultConfig("test-token")
	cfg.Global.Preset = PresetAll
	catalog := []ToolInfo{
		{MCPName: "flux_status", PluginID: "flux", Scope: ScopeConnection, ConnectionOwner: "kubernetes", Status: StatusOK},
		{MCPName: "other_status", PluginID: "other", Scope: ScopeConnection, Status: StatusOK},
	}
	connections := &fakeConnections{connections: map[string][]sdktypes.Connection{"other": {{ID: "ok", Name: "Available"}}}}
	relay := &Relay{cfg: cfg, catalog: catalog, connections: connections, registered: map[string]bool{}, borrowedConnections: func(context.Context, string, string, bool) ([]sdktypes.Connection, error) {
		return nil, errors.New("owner unavailable")
	}}
	service := &ServiceWrapper{Relay: relay}
	views, err := service.ListTools(Scope{})
	require.NoError(t, err)
	require.NotEmpty(t, views)
	policies, err := service.ListConnectionPolicies()
	require.NoError(t, err)
	require.Len(t, policies, 1)
	require.Equal(t, "other", policies[0].PluginID)
}

func TestStoppedBorrowedRouteStillListsNamedTool(t *testing.T) {
	cfg := DefaultConfig("test-token")
	cfg.Global.Preset = PresetAll
	tool := ToolInfo{MCPName: "flux_reconcile", PluginID: "flux", Name: "reconcile", Scope: ScopeConnection, ConnectionOwner: "kubernetes", Status: StatusOK}
	relay := &Relay{borrowedConnections: func(_ context.Context, _, _ string, startedOnly bool) ([]sdktypes.Connection, error) {
		require.False(t, startedOnly)
		return []sdktypes.Connection{{ID: "stopped", Name: "Stopped"}}, nil
	}}
	eligible := relay.listedConnections(context.Background(), &cfg, tool, nil)
	require.Equal(t, []string{"stopped"}, eligible)
	require.True(t, cfg.Listed(tool, eligible))
}
