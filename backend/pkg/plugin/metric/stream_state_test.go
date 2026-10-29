package metric

import (
	"context"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type queryOnlyMetricProvider struct{ sdkmetric.Provider }

func TestQueryOnlyProviderRetainsActualNativeQuery(t *testing.T) {
	fixture := newNativeMetricFixture(t, func(_ *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
		return sampleNativeRuntimeMetric(nativeRuntimeMetricName, req.Shape)
	})
	raw, err := fixture.backend.Dispense("metric")
	require.NoError(t, err)
	provider, ok := raw.(sdkmetric.Provider)
	require.True(t, ok)
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"metric": queryOnlyMetricProvider{provider}})
	ctrl := NewController(logging.NewNop(), nil, fixture.resources)
	require.NoError(t, ctrl.ServiceStartup(context.Background(), application.ServiceOptions{}))
	require.NoError(t, ctrl.OnPluginStart(nativeMetricPluginID, config.PluginMeta{}, backend))
	t.Cleanup(func() { _ = ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}) })
	response, err := ctrl.Query(nativeMetricPluginID, nativeMetricConnectionID, sdkmetric.QueryRequest{ResourceKey: nativeMetricResourceKey, ResourceID: "owned", Shape: sdkmetric.ShapeCurrent})
	require.NoError(t, err)
	require.NotEmpty(t, response.Results)
	require.Positive(t, response.Results[0].CurrentValue.Value)
	_, err = ctrl.Subscribe(nativeMetricPluginID, nativeMetricConnectionID, SubscribeRequest{ResourceKey: nativeMetricResourceKey, Interval: time.Second})
	require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(err))
}

func TestStreamOnlyProviderProducesActualNativeMetric(t *testing.T) {
	manager := sdkmetric.NewManager(logging.NewNop(), nil, sdkmetric.ProviderInfo{ID: "native"}, nil, nil,
		func(ctx *sdkmetric.StreamContext, in chan sdkmetric.StreamInput) (chan sdkmetric.StreamOutput, error) {
			out := make(chan sdkmetric.StreamOutput)
			go func() {
				defer close(out)
				select {
				case <-ctx.Done():
					return
				case input := <-in:
					response, err := sampleNativeRuntimeMetric(nativeRuntimeMetricName, sdkmetric.ShapeCurrent)
					if err != nil {
						return
					}
					select {
					case out <- sdkmetric.StreamOutput{SubscriptionID: input.SubscriptionID, Results: response.Results}:
					case <-ctx.Done():
					}
				}
			}()
			return out, nil
		})
	adapter := NewAdapterV1(manager)
	query, err := adapter.Query(types.NewPluginContext(context.Background(), "native", nil, nil, nil), sdkmetric.QueryRequest{})
	require.NoError(t, err)
	require.False(t, query.Success)
	require.NotEmpty(t, query.Error)
	require.Empty(t, query.Results)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	input := make(chan sdkmetric.StreamInput)
	output, err := adapter.StreamResourceMetrics(ctx, input)
	require.NoError(t, err)
	select {
	case input <- sdkmetric.StreamInput{SubscriptionID: "native", Command: sdkmetric.StreamCommandSubscribe}:
	case <-time.After(time.Second):
		t.Fatal("native stream did not consume input")
	}
	select {
	case result := <-output:
		require.Equal(t, "native", result.SubscriptionID)
		require.Positive(t, result.Results[0].CurrentValue.Value)
	case <-time.After(time.Second):
		t.Fatal("native stream did not sample")
	}
}

func testMetricStream() *metricStream {
	_, cancel := context.WithCancel(context.Background())
	ready := make(chan struct{})
	close(ready)
	return &metricStream{key: metricStreamKey{"metrics", "connection"}, input: make(chan sdkmetric.StreamInput), ready: ready, done: make(chan struct{}), cancel: cancel, wireSubscriptions: make(map[string]string)}
}

