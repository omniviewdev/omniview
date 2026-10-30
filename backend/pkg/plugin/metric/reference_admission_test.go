package metric

import (
	"context"
	"encoding/json"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostexec "github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	hostlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	hostnetworker "github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	sdknetworker "github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestReferenceUtilitiesFailBeforeConnectionWorkWithoutAdmission(t *testing.T) {
	reference := &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "test", Authority: "authority", Type: "pods", ID: "pod", Scope: []resourcev2.ScopeEntry{}}}
	route := &resourcev2.AccessRoute{Connection: "connection"}
	cases := []struct {
		operation string
		run       func(hostresource.ReferenceAdmitter) error
	}{
		{"exec.CreateSession", func(admit hostresource.ReferenceAdmitter) error {
			ctrl := hostexec.NewController(logging.NewNop(), nil, nil)
			ctrl.SetReferenceAdmitter(admit)
			_, err := ctrl.CreateSession("test", "connection", sdkexec.SessionOptions{Reference: reference, Route: route})
			return err
		}},
		{"logs.CreateSession", func(admit hostresource.ReferenceAdmitter) error {
			ctrl := hostlogs.NewController(logging.NewNop(), nil, nil)
			ctrl.SetUIReferenceAdmitter(admit)
			_, err := ctrl.CreateSession("test", "connection", sdklogs.CreateSessionOptions{Reference: reference, Route: route})
			return err
		}},
		{"networker.StartResourcePortForwardingSession", func(admit hostresource.ReferenceAdmitter) error {
			ctrl := hostnetworker.NewController(logging.NewNop(), nil, nil)
			ctrl.SetReferenceAdmitter(admit)
			_, err := ctrl.StartResourcePortForwardingSession("test", "connection", sdknetworker.PortForwardSessionOptions{Connection: &sdknetworker.PortForwardResourceConnection{Reference: reference, Route: route}})
			return err
		}},
		{"metric.Query", func(admit hostresource.ReferenceAdmitter) error {
			ctrl := NewController(logging.NewNop(), nil, nil)
			ctrl.SetReferenceAdmitter(admit)
			_, err := ctrl.Query("test", "connection", sdkmetric.QueryRequest{Reference: reference, Route: route})
			return err
		}},
		{"metric.Subscribe", func(admit hostresource.ReferenceAdmitter) error {
			ctrl := NewController(logging.NewNop(), nil, nil)
			ctrl.SetReferenceAdmitter(admit)
			_, err := ctrl.Subscribe("test", "connection", SubscribeRequest{Reference: reference, Route: route})
			return err
		}},
	}
	for _, test := range cases {
		t.Run(test.operation, func(t *testing.T) {
			require.Equal(t, "UNSUPPORTED", resourcev2.ErrorCode(test.run(nil)))
			called := false
			err := test.run(func(_ context.Context, operation, plugin string, _ resourcev2.AccessRoute, _ resourcev2.ResourceReference) (context.Context, error) {
				called = true
				require.Equal(t, test.operation, operation)
				require.Equal(t, "test", plugin)
				return nil, resourcev2.NewError("FORBIDDEN", "Denied by the actual reference boundary.")
			})
			require.True(t, called)
			require.Equal(t, "FORBIDDEN", resourcev2.ErrorCode(err))
		})
	}
	local := hostexec.NewController(logging.NewNop(), nil, nil)
	_, err := local.CreateSession("local", "local", sdkexec.SessionOptions{ResourceData: &resourcev2.Value{Kind: "null"}})
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
	_, err = (&ServiceWrapper{}).Subscribe("test", "connection", `{"catalog_revision":"frontend-forgery"}`)
	require.Equal(t, "INVALID_REQUEST", resourcev2.ErrorCode(err))
}

func nativeObservedMetricRecord(t *testing.T, fixture *nativeMetricFixture) hostresource.HostRecord {
	t.Helper()
	native := invocation.HostContext(context.Background())
	target, err := fixture.resources.ResolveTarget(native, nativeMetricPluginID, hostresource.ResolveTargetRequest{Route: resourcev2.AccessRoute{Connection: nativeMetricConnectionID}, Type: nativeMetricResourceKey, Representation: "native"})
	require.NoError(t, err)
	page, err := fixture.resources.Enumerate(native, nativeMetricPluginID, hostresource.HostEnumerateRequest{TargetID: target.TargetID, Request: resourcev2.EnumerateRequest{Target: target.Target}})
	require.NoError(t, err)
	require.Len(t, page.Records, 1)
	return page.Records[0]
}

