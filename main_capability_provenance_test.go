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
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// This invokes the production composition's metric consumer and the real
// resource admission boundary. The SDK callback samples the Go runtime, not
// a supplied principal/connection label. No Wails application is launched.
func TestCapabilityConnectionAdmissionPreservesUIAndNativeOrigins(t *testing.T) {
	const pluginID = "native-runtime"
	const connectionID = "account/a::opaque"
	const resourceKey = "native/runtime"
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
			provider, err := sdkresource.NewController(sdkresource.Config[int]{
				Catalog: func(context.Context, sdkresource.CatalogRequest) (sdkresource.Catalog, error) {
					return sdkresource.Catalog{Provider: pluginID, Revision: "runtime-v1", Types: []sdkresource.ResourceType{}, Coverage: sdkresource.Coverage{Kind: "complete", Paths: []string{}}}, nil
				},
				Lifecycle: &sdkresource.Lifecycle[int]{
					LoadConnections: func(context.Context) ([]sdktypes.Connection, error) {
						return []sdktypes.Connection{{ID: connectionID, Data: map[string]any{"sampler": "gomaxprocs"}}}, nil
					},
					CreateClient: func(context.Context, sdktypes.Connection) (*int, error) {
						sample := runtime.GOMAXPROCS(0)
						return &sample, nil
					},
					DestroyClient: func(_ context.Context, sample *int) error {
						*sample = 0
						return nil
					},
				},
			})
			require.NoError(t, err)
			t.Cleanup(func() { _ = provider.Close() })
			manager := sdkmetric.NewManager(logger, nil, sdkmetric.ProviderInfo{ID: pluginID}, nil,
				func(query *sdkmetric.QueryContext, _ sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
					if query.Connection == nil || query.Connection.Data["sampler"] != "gomaxprocs" {
						return nil, fmt.Errorf("native sampler requires admitted selected connection")
					}
					return &sdkmetric.QueryResponse{Success: true, Results: []sdkmetric.MetricResult{{CurrentValue: &sdkmetric.CurrentValue{MetricID: "gomaxprocs", Value: float64(runtime.GOMAXPROCS(0))}}}}, nil
				}, nil)
			manager.BindConnectionContextProvider(provider)
			backend := plugintypes.NewInProcessBackend(map[string]interface{}{"resource": provider, "metric": manager})
			resources := hostresource.NewController(logger, nil, state.PluginStore, boundary)
			resources.Run(ctx)
			t.Cleanup(func() {
				_ = resources.OnPluginStop(pluginID, config.PluginMeta{})
				_ = resources.(interface{ ServiceShutdown() error }).ServiceShutdown()
			})
			resources.OnPluginInit(pluginID, config.PluginMeta{})
			require.NoError(t, resources.OnPluginStart(pluginID, config.PluginMeta{}, backend))
			status, startErr := resources.StartConnection(invocation.HostContext(ctx), pluginID, connectionID)
			require.NoError(t, startErr)
			require.Equal(t, sdktypes.ConnectionStatusConnected, status.Status)

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

func TestProductionHeadlessLogsPreserveExternalAuthority(t *testing.T) {
	logger := logging.NewNop()
	state := appstate.NewTestService(t)
	var observed invocation.Origin
	boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(principal invocation.Principal, operation string, _ invocation.Target) error {
		if operation == "logs.CreateSession" {
			observed = principal.Origin()
			if observed == invocation.ExternalAgent {
				return fmt.Errorf("external logs denied")
			}
		}
		return nil
	}))
	resources := hostresource.NewController(logger, nil, state.PluginStore, boundary)
	_, _, logs, _ := newUICapabilityControllers(logger, nil, resources, invocation.NewScope(invocation.TrustedUI))
	ctx := invocation.NewScope(invocation.ExternalAgent).Context(context.Background())
	_, err := logs.ReadResourceLogs(ctx, "plugin", sdklogs.CreateSessionOptions{
		ResourceKey: "pod", ResourceID: "pod",
		Route: &sdkresource.AccessRoute{Connection: "route"},
		Reference: &sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{
			Provider: "provider", Authority: "authority", Type: "pod", ID: "pod", Scope: []sdkresource.ScopeEntry{},
		}},
	})
	require.Error(t, err)
	require.Equal(t, invocation.ExternalAgent, observed, "production composition must not stamp the UI realm")
}