func TestInvalidSubscriptionCannotPoisonSharedLane(t *testing.T) {
	fixture := newNativeMetricFixture(t, func(_ *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
		return sampleNativeRuntimeMetric(nativeRuntimeMetricName, req.Shape)
	})
	native := invocation.HostContext(context.Background())
	target, err := fixture.resources.ResolveTarget(native, nativeMetricPluginID, hostresource.ResolveTargetRequest{Route: resourcev2.AccessRoute{Connection: nativeMetricConnectionID}, Type: nativeMetricResourceKey, Representation: "native"})
	require.NoError(t, err)
	page, err := fixture.resources.Enumerate(native, nativeMetricPluginID, hostresource.HostEnumerateRequest{TargetID: target.TargetID, Request: resourcev2.EnumerateRequest{Target: target.Target}})
	require.NoError(t, err)
	require.Len(t, page.Records, 1)
	observed := page.Records[0]
	ctrl := NewController(logging.NewNop(), nil, fixture.resources).(*controller)
	ctrl.SetReferenceAdmitter(func(ctx context.Context, operation, plugin string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (context.Context, error) {
		return fixture.resources.AdmitReference(invocation.HostContext(ctx), operation, plugin, route, reference)
	})
	state := testMetricStream()
	state.key = metricStreamKey{nativeMetricPluginID, nativeMetricConnectionID}
	defer state.stop()
	ctrl.streams[state.key] = state
	_, err = ctrl.Subscribe(nativeMetricPluginID, nativeMetricConnectionID, SubscribeRequest{ResourceKey: "different-type", ResourceID: observed.Record.Reference.Address.ID, Interval: time.Second, Reference: &observed.Record.Reference, Route: &observed.Route})
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
	require.Empty(t, ctrl.subscriptions)
	select {
	case <-state.done:
		t.Fatal("bad subscription terminated shared lane")
	default:
	}
}

func TestMetricRetirementUnblocksCommandsAndFansOutExactInterests(t *testing.T) {
	ctrl := NewController(logging.NewNop(), nil, nil).(*controller)
	state := testMetricStream()
	ctrl.streams[state.key] = state
	subscribe := func() string {
		result := make(chan string, 1)
		failure := make(chan error, 1)
		go func() {
			id, err := ctrl.Subscribe("metrics", "connection", SubscribeRequest{ResourceKey: "cluster::metrics", Interval: time.Second, Params: map[string]string{"prometheus_service_port": "9090"}})
			if err != nil {
				failure <- err
			} else {
				result <- id
			}
		}()
		select {
		case input := <-state.input:
			require.Equal(t, "9090", input.Params["prometheus_service_port"])
			require.Nil(t, input.ResourceData)
			require.Nil(t, input.Reference)
			require.Nil(t, input.Route)
		case err := <-failure:
			t.Fatal(err)
		case <-time.After(time.Second):
			t.Fatal("subscribe hung")
		}
		select {
		case id := <-result:
			return id
		case err := <-failure:
			t.Fatal(err)
		case <-time.After(time.Second):
			t.Fatal("subscribe completion hung")
		}
		return ""
	}
	first := subscribe()
	second := subscribe()
	completion := make(chan error, 1)
	go func() { completion <- ctrl.Unsubscribe(first) }()
	require.Eventually(t, func() bool {
		ctrl.mux.RLock()
		defer ctrl.mux.RUnlock()
		_, ok := ctrl.subscriptions[first]
		return !ok
	}, time.Second, time.Millisecond)
	// A send awaiting its SDK consumer must not retain the controller lock.
	locked := make(chan struct{})
	go func() { ctrl.mux.Lock(); ctrl.mux.Unlock(); close(locked) }()
	select {
	case <-locked:
	case <-time.After(time.Second):
		t.Fatal("unsubscribe held controller lock")
	}
	terminal := ctrl.retireStream(state, closedStreamError())
	found := false
	for _, output := range terminal {
		if output.SubscriptionID == second {
			found = true
			require.Equal(t, "UNAVAILABLE", output.OperationError.Code)
		}
	}
	require.True(t, found)
	require.Empty(t, ctrl.subscriptions)
	select {
	case err := <-completion:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("retirement did not release unsubscribe")
	}
	_, err := ctrl.Subscribe("metrics", "connection", SubscribeRequest{ResourceKey: "cluster::metrics", Interval: time.Second})
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err))
	newer := testMetricStream()
	defer newer.stop()
	ctrl.streams[newer.key] = newer
	delete(ctrl.streamErrors, newer.key) // A new admitted generation clears the old failure.
	ctrl.subscriptions["new"] = subscriptionIndex{stream: newer}
	require.Empty(t, ctrl.retireStream(state, closedStreamError()))
	require.Same(t, newer, ctrl.streams[newer.key])
	require.Contains(t, ctrl.subscriptions, "new")
}

func TestProfileTransactionFencesOnlyItsConnectionLane(t *testing.T) {
	ctrl := NewController(logging.NewNop(), nil, nil).(*controller)
	old := testMetricStream()
	ctrl.streams[old.key] = old
	other := testMetricStream()
	other.key.connection = "other"
	defer other.stop()
	ctrl.streams[other.key] = other
	release := ctrl.BeginConnectionChange("metrics", "connection")
	select {
	case <-old.done:
	default:
		t.Fatal("profile change did not cancel old lane")
	}
	_, err := ctrl.ensureStream("metrics", "connection")
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	retained, err := ctrl.ensureStream("metrics", "other")
	require.NoError(t, err)
	require.Same(t, other, retained)
	nested := ctrl.BeginConnectionChange("metrics", "connection")
	release()
	release()
	_, err = ctrl.ensureStream("metrics", "connection")
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	nested()
	newer := testMetricStream()
	defer newer.stop()
	ctrl.streams[newer.key] = newer
	active, err := ctrl.ensureStream("metrics", "connection")
	require.NoError(t, err)
	require.Same(t, newer, active)
}

