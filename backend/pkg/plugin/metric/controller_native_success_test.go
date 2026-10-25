package metric

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"runtime"
	runtimemetrics "runtime/metrics"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/utils"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/v1/resource/plugin"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/v1/resource"
)

const (
	nativeMetricPluginID     = "native-runtime"
	nativeMetricConnectionID = "own-process"
	nativeMetricResourceKey  = "native::v1::Process"
	nativeRuntimeMetricName  = "/sched/gomaxprocs:threads"
	nativeRuntimeMetricID    = "go.gomaxprocs"
)

// This exercises the migrated host GetConnection consumer, not a resource-service
// forwarding mock: the host loads connection metadata from the registered SDK
// resource controller over gRPC, then the metric RPC's actual SDK interceptors
// carry that connection to the SDK metric manager's native collector.
func TestQueryRegisteredNativeRuntimeMetricThroughConnectionGRPC(t *testing.T) {
	fixture := newNativeMetricFixture(t, func(ctx *sdkmetric.QueryContext, req sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error) {
		if ctx == nil || ctx.Connection == nil {
			return nil, errors.New("native metric query requires its selected connection")
		}
		pid, ok := ctx.Connection.Data["process_id"].(string)
		if !ok || pid != strconv.Itoa(os.Getpid()) {
			return nil, errors.New("native metric connection does not select the owned process")
		}
		name, ok := ctx.Connection.Data["runtime_metric"].(string)
		if !ok || name != nativeRuntimeMetricName {
			return nil, errors.New("native metric connection has no supported runtime sampler")
		}
		if req.ResourceID != pid || req.ResourceKey != nativeMetricResourceKey {
			return nil, errors.New("native metric query selects a different resource")
		}
		return sampleNativeRuntimeMetric(name, req.Shape)
	})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	ctrl := NewController(logging.NewNop(), nil, fixture.resources)
	// ServiceStartup only captures the lifecycle context/app pointer. No Wails
	// application, event transport, window or metric subscription is constructed.
	require.NoError(t, ctrl.ServiceStartup(ctx, application.ServiceOptions{}))
	require.NoError(t, ctrl.OnPluginStart(nativeMetricPluginID, config.PluginMeta{}, fixture.backend))
	t.Cleanup(func() {
		if err := ctrl.OnPluginStop(nativeMetricPluginID, config.PluginMeta{}); err != nil {
			t.Errorf("metric plugin shutdown failed: %v", err)
		}
		cancel()
		fixture.waitMetricRPCStopped(t)
	})
	fixture.waitMetricRPCStarted(t)

	providers := ctrl.GetProvidersForResource(nativeMetricResourceKey)
	require.Len(t, providers, 1)
	require.Equal(t, nativeMetricPluginID, providers[0].PluginID)
	require.Equal(t, nativeMetricPluginID, providers[0].ProviderID)
	require.Equal(t, "Owned Go runtime", providers[0].Name)
	require.Len(t, providers[0].Handlers, 1)
	require.Equal(t, nativeMetricResourceKey, providers[0].Handlers[0].Resource)
	require.Len(t, providers[0].Handlers[0].Metrics, 1)
	descriptor := providers[0].Handlers[0].Metrics[0]
	require.Equal(t, nativeRuntimeMetricID, descriptor.ID)
	require.Equal(t, "GOMAXPROCS", descriptor.Name)
	require.Equal(t, sdkmetric.UnitCount, descriptor.Unit)
	require.Equal(t, []sdkmetric.MetricShape{sdkmetric.ShapeCurrent, sdkmetric.ShapeTimeseries}, descriptor.SupportedShapes)

	for _, shape := range []sdkmetric.MetricShape{sdkmetric.ShapeCurrent, sdkmetric.ShapeTimeseries} {
		started := time.Now()
		response, err := ctrl.Query(nativeMetricPluginID, nativeMetricConnectionID, sdkmetric.QueryRequest{
			ResourceKey: nativeMetricResourceKey,
			ResourceID:  strconv.Itoa(os.Getpid()),
			MetricIDs:   []string{nativeRuntimeMetricID},
			Shape:       shape,
		})
		ended := time.Now()
		require.NoError(t, err)
		require.True(t, response.Success)
		require.Empty(t, response.Error)
		if shape == sdkmetric.ShapeCurrent {
			require.Len(t, response.Results, 1)
			current := response.Results[0].CurrentValue
			require.NotNil(t, current)
			require.Equal(t, nativeRuntimeMetricID, current.MetricID)
			require.Equal(t, float64(runtime.GOMAXPROCS(0)), current.Value)
			require.Equal(t, map[string]string{"pid": strconv.Itoa(os.Getpid()), "unit": "threads"}, current.Labels)
			require.False(t, current.Timestamp.Before(started))
			require.False(t, current.Timestamp.After(ended))
		} else {
			require.Len(t, response.Results, 1)
			series := response.Results[0].TimeSeries
			require.NotNil(t, series)
			require.Equal(t, nativeRuntimeMetricID, series.MetricID)
			require.Len(t, series.DataPoints, 2)
			for _, point := range series.DataPoints {
				require.Equal(t, float64(runtime.GOMAXPROCS(0)), point.Value)
				require.False(t, point.Timestamp.Before(started))
				require.False(t, point.Timestamp.After(ended))
			}
			require.False(t, series.DataPoints[1].Timestamp.Before(series.DataPoints[0].Timestamp))
		}
	}
}

