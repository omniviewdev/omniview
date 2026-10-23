package plugin

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
)

type lifecycleRPCFixture struct {
	lifecyclepb.UnimplementedPluginLifecycleServer
	id                string
	protocol          int32
	status            lifecyclepb.ServingStatus
	capabilitiesError error
}

func (f *lifecycleRPCFixture) GetInfo(context.Context, *emptypb.Empty) (*lifecyclepb.GetInfoResponse, error) {
	return &lifecyclepb.GetInfoResponse{PluginId: f.id, SdkProtocolVersion: f.protocol}, nil
}
func (f *lifecycleRPCFixture) HealthCheck(context.Context, *emptypb.Empty) (*lifecyclepb.HealthCheckResponse, error) {
	return &lifecyclepb.HealthCheckResponse{Status: f.status}, nil
}
func (f *lifecycleRPCFixture) GetCapabilities(context.Context, *emptypb.Empty) (*lifecyclepb.GetCapabilitiesResponse, error) {
	return &lifecyclepb.GetCapabilitiesResponse{Capabilities: []string{"exec"}}, f.capabilitiesError
}

func serveLifecycleFixture(t *testing.T, fixture *lifecycleRPCFixture) (*lc.Client, *grpc.Server) {
	t.Helper()
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	lifecyclepb.RegisterPluginLifecycleServer(server, fixture)
	go func() { _ = server.Serve(listener) }()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	connection, err := grpc.DialContext(ctx, "bufnet", grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithBlock())
	require.NoError(t, err)
	t.Cleanup(func() { _ = connection.Close(); server.Stop(); _ = listener.Close() })
	return lc.NewClient(lifecyclepb.NewPluginLifecycleClient(connection)), server
}

func TestManagedReadinessRequiresActualLifecycleIdentityProtocolHealthAndCapabilities(t *testing.T) {
	for _, test := range []struct {
		name, id string
		protocol int32
		status   lifecyclepb.ServingStatus
		capErr   error
		wantErr  bool
	}{
		{name: "serving", id: "fixture", protocol: int32(plugintypes.CurrentProtocolVersion), status: lifecyclepb.ServingStatus_SERVING_STATUS_SERVING},
		{name: "wrong ID", id: "foreign", protocol: int32(plugintypes.CurrentProtocolVersion), status: lifecyclepb.ServingStatus_SERVING_STATUS_SERVING, wantErr: true},
		{name: "wrong protocol", id: "fixture", protocol: 999, status: lifecyclepb.ServingStatus_SERVING_STATUS_SERVING, wantErr: true},
		{name: "not serving", id: "fixture", protocol: int32(plugintypes.CurrentProtocolVersion), status: lifecyclepb.ServingStatus_SERVING_STATUS_NOT_SERVING, wantErr: true},
		{name: "capability RPC fails", id: "fixture", protocol: int32(plugintypes.CurrentProtocolVersion), status: lifecyclepb.ServingStatus_SERVING_STATUS_SERVING, capErr: errors.New("capability failure"), wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			client, _ := serveLifecycleFixture(t, &lifecycleRPCFixture{id: test.id, protocol: test.protocol, status: test.status, capabilitiesError: test.capErr})
			err := verifyLifecycleClient(client, "fixture", plugintypes.CurrentProtocolVersion)
			if test.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
	client, server := serveLifecycleFixture(t, &lifecycleRPCFixture{id: "fixture", protocol: int32(plugintypes.CurrentProtocolVersion), status: lifecyclepb.ServingStatus_SERVING_STATUS_SERVING})
	require.NoError(t, verifyLifecycleClient(client, "fixture", plugintypes.CurrentProtocolVersion))
	server.Stop()
	require.Error(t, verifyLifecycleClient(client, "fixture", plugintypes.CurrentProtocolVersion), "a crashed RPC endpoint must not remain ready")
}

func TestStopDevPluginRetainsInventoryAndRestartsWithFreshBackend(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "stoppable", []string{"exec"}, true)
	source := t.TempDir()
	var backends []*plugintypes.InProcessBackend
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) {
		backend := plugintypes.NewInProcessBackend(map[string]interface{}{"exec": struct{}{}})
		backends = append(backends, backend)
		return backend, nil
	}
	_, err := pm.LoadPlugin("stoppable", &LoadPluginOptions{DevMode: true, DevModePath: source})
	require.NoError(t, err)
	require.NoError(t, pm.StopDevPlugin("stoppable"))
	info, err := pm.GetPlugin("stoppable")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseStopped), info.Phase)
	require.Equal(t, source, info.DevPath)
	require.True(t, info.DevMode)
	require.True(t, info.Enabled)
	require.Len(t, pm.ListPlugins(), 1)
	require.Nil(t, pm.records["stoppable"].Backend)
	require.True(t, backends[0].Exited())
	require.NoError(t, pm.StopDevPlugin("stoppable"), "repeat stop must not reuse old clients")
	info, err = pm.ReloadPlugin("stoppable")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	require.Equal(t, source, info.DevPath)
	require.Len(t, backends, 2)
	require.NotSame(t, backends[0], backends[1])
	require.False(t, backends[1].Exited())
	require.NoError(t, pm.StopDevPlugin("stoppable"))
}

type failingLifecycleController struct{ trackingController }

func (*failingLifecycleController) OnPluginStart(string, config.PluginMeta, plugintypes.PluginBackend) error {
	return errors.New("controller initialization failed")
}

func TestControllerFailureFailsActualLoadAndKillsBackend(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "controller-failure", []string{"exec"}, true)
	backend := plugintypes.NewInProcessBackend(map[string]interface{}{"exec": struct{}{}})
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) { return backend, nil }
	pm.connlessControllers[sdktypes.CapabilityExec] = &failingLifecycleController{}
	_, err := pm.LoadPlugin("controller-failure", &LoadPluginOptions{DevMode: true, DevModePath: t.TempDir()})
	require.ErrorContains(t, err, "controller initialization failed")
	require.Equal(t, lifecycle.PhaseFailed, pm.records["controller-failure"].Phase)
	require.True(t, backend.Exited())
}

func TestLoadRunningPluginRejectsDifferentSource(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "same-id", []string{"ui"}, false)
	sourceA, sourceB := t.TempDir(), t.TempDir()
	_, err := pm.LoadPlugin("same-id", &LoadPluginOptions{DevMode: true, DevModePath: sourceA})
	require.NoError(t, err)
	_, err = pm.LoadPlugin("same-id", &LoadPluginOptions{DevMode: true, DevModePath: sourceB})
	require.ErrorContains(t, err, "another source")
	require.Equal(t, sourceA, pm.records["same-id"].DevPath)
}

func TestCanceledQueuedSourceReloadCannotTouchReboundPlugin(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "queued-rebind", []string{"ui"}, false)
	sourceA, sourceB := t.TempDir(), t.TempDir()
	_, err := pm.LoadPlugin("queued-rebind", &LoadPluginOptions{DevMode: true, DevModePath: sourceB})
	require.NoError(t, err)
	current := pm.records["queued-rebind"]
	lock := pm.pluginOpsLock("queued-rebind")
	lock.Lock()
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- pm.ReloadManagedPlugin(ctx, "queued-rebind", sourceA, "old-generation") }()
	cancel()
	lock.Unlock()
	require.ErrorIs(t, <-result, context.Canceled)
	require.Same(t, current, pm.records["queued-rebind"])
	require.Equal(t, sourceB, pm.records["queued-rebind"].DevPath)
}