func TestReferenceQueryCarriesAcceptedCatalogPinThroughActualGRPC(t *testing.T) {
	received := make(chan string, 1)
	fixture := newNativeMetricFixture(t, func(ctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
		pin, ok := resourcev2.CatalogRevisionFromContext(ctx.Context)
		if !ok || pin == "" || req.Reference == nil {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Native query did not receive its admitted catalog pin.")
		}
		select {
		case received <- pin:
		default:
		}
		return sampleNativeRuntimeMetric(nativeRuntimeMetricName, sdkmetric.ShapeCurrent)
	})
	observed := nativeObservedMetricRecord(t, fixture)
	ctrl := NewController(logging.NewNop(), nil, fixture.resources)
	require.NoError(t, ctrl.ServiceStartup(context.Background(), application.ServiceOptions{}))
	require.NoError(t, ctrl.OnPluginStart(nativeMetricPluginID, config.PluginMeta{}, fixture.backend))
	t.Cleanup(func() { _ = ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}) })
	accepted := make(chan string, 1)
	ctrl.SetReferenceAdmitter(func(ctx context.Context, operation, plugin string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (context.Context, error) {
		admitted, err := fixture.resources.AdmitReference(invocation.HostContext(ctx), operation, plugin, route, reference)
		if err == nil {
			pin, ok := resourcev2.CatalogRevisionFromContext(admitted)
			require.True(t, ok)
			accepted <- pin
		}
		return admitted, err
	})
	result, err := ctrl.Query(nativeMetricPluginID, nativeMetricConnectionID, sdkmetric.QueryRequest{ResourceKey: nativeMetricResourceKey, ResourceID: observed.Record.Reference.Address.ID, ResourceData: &observed.Record.Body, Reference: &observed.Record.Reference, Route: &observed.Route, Shape: sdkmetric.ShapeCurrent})
	require.NoError(t, err)
	require.Equal(t, float64(runtime.GOMAXPROCS(0)), result.Results[0].CurrentValue.Value)
	select {
	case pin := <-received:
		require.Equal(t, <-accepted, pin)
	case <-time.After(time.Second):
		t.Fatal("catalog pin did not cross the actual unary SDK boundary")
	}
}

type metricRecordedEvent struct {
	key  string
	data []any
}
type metricRecordingEmitter struct{ events chan metricRecordedEvent }

func (emitter metricRecordingEmitter) Emit(key string, data ...any) {
	emitter.events <- metricRecordedEvent{key: key, data: data}
}

