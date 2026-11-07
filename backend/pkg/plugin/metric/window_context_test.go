package metric

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type legacyMetricWindow struct {
	application.Window
	id uint
}

func (w *legacyMetricWindow) ID() uint { return w.id }
func (w *legacyMetricWindow) OnWindowEvent(events.WindowEventType, func(*application.WindowEvent)) func() {
	return func() {}
}

func TestLegacyMetricBindingsRetainActualWindowRealm(t *testing.T) {
	for _, subscribe := range []bool{false, true} {
		for _, caller := range []string{"owner", "missing", "other"} {
			name := "query/" + caller
			if subscribe {
				name = "subscribe/" + caller
			}
			t.Run(name, func(t *testing.T) {
				var calls atomic.Int32
				fixture := newNativeMetricFixture(t, func(_ *sdkmetric.QueryContext, _ sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
					calls.Add(1)
					return sampleNativeRuntimeMetric(nativeRuntimeMetricName, sdkmetric.ShapeCurrent)
				})
				realm := invocation.NewWindowRealm(nil)
				window := &legacyMetricWindow{id: 1}
				windowCtx := context.WithValue(context.Background(), application.WindowKey, window)
				ownerCtx := realm.Context(windowCtx)
				target, err := fixture.resources.ResolveTarget(ownerCtx, nativeMetricPluginID, hostresource.ResolveTargetRequest{Route: resourcev2.AccessRoute{Connection: nativeMetricConnectionID}, Type: nativeMetricResourceKey, Representation: "native"})
				require.NoError(t, err)
				page, err := fixture.resources.Enumerate(ownerCtx, nativeMetricPluginID, hostresource.HostEnumerateRequest{TargetID: target.TargetID, Request: resourcev2.EnumerateRequest{Target: target.Target}})
				require.NoError(t, err)
				require.Len(t, page.Records, 1)
				observed := page.Records[0]
				ctrl := NewController(logging.NewNop(), nil, fixture.resources).(*controller)
				require.NoError(t, ctrl.ServiceStartup(context.Background(), application.ServiceOptions{}))
				require.NoError(t, ctrl.OnPluginStart(nativeMetricPluginID, config.PluginMeta{}, fixture.backend))
				t.Cleanup(func() { _ = ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}) })
				owner := realm.ScopeForWindow(window).Principal().Owner()
				boundary := invocation.NewBoundary(invocation.AuthorizeFunc(func(principal invocation.Principal, _ string, _ invocation.Target) error {
					if principal.Owner() != owner {
						return resourcev2.NewError("FORBIDDEN", "Reference belongs to another window.")
					}
					return nil
				}))
				ctrl.SetUIReferenceAdmitter(func(ctx context.Context, operation, plugin string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (context.Context, error) {
					admitted, err := boundary.Admit(realm.Context(ctx), operation, invocation.Target{Provider: plugin, Connection: route.Connection})
					if err != nil {
						return nil, err
					}
					return fixture.resources.AdmitReference(admitted, operation, plugin, route, reference)
				})
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				switch caller {
				case "owner":
					ctx = context.WithValue(ctx, application.WindowKey, window)
				case "other":
					ctx = context.WithValue(ctx, application.WindowKey, &legacyMetricWindow{id: 2})
				}
				wrapper := &ServiceWrapper{Ctrl: ctrl, Realm: realm}
				if subscribe {
					encoded, encodeErr := json.Marshal(SubscribeRequest{ResourceKey: nativeMetricResourceKey, ResourceID: observed.Record.Reference.Address.ID, ResourceData: &observed.Record.Body, Reference: &observed.Record.Reference, Route: &observed.Route, Interval: time.Second})
					require.NoError(t, encodeErr)
					var id string
					id, err = wrapper.Subscribe(ctx, nativeMetricPluginID, nativeMetricConnectionID, string(encoded))
					if caller == "owner" {
						require.NoError(t, err)
						cancel()
						ctrl.mux.RLock()
						state := ctrl.subscriptions[id].stream
						ctrl.mux.RUnlock()
						select {
						case <-state.done:
							t.Fatal("binding cancellation stopped the shared metric stream")
						default:
						}
						require.NoError(t, ctrl.Unsubscribe(id))
					}
				} else {
					encoded, encodeErr := json.Marshal(sdkmetric.QueryRequest{ResourceKey: nativeMetricResourceKey, ResourceID: observed.Record.Reference.Address.ID, ResourceData: &observed.Record.Body, Reference: &observed.Record.Reference, Route: &observed.Route, Shape: sdkmetric.ShapeCurrent})
					require.NoError(t, encodeErr)
					_, err = wrapper.Query(ctx, nativeMetricPluginID, nativeMetricConnectionID, string(encoded))
					if caller == "owner" {
						require.NoError(t, err)
						require.Equal(t, int32(1), calls.Load())
					}
				}
				if caller != "owner" {
					require.Error(t, err)
					require.Zero(t, calls.Load())
				}
			})
		}
	}
}

type deniedMetricConnections struct{ failure error }

func (d deniedMetricConnections) GetConnection(context.Context, string, string) (sdktypes.Connection, error) {
	return sdktypes.Connection{}, d.failure
}

type unreachableMetricQuery struct {
	Provider
	calls int
}

func (p *unreachableMetricQuery) Query(*sdktypes.PluginContext, sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
	p.calls++
	return &sdkmetric.QueryResponse{}, nil
}

func TestLegacyMetricConnectionDenialStopsProviderDispatch(t *testing.T) {
	denied := resourcev2.NewError("FORBIDDEN", "Connection lookup denied.")
	ctrl := NewController(logging.NewNop(), nil, deniedMetricConnections{failure: denied}).(*controller)
	require.NoError(t, ctrl.ServiceStartup(context.Background(), application.ServiceOptions{}))
	provider := &unreachableMetricQuery{}
	ctrl.clients["plugin"] = provider
	ctx := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	_, err := ctrl.Query(ctx, "plugin", "connection", sdkmetric.QueryRequest{})
	require.ErrorIs(t, err, denied)
	require.Zero(t, provider.calls)
	_, err = ctrl.Subscribe(ctx, "plugin", "connection", SubscribeRequest{ResourceKey: "cluster::metrics", Interval: time.Second})
	require.ErrorIs(t, err, denied)
	require.Zero(t, provider.calls)
	require.Empty(t, ctrl.subscriptions)
	require.Empty(t, ctrl.streams)
	require.Empty(t, ctrl.streamErrors)
	state := testMetricStream()
	defer state.stop()
	state.key = metricStreamKey{"plugin", "connection"}
	ctrl.streams[state.key] = state
	ready, err := ctrl.ensureStream(ctx, "plugin", "connection")
	require.ErrorIs(t, err, denied)
	require.Nil(t, ready)
	require.Same(t, state, ctrl.streams[state.key])
	require.Empty(t, ctrl.streamErrors)
	select {
	case <-state.done:
		t.Fatal("denied caller retired another caller's shared lane")
	default:
	}
}
