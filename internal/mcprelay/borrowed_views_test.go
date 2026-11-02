package mcprelay

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/tools"
	"github.com/omniviewdev/plugin-sdk/pkg/config"

	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
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

type stalledNativeDiscovery struct {
	*fakeConnections
}

func (s *stalledNativeDiscovery) GetAllConnectionStates(ctx context.Context) (map[string][]resource.ConnectionState, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestBorrowedToolRemainsListedAfterNativeDiscoveryTimeout(t *testing.T) {
	h := newHarness(t)
	h.tools.mu.Lock()
	h.tools.plugins["flux"] = tools.PluginTools{
		Meta: config.PluginMeta{ID: "flux", Name: "Flux"},
		Tools: []sdktools.Descriptor{{
			Name: "reconcile", Scope: sdktools.ScopeConnection,
			ConnectionOwner: "kubernetes", InputSchema: sdktools.ObjectSchema(nil),
		}},
	}
	h.tools.mu.Unlock()
	h.relay.connections = &stalledNativeDiscovery{fakeConnections: &fakeConnections{}}
	h.relay.borrowedConnections = func(ctx context.Context, _, _ string, startedOnly bool) ([]sdktypes.Connection, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if startedOnly {
			return nil, nil
		}
		return []sdktypes.Connection{{ID: "stopped", Name: "Stopped"}}, nil
	}
	h.relay.mu.Lock()
	h.relay.cfg.Global.Preset = PresetAll
	h.relay.mu.Unlock()
	h.relay.resync()

	session := h.connect(t, nil)
	require.Contains(t, toolNames(t, session), "flux_reconcile")
}