func TestConnectionScopedLaneUsesTrustedProfileThroughActualGRPC(t *testing.T) {
	sampled := make(chan string, 1)
	fixture := newNativeMetricFixture(t, func(ctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
		if ctx.Connection == nil || ctx.Connection.ID != nativeMetricConnectionID || ctx.Connection.Data["runtime_metric"] != nativeRuntimeMetricName {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Native stream has no selected registered profile.")
		}
		if req.ResourceData != nil || req.Reference != nil || req.Route != nil {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Ordinary metric utility fabricated a resource body or route.")
		}
		response, err := sampleNativeRuntimeMetric(nativeRuntimeMetricName, sdkmetric.ShapeCurrent)
		if err == nil {
			select {
			case sampled <- ctx.Connection.ID:
			default:
			}
		}
		return response, err
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctrl := NewController(logging.NewNop(), nil, fixture.resources).(*controller)
	require.NoError(t, ctrl.ServiceStartup(ctx, application.ServiceOptions{}))
	require.NoError(t, ctrl.OnPluginStart(nativeMetricPluginID, config.PluginMeta{}, fixture.backend))
	t.Cleanup(func() { _ = ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}) })
	state, err := ctrl.ensureStream(nativeMetricPluginID, nativeMetricConnectionID)
	require.NoError(t, err)
	fixture.waitMetricRPCStarted(t)
	select {
	case state.input <- sdkmetric.StreamInput{SubscriptionID: "native-connection", Command: sdkmetric.StreamCommandSubscribe, ResourceKey: nativeMetricResourceKey, Interval: time.Second}:
	case <-time.After(time.Second):
		t.Fatal("actual native lane did not accept input")
	}
	select {
	case id := <-sampled:
		require.Equal(t, nativeMetricConnectionID, id)
	case <-time.After(5 * time.Second):
		t.Fatal("actual native stream did not sample its registered profile")
	}
	require.Empty(t, ctrl.retireStream(state, closedStreamError()))
	fixture.waitMetricRPCStopped(t)
}

func TestStoppedProfileCannotOpenMetricSubscriptionUntilExplicitStart(t *testing.T) {
	sampled := make(chan struct{}, 1)
	fixture := newNativeMetricFixture(t, func(_ *sdkmetric.QueryContext, _ sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
		response, err := sampleNativeRuntimeMetric(nativeRuntimeMetricName, sdkmetric.ShapeCurrent)
		if err == nil {
			select {
			case sampled <- struct{}{}:
			default:
			}
		}
		return response, err
	})
	select {
	case <-fixture.connectionCreated:
	case <-time.After(time.Second):
		t.Fatal("fixture did not start its native connection")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctrl := NewController(logging.NewNop(), nil, fixture.resources).(*controller)
	require.NoError(t, ctrl.ServiceStartup(ctx, application.ServiceOptions{}))
	require.NoError(t, ctrl.OnPluginStart(nativeMetricPluginID, config.PluginMeta{}, fixture.backend))
	t.Cleanup(func() { _ = ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}) })
	fixture.resources.SetConnectionChangeHook(ctrl.BeginConnectionChange)
	_, err := fixture.resources.StopConnection(invocation.HostContext(ctx), nativeMetricPluginID, nativeMetricConnectionID)
	require.NoError(t, err)
	select {
	case err := <-fixture.connectionReleased:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("native connection did not stop")
	}
	id, err := ctrl.Subscribe(nativeMetricPluginID, nativeMetricConnectionID, SubscribeRequest{ResourceKey: nativeMetricResourceKey, Interval: time.Second})
	if err == nil {
		_ = ctrl.Unsubscribe(id)
	}
	require.Error(t, err, "stopped profile must not establish a sampling lane")
	require.Equal(t, "CONNECTION_ERROR", resourcev2.ErrorCode(err))
	fixture.waitMetricRPCStarted(t)
	fixture.waitMetricRPCStopped(t)
	select {
	case <-fixture.connectionCreated:
		t.Fatal("subscribe automatically restarted the stopped native client")
	default:
	}
	select {
	case <-sampled:
		t.Fatal("stopped profile sampled a native metric")
	default:
	}
	status, err := fixture.resources.StartConnection(invocation.HostContext(ctx), nativeMetricPluginID, nativeMetricConnectionID)
	require.NoError(t, err)
	require.Equal(t, types.ConnectionStatusConnected, status.Status)
	select {
	case <-fixture.connectionCreated:
	case <-time.After(time.Second):
		t.Fatal("explicit start did not create its native client")
	}
	state, err := ctrl.ensureStream(nativeMetricPluginID, nativeMetricConnectionID)
	require.NoError(t, err)
	fixture.waitMetricRPCStarted(t)
	select {
	case state.input <- sdkmetric.StreamInput{SubscriptionID: "explicit-start", Command: sdkmetric.StreamCommandSubscribe, ResourceKey: nativeMetricResourceKey, Interval: time.Second}:
	case <-time.After(time.Second):
		t.Fatal("restarted lane did not accept input")
	}
	select {
	case <-sampled:
	case <-time.After(5 * time.Second):
		t.Fatal("explicit start did not permit native sampling")
	}
	require.Empty(t, ctrl.retireStream(state, closedStreamError()))
	fixture.waitMetricRPCStopped(t)
}
