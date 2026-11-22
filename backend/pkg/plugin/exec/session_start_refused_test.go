package exec

import (
	"context"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/interceptors"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// SDK v0.22.0 refuses an exec session start that loses its race with the manager's Close, or
// that comes after it, with a CONNECTION_ERROR (gRPC Unavailable), on both RPCs that start a
// session. Before, a start after Close succeeded and leaked its session, and the legacy RPC
// answered with the raw gRPC status. The refusal means the manager is going away because its
// plugin is stopping: the consumer surfaces it once and the connection lifecycle decides on
// a restart. Exec starts must never sit under a "transient, so reopen" helper: a terminal
// that is reopened against a stopping plugin is a terminal that opens, fails and opens again.

// aConnectionTheHostHolds is the host's record of the connection a session is opened on.
type aConnectionTheHostHolds struct{ hostresource.ConnectionReader }

func (aConnectionTheHostHolds) GetConnection(_ context.Context, _, connectionID string) (sdktypes.Connection, error) {
	return sdktypes.Connection{ID: connectionID}, nil
}

// aLeaseThatRunsTheCallback stands for the resource controller's connection lease: it admits
// the selected connection and runs the utility's callback, which is all a resource session
// start asks of it before the manager decides whether it takes the session.
type aLeaseThatRunsTheCallback struct{}

func (aLeaseThatRunsTheCallback) WithConnection(ctx context.Context, route sdkresource.AccessRoute, fn func(context.Context, sdktypes.Connection) error) error {
	return fn(ctx, sdktypes.Connection{ID: route.Connection})
}

// startsOnTheWire counts what the plugin's server was asked to start, on either RPC.
type startsOnTheWire struct{ asked atomic.Int32 }

func (s *startsOnTheWire) interceptor(ctx context.Context, request any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	if strings.HasSuffix(info.FullMethod, "/CreateSession") || strings.HasSuffix(info.FullMethod, "/CreateResourceSession") {
		s.asked.Add(1)
	}
	return handler(ctx, request)
}

// noRetryWindow is how long a retry that runs behind the call is given to show itself: the
// call itself returns only after a retry loop in it has finished.
const noRetryWindow = 300 * time.Millisecond

func TestASessionStartRefusedBecauseTheProviderIsClosingIsNotRetried(t *testing.T) {
	const pluginID = "closing-exec"
	const connectionID = "route"
	for _, start := range []struct {
		name    string
		options sdkexec.SessionOptions
	}{
		{"the legacy start", sdkexec.SessionOptions{ID: "late", Command: []string{"sh"}}},
		{"the resource start", sdkexec.SessionOptions{ID: "late", ResourcePlugin: "test", ResourceKey: "pod"}},
	} {
		t.Run(start.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
			t.Cleanup(cancel)

			manager := sdkexec.NewManager(sdkexec.ManagerConfig{Logger: logging.NewNop()})
			manager.BindConnectionContextProvider(aLeaseThatRunsTheCallback{})
			starts := &startsOnTheWire{}
			server := grpc.NewServer(
				grpc.ChainUnaryInterceptor(starts.interceptor, interceptors.UnaryPluginContext()),
				grpc.StreamInterceptor(interceptors.StreamPluginContext()),
			)
			execPlugin := &sdkexec.Plugin{Impl: manager}
			require.NoError(t, execPlugin.GRPCServer(nil, server))
			listener := bufconn.Listen(1024 * 1024)
			go func() { _ = server.Serve(listener) }()
			t.Cleanup(func() { server.Stop(); _ = listener.Close() })
			//nolint:staticcheck // Match the existing host bufconn integration convention.
			transport, err := grpc.DialContext(ctx, "bufnet",
				grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
				grpc.WithTransportCredentials(insecure.NewCredentials()),
				grpc.WithUnaryInterceptor(sdk.ClientPluginContextInterceptor(logging.NewNop())),
			)
			require.NoError(t, err)
			t.Cleanup(func() { _ = transport.Close() })
			client, err := execPlugin.GRPCClient(ctx, nil, transport)
			require.NoError(t, err)
			backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"exec": client}})

			ctrl, ok := NewController(logging.NewNop(), nil, aConnectionTheHostHolds{}).(*controller)
			require.True(t, ok, "NewController returns the controller")
			ctrl.ctx = ctx
			ctrl.outputMux = make(chan execProviderOutput, 16)
			ctrl.OnPluginInit(pluginID, config.PluginMeta{})
			t.Cleanup(func() { cancel(); _ = ctrl.OnPluginStop(pluginID, config.PluginMeta{}) })
			require.NoError(t, ctrl.OnPluginStart(pluginID, config.PluginMeta{}, backend))

			// The plugin is stopping: its manager is closed, and the host has not been told yet.
			manager.Close()

			session, err := ctrl.CreateSession(ctx, pluginID, connectionID, start.options)
			require.Nil(t, session)
			require.Error(t, err)

			// The classification crosses the plugin boundary on both RPCs (the legacy one carried
			// the raw status and its text before), and the host hands it on as it is.
			require.Equal(t, "CONNECTION_ERROR", sdkresource.ErrorCode(err))
			require.Equal(t, codes.Unavailable, status.Code(err), "the SDK says Unavailable on the wire")
			// What the window makes of the class: one answer, and a way forward that is not a retry.
			shown := apperror.ForResource(err, "")
			require.Equal(t, apperror.TypeConnectionFailed, shown.Type)
			require.Equal(t, "Source unavailable", shown.Title)
			require.Equal(t, "reconnect", shown.Recovery)

			require.EqualValues(t, 1, starts.asked.Load(), "the host asked the closing provider to start a session once")
			time.Sleep(noRetryWindow)
			require.EqualValues(t, 1, starts.asked.Load(), "the host did not try again behind the answer")
			ctrl.mu.RLock()
			require.Empty(t, ctrl.sessionIndex, "the refused session left nothing behind")
			ctrl.mu.RUnlock()
		})
	}
}
