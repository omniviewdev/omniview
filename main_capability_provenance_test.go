package main

import (
	"context"
	"fmt"
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	pluginmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/resource/resourcetest"
)

// This invokes the production composition's metric consumer and the real
// resource admission boundary. The SDK callback samples the Go runtime, not
// a supplied principal/connection label. No Wails application is launched.
func TestCapabilityConnectionAdmissionPreservesUIAndNativeOrigins(t *testing.T) {
	const pluginID = "native-runtime"
	const connectionID = "account/a::opaque"
	const resourceKey = "host::v1::Runtime"
	for _, tc := range []struct {
		name   string
		ui     bool
		origin invocation.Origin
	}{{"ui-capability", true, invocation.TrustedUI}, {"native-capability", false, invocation.Host}} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			logger := logging.NewNop()
			state := appstate.NewTestService(t)
			realm := invocation.NewScope(invocation.TrustedUI)
			type admission struct {
				principal invocation.Principal
				target    invocation.Target
			}
			seen := make(chan admission, 1)
			boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(principal invocation.Principal, operation string, target invocation.Target) error {
				if operation != "resource.GetConnection" {
					return nil
				}
				seen <- admission{principal: principal, target: target}
				if principal.Origin() != tc.origin {
					return fmt.Errorf("connection lookup has wrong invocation origin")
				}
				return nil
			}))
			provider, err := sdkresource.BuildResourceController(ctx, sdkresource.ResourcePluginConfig[string]{
				Logger: logger,
				Connections: &resourcetest.StubConnectionProvider[string]{LoadConnectionsFunc: func(context.Context) ([]sdktypes.Connection, error) {
					return []sdktypes.Connection{{ID: connectionID, Data: map[string]any{"sampler": "gomaxprocs"}}}, nil
				}},
				Resources: []sdkresource.ResourceRegistration[string]{{Meta: sdkresource.ResourceMeta{Group: "host", Version: "v1", Kind: "Runtime"}, Resourcer: &resourcetest.StubResourcer[string]{}}},
			})
			require.NoError(t, err)
			t.Cleanup(provider.Close)
			manager := sdkmetric.NewManager(logger, nil, sdkmetric.ProviderInfo{ID: pluginID}, nil,
				func(query *sdkmetric.QueryContext, _ sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
					if query.Connection == nil || query.Connection.Data["sampler"] != "gomaxprocs" {
						return nil, fmt.Errorf("native sampler requires admitted selected connection")
					}
					return &sdkmetric.QueryResponse{Success: true, Results: []sdkmetric.MetricResult{{CurrentValue: &sdkmetric.CurrentValue{MetricID: "gomaxprocs", Value: float64(runtime.GOMAXPROCS(0))}}}}, nil
				}, nil)
			backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": provider, "metric": manager})
			resources := hostresource.NewController(logger, nil, state.PluginStore, boundary)
			resources.Run(ctx)
			t.Cleanup(func() {
				_ = resources.OnPluginStop(pluginID, config.PluginMeta{})
				_ = resources.(interface{ ServiceShutdown() error }).ServiceShutdown()
			})
			resources.OnPluginInit(pluginID, config.PluginMeta{})
			require.NoError(t, resources.OnPluginStart(pluginID, config.PluginMeta{}, backend))

			var metrics pluginmetric.Controller
			if tc.ui {
				_, _, _, metrics = newUICapabilityControllers(logger, nil, resources, realm)
			} else {
				metrics = pluginmetric.NewController(logger, nil, resources)
			}
			require.NoError(t, metrics.ServiceStartup(ctx, application.ServiceOptions{}))
			require.NoError(t, metrics.OnPluginStart(pluginID, config.PluginMeta{}, backend))
			t.Cleanup(func() { cancel(); _ = metrics.OnPluginStop(pluginID, config.PluginMeta{}) })
			response, queryErr := metrics.Query(pluginID, connectionID, sdkmetric.QueryRequest{ResourceKey: resourceKey})
			select {
			case observed := <-seen:
				require.Equal(t, tc.origin, observed.principal.Origin())
				require.Equal(t, pluginID, observed.target.Provider)
				require.Equal(t, connectionID, observed.target.Connection)
				if tc.ui {
					require.Equal(t, realm.Principal().Owner(), observed.principal.Owner())
				} else {
					require.NotEqual(t, realm.Principal().Owner(), observed.principal.Owner())
				}
			case <-time.After(time.Second):
				t.Fatal("capability bypassed real resource connection admission")
			}
			require.NoError(t, queryErr)
			require.True(t, response.Success)
			require.Len(t, response.Results, 1)
			require.Equal(t, float64(runtime.GOMAXPROCS(0)), response.Results[0].CurrentValue.Value)
		})
	}
}