func TestReferenceSubscriptionPinsAndDropsQueuedSamplesAcrossPublicIDReuse(t *testing.T) {
	received := make(chan string, 1)
	ordinary := make(chan struct{}, 1)
	fixture := newNativeMetricFixture(t, func(ctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
		pin, ok := resourcev2.CatalogRevisionFromContext(ctx.Context)
		if req.Reference != nil {
			if !ok || pin == "" {
				return nil, resourcev2.NewError("INVALID_REQUEST", "Native poll did not receive its admitted frame catalog pin.")
			}
			select {
			case received <- pin:
			default:
			}
		} else {
			if pin != "" {
				return nil, resourcev2.NewError("INVALID_REQUEST", "Ordinary subscription inherited an old reference pin.")
			}
			select {
			case ordinary <- struct{}{}:
			default:
			}
		}
		result, err := sampleNativeRuntimeMetric(nativeRuntimeMetricName, sdkmetric.ShapeCurrent)
		if err == nil {
			result.Results[0].CurrentValue.Labels["catalog_revision"] = pin
		}
		return result, err
	})
	observed := nativeObservedMetricRecord(t, fixture)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctrl := NewController(logging.NewNop(), nil, fixture.resources).(*controller)
	require.NoError(t, ctrl.ServiceStartup(ctx, application.ServiceOptions{}))
	events := make(chan metricRecordedEvent, 32)
	ctrl.emitter = metricRecordingEmitter{events: events}
	require.NoError(t, ctrl.OnPluginStart(nativeMetricPluginID, config.PluginMeta{}, fixture.backend))
	t.Cleanup(func() { _ = ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}) })
	accepted := make(chan string, 1)
	ctrl.SetReferenceAdmitter(func(ctx context.Context, operation, plugin string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (context.Context, error) {
		admitted, err := fixture.resources.AdmitReference(invocation.HostContext(ctx), operation, plugin, route, reference)
		if err == nil {
			pin, ok := resourcev2.CatalogRevisionFromContext(admitted)
			require.True(t, ok)
			accepted <- pin
		}
		return admitted, err
	})
	id, err := ctrl.Subscribe(nativeMetricPluginID, nativeMetricConnectionID, SubscribeRequest{ResourceKey: nativeMetricResourceKey, ResourceID: observed.Record.Reference.Address.ID, ResourceData: &observed.Record.Body, Reference: &observed.Record.Reference, Route: &observed.Route, Interval: time.Second})
	require.NoError(t, err)
	fixture.waitMetricRPCStarted(t)
	select {
	case pin := <-received:
		require.Equal(t, <-accepted, pin)
	case <-time.After(5 * time.Second):
		t.Fatal("host-only catalog pin did not cross the actual metric frame boundary")
	}
	var queued sdkmetric.StreamOutput
	select {
	case event := <-events:
		require.Equal(t, "core/metrics/data/"+id, event.key)
		payload, ok := event.data[0].(string)
		require.True(t, ok)
		require.NoError(t, json.Unmarshal([]byte(payload), &queued))
		require.Equal(t, id, queued.SubscriptionID)
		require.Equal(t, float64(runtime.GOMAXPROCS(0)), queued.Results[0].CurrentValue.Value)
		require.NotEmpty(t, queued.Results[0].CurrentValue.Labels["catalog_revision"])
	case <-time.After(5 * time.Second):
		t.Fatal("native metric result did not reach its real subscription event")
	}
	ctrl.mux.RLock()
	first := ctrl.subscriptions[id]
	ctrl.mux.RUnlock()
	require.NotEqual(t, id, first.wireID)
	// Keep this actual native RefA sample queued in wire form until after its
	// interest is removed. The public event had translated only this ID field.
	queued.SubscriptionID = first.wireID
	require.NoError(t, ctrl.Unsubscribe(id))
	replacement, err := ctrl.Subscribe(nativeMetricPluginID, nativeMetricConnectionID, SubscribeRequest{ResourceKey: nativeMetricResourceKey, Interval: time.Second})
	require.NoError(t, err)
	// The public API currently mints fresh IDs too. Simulate an external adapter
	// reusing its old public identity without ever reusing the SDK wire identity.
	ctrl.mux.Lock()
	current, registered := ctrl.subscriptions[replacement]
	if registered {
		delete(ctrl.subscriptions, replacement)
		ctrl.subscriptions[id] = current
		current.stream.wireSubscriptions[current.wireID] = id
	}
	ctrl.mux.Unlock()
	require.True(t, registered, "ordinary replacement must remain a live SDK interest")
	require.NotEqual(t, first.wireID, current.wireID)
	_, owned := ctrl.translateStreamOutput(first.stream, queued)
	require.False(t, owned, "queued RefA must never be repainted as the new ordinary interest")
	select {
	case <-ordinary:
	case <-time.After(5 * time.Second):
		t.Fatal("ordinary replacement did not reach the real native collector")
	}
	deadline := time.After(5 * time.Second)
	for {
		select {
		case event := <-events:
			if event.key != "core/metrics/data/"+id {
				continue
			}
			payload, ok := event.data[0].(string)
			require.True(t, ok)
			var output sdkmetric.StreamOutput
			require.NoError(t, json.Unmarshal([]byte(payload), &output))
			require.Empty(t, output.Results[0].CurrentValue.Labels["catalog_revision"])
			require.Equal(t, float64(runtime.GOMAXPROCS(0)), output.Results[0].CurrentValue.Value)
			require.NoError(t, ctrl.Unsubscribe(id))
			require.NoError(t, ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}))
			fixture.waitMetricRPCStopped(t)
			return
		case <-deadline:
			t.Fatal("ordinary replacement did not publish under its current external identity")
		}
	}
}