// The value comes from the Go runtime itself. Connection metadata selects the
// sampler; neither a request field nor a context marker supplies the result.
func sampleNativeRuntimeMetric(name string, shape sdkmetric.MetricShape) (*sdkmetric.QueryResponse, error) {
	read := func() (sdkmetric.CurrentValue, error) {
		samples := [1]runtimemetrics.Sample{{Name: name}}
		runtimemetrics.Read(samples[:])
		if samples[0].Value.Kind() != runtimemetrics.KindUint64 {
			return sdkmetric.CurrentValue{}, fmt.Errorf("runtime metric %q is not an unsigned native counter", name)
		}
		return sdkmetric.CurrentValue{
			MetricID:  nativeRuntimeMetricID,
			Value:     float64(samples[0].Value.Uint64()),
			Timestamp: time.Now(),
			Labels:    map[string]string{"pid": strconv.Itoa(os.Getpid()), "unit": "threads"},
		}, nil
	}
	first, err := read()
	if err != nil {
		return nil, err
	}
	switch shape {
	case sdkmetric.ShapeCurrent:
		return &sdkmetric.QueryResponse{Success: true, Results: []sdkmetric.MetricResult{{CurrentValue: &first}}}, nil
	case sdkmetric.ShapeTimeseries:
		second, err := read()
		if err != nil {
			return nil, err
		}
		return &sdkmetric.QueryResponse{Success: true, Results: []sdkmetric.MetricResult{{TimeSeries: &sdkmetric.TimeSeries{
			MetricID: nativeRuntimeMetricID,
			Labels:   first.Labels,
			DataPoints: []sdkmetric.DataPoint{
				{Timestamp: first.Timestamp, Value: first.Value, Labels: first.Labels},
				{Timestamp: second.Timestamp, Value: second.Value, Labels: second.Labels},
			},
		}}}}, nil
	default:
		return nil, errors.New("unsupported native runtime metric shape")
	}
}

type nativeMetricFixture struct {
	resources     hostresource.Controller
	backend       *plugintypes.InProcessBackend
	metricStarted <-chan struct{}
	metricStopped <-chan struct{}
}

func newNativeMetricFixture(t *testing.T, query sdkmetric.QueryFunc) *nativeMetricFixture {
	t.Helper()
	rootCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	state := appstate.NewTestService(t)
	connections := &nativeRuntimeConnections{released: make(chan error, 1)}
	resourceManager, err := sdkresource.BuildResourceController(rootCtx, sdkresource.ResourcePluginConfig[os.Process]{
		Connections: connections,
		Resources: []sdkresource.ResourceRegistration[os.Process]{{
			Meta:      sdkresource.ResourceMeta{Group: "native", Version: "v1", Kind: "Process"},
			Resourcer: nativeRuntimeResourcer{},
		}},
	})
	require.NoError(t, err)
	t.Cleanup(resourceManager.Close)
	manager := sdkmetric.NewManager(logging.NewNop(), nil,
		sdkmetric.ProviderInfo{ID: nativeMetricPluginID, Name: "Owned Go runtime"},
		map[string]sdkmetric.Handler{nativeMetricResourceKey: {
			Resource: nativeMetricResourceKey,
			Metrics: []sdkmetric.MetricDescriptor{{ID: nativeRuntimeMetricID, Name: "GOMAXPROCS", Unit: sdkmetric.UnitCount,
				SupportedShapes: []sdkmetric.MetricShape{sdkmetric.ShapeCurrent, sdkmetric.ShapeTimeseries}}},
		}}, query, nil)
	started := make(chan struct{}, 1)
	stopped := make(chan struct{}, 1)
	options := utils.RegisterServerOpts(nil, logging.NewNop())
	options = append(options, grpc.ChainStreamInterceptor(func(server any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if strings.HasSuffix(info.FullMethod, "/StreamMetrics") {
			started <- struct{}{}
			defer func() { stopped <- struct{}{} }()
		}
		return handler(server, stream)
	}))
	server := grpc.NewServer(options...)
	resourcepb.RegisterResourcePluginServer(server, resourceplugin.NewServer(resourceManager, nil))
	metricPlugin := &sdkmetric.Plugin{Impl: manager}
	require.NoError(t, metricPlugin.GRPCServer(nil, server))
	listener := bufconn.Listen(1024 * 1024)
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	var connection *grpc.ClientConn
	t.Cleanup(func() {
		if connection != nil {
			if err := connection.Close(); err != nil {
				t.Errorf("owned metric gRPC connection close failed: %v", err)
			}
		}
		server.Stop()
		if err := listener.Close(); err != nil {
			t.Errorf("owned metric gRPC listener close failed: %v", err)
		}
		select {
		case serveErr := <-served:
			if serveErr != nil && !errors.Is(serveErr, grpc.ErrServerStopped) {
				t.Errorf("owned metric gRPC server failed: %v", serveErr)
			}
		case <-time.After(5 * time.Second):
			t.Error("owned metric gRPC server did not stop")
		}
	})
	dialCtx, dialCancel := context.WithTimeout(rootCtx, 5*time.Second)
	defer dialCancel()
	dialOptions := sdk.GRPCDialOptionsWithLogger(logging.NewNop())
	dialOptions = append(dialOptions, grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
		return listener.DialContext(ctx)
	}), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithBlock())
	//nolint:staticcheck // Matches the repository's real bufconn integration convention.
	connection, err = grpc.DialContext(dialCtx, "bufnet", dialOptions...)
	require.NoError(t, err)
	metricClient, err := metricPlugin.GRPCClient(rootCtx, nil, connection)
	require.NoError(t, err)
	client, ok := metricClient.(sdkmetric.Provider)
	require.True(t, ok)
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{
		"resource": resourceplugin.NewClient(resourcepb.NewResourcePluginClient(connection)),
		"metric":   client,
	})
	resources := hostresource.NewController(logging.NewNop(), nil, state.PluginStore, invocation.NewBoundary(nil))
	resources.Run(rootCtx)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, stopErr := resources.StopConnection(invocation.HostContext(cleanupCtx), nativeMetricPluginID, nativeMetricConnectionID)
		if stopErr != nil {
			t.Errorf("native resource connection stop failed: %v", stopErr)
		} else {
			select {
			case releaseErr := <-connections.released:
				if releaseErr != nil {
					t.Errorf("native process handle release failed: %v", releaseErr)
				}
			case <-time.After(5 * time.Second):
				t.Error("native process handle release was not acknowledged")
			}
		}
		if err := resources.OnPluginShutdown(nativeMetricPluginID, config.PluginMeta{}); err != nil {
			t.Errorf("resource plugin shutdown failed: %v", err)
		}
		if err := resources.(interface{ ServiceShutdown() error }).ServiceShutdown(); err != nil {
			t.Errorf("resource service shutdown failed: %v", err)
		}
	})
	require.NoError(t, resources.OnPluginStart(nativeMetricPluginID, config.PluginMeta{}, backend))
	connectionCtx, connectionCancel := context.WithTimeout(rootCtx, 5*time.Second)
	defer connectionCancel()
	status, err := resources.StartConnection(invocation.HostContext(connectionCtx), nativeMetricPluginID, nativeMetricConnectionID)
	require.NoError(t, err)
	require.Equal(t, sdktypes.ConnectionStatusConnected, status.Status)
	return &nativeMetricFixture{resources: resources, backend: backend, metricStarted: started, metricStopped: stopped}
}