func TestQueryAllPropagatesReferenceAdmissionDenial(t *testing.T) {
	ctrl := NewController(logging.NewNop(), nil, nil).(*controller)
	ctrl.resourceIndex["pods"] = []string{"denied-provider"}
	ctrl.SetReferenceAdmitter(func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (context.Context, error) {
		return nil, resourcev2.NewError("FORBIDDEN", "Reference metrics are denied.")
	})
	result, err := ctrl.QueryAll("connection", sdkmetric.QueryRequest{
		ResourceKey: "pods", Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "denied-provider", Authority: "cluster", Type: "pods", ID: "pod", Scope: []resourcev2.ScopeEntry{}}},
		Route: &resourcev2.AccessRoute{Connection: "connection"},
	})
	require.Nil(t, result)
	require.Equal(t, "FORBIDDEN", resourcev2.ErrorCode(err))
}

func TestPollingOperationErrorRetainsInterestAndUnsubscribeCancelsNativeWork(t *testing.T) {
	var calls atomic.Int32
	waiting := make(chan struct{}, 1)
	cancelled := make(chan struct{}, 1)
	fixture := newNativeMetricFixture(t, func(ctx *sdkmetric.QueryContext, _ sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
		switch calls.Add(1) {
		case 1:
			return nil, resourcev2.NewError("TIMEOUT", "Temporary native sampler timeout.")
		case 2:
			return sampleNativeRuntimeMetric(nativeRuntimeMetricName, sdkmetric.ShapeCurrent)
		default:
			select {
			case waiting <- struct{}{}:
			default:
			}
			<-ctx.Done()
			select {
			case cancelled <- struct{}{}:
			default:
			}
			return nil, ctx.Err()
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctrl := NewController(logging.NewNop(), nil, fixture.resources).(*controller)
	require.NoError(t, ctrl.ServiceStartup(ctx, application.ServiceOptions{}))
	events := make(chan metricRecordedEvent, 32)
	ctrl.emitter = metricRecordingEmitter{events: events}
	require.NoError(t, ctrl.OnPluginStart(nativeMetricPluginID, config.PluginMeta{}, fixture.backend))
	t.Cleanup(func() { _ = ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}) })
	id, err := ctrl.Subscribe(nativeMetricPluginID, nativeMetricConnectionID, SubscribeRequest{ResourceKey: nativeMetricResourceKey, Interval: 200 * time.Millisecond})
	require.NoError(t, err)
	fixture.waitMetricRPCStarted(t)
	select {
	case event := <-events:
		require.Equal(t, "core/metrics/error/"+id, event.key)
		payload, ok := event.data[0].(string)
		require.True(t, ok)
		var output sdkmetric.StreamOutput
		require.NoError(t, json.Unmarshal([]byte(payload), &output))
		require.Equal(t, "TIMEOUT", output.OperationError.Code)
	case <-time.After(5 * time.Second):
		t.Fatal("native polling error did not reach its interest")
	}
	select {
	case event := <-events:
		require.Equal(t, "core/metrics/data/"+id, event.key)
		payload, ok := event.data[0].(string)
		require.True(t, ok)
		var output sdkmetric.StreamOutput
		require.NoError(t, json.Unmarshal([]byte(payload), &output))
		require.Equal(t, float64(runtime.GOMAXPROCS(0)), output.Results[0].CurrentValue.Value)
	case <-time.After(5 * time.Second):
		t.Fatal("successful native recovery was silently discarded")
	}
	select {
	case <-waiting:
	case <-time.After(5 * time.Second):
		t.Fatal("native polling interest did not remain active")
	}
	require.NoError(t, ctrl.Unsubscribe(id))
	select {
	case <-cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("wire unsubscribe did not cancel the actual native operation")
	}
	require.NoError(t, ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}))
	fixture.waitMetricRPCStopped(t)
}