func (f *nativeMetricFixture) waitMetricRPCStarted(t *testing.T) {
	t.Helper()
	select {
	case <-f.metricStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("real metric RPC did not start")
	}
}

func (f *nativeMetricFixture) waitMetricRPCStopped(t *testing.T) {
	t.Helper()
	select {
	case <-f.metricStopped:
	case <-time.After(5 * time.Second):
		t.Error("real metric RPC handler did not return after cancellation")
	}
}

// Native connection metadata is produced from this owned process. The SDK's
// actual resource lifecycle loads it, creates a real process handle, and closes
// that handle on disconnect; no host GetConnection substitute is installed.
type nativeRuntimeConnections struct {
	released chan error
}

func (nativeRuntimeConnections) LoadConnections(context.Context) ([]sdktypes.Connection, error) {
	return []sdktypes.Connection{{ID: nativeMetricConnectionID, Name: "Owned process", Data: map[string]interface{}{
		"process_id": strconv.Itoa(os.Getpid()), "runtime_metric": nativeRuntimeMetricName,
	}}}, nil
}

func (nativeRuntimeConnections) CreateClient(ctx context.Context) (*os.Process, error) {
	session := sdkresource.SessionFromContext(ctx)
	if session == nil || session.Connection == nil || session.Connection.Data["process_id"] != strconv.Itoa(os.Getpid()) {
		return nil, errors.New("native connection does not select this process")
	}
	return os.FindProcess(os.Getpid())
}

func (c nativeRuntimeConnections) DestroyClient(_ context.Context, process *os.Process) error {
	err := process.Release()
	c.released <- err
	return err
}

func (nativeRuntimeConnections) CheckConnection(_ context.Context, connection *sdktypes.Connection, process *os.Process) (sdktypes.ConnectionStatus, error) {
	if process.Pid != os.Getpid() {
		return sdktypes.ConnectionStatus{}, errors.New("native connection selected another process")
	}
	return sdktypes.ConnectionStatus{Connection: connection, Status: sdktypes.ConnectionStatusConnected}, nil
}

func (nativeRuntimeConnections) GetNamespaces(context.Context, *os.Process) ([]string, error) {
	return nil, nil
}

type nativeRuntimeResourcer struct{}

func (nativeRuntimeResourcer) Get(_ context.Context, process *os.Process, _ sdkresource.ResourceMeta, input sdkresource.GetInput) (*sdkresource.GetResult, error) {
	if input.ID != strconv.Itoa(process.Pid) {
		return nil, errors.New("native process resource not found")
	}
	data, err := json.Marshal(map[string]interface{}{"pid": process.Pid, "gomaxprocs": runtime.GOMAXPROCS(0)})
	if err != nil {
		return nil, err
	}
	return &sdkresource.GetResult{Success: true, Result: data}, nil
}

func (r nativeRuntimeResourcer) List(ctx context.Context, process *os.Process, meta sdkresource.ResourceMeta, _ sdkresource.ListInput) (*sdkresource.ListResult, error) {
	result, err := r.Get(ctx, process, meta, sdkresource.GetInput{ID: strconv.Itoa(process.Pid)})
	if err != nil {
		return nil, err
	}
	return &sdkresource.ListResult{Success: true, Result: []json.RawMessage{result.Result}}, nil
}

func (nativeRuntimeResourcer) Find(context.Context, *os.Process, sdkresource.ResourceMeta, sdkresource.FindInput) (*sdkresource.FindResult, error) {
	return nil, errors.New("native runtime resources do not support search")
}

func (nativeRuntimeResourcer) Create(context.Context, *os.Process, sdkresource.ResourceMeta, sdkresource.CreateInput) (*sdkresource.CreateResult, error) {
	return nil, errors.New("native runtime resources are read-only")
}

func (nativeRuntimeResourcer) Update(context.Context, *os.Process, sdkresource.ResourceMeta, sdkresource.UpdateInput) (*sdkresource.UpdateResult, error) {
	return nil, errors.New("native runtime resources are read-only")
}

func (nativeRuntimeResourcer) Delete(context.Context, *os.Process, sdkresource.ResourceMeta, sdkresource.DeleteInput) (*sdkresource.DeleteResult, error) {
	return nil, errors.New("native runtime resources are read-only")
}
