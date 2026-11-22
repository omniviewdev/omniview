package logs

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
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkutils "github.com/omniviewdev/plugin-sdk/pkg/utils"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// SDK v0.22.0 refuses a log session start that loses its race with the manager's Close (or
// Wait), or that comes after it, with a CONNECTION_ERROR (gRPC Unavailable). It means the
// manager is going away because its plugin is stopping, so a start into the same manager
// cannot succeed: the consumer surfaces it once and the connection lifecycle decides on a
// restart. A host that put the start under a "transient, so reopen" helper would hammer a
// plugin that is shutting down and show the user nothing until the helper gave up.

// aLeaseThatRunsTheCallback stands for the resource controller's connection lease: it admits
// the selected connection and runs the utility's callback, which is all a session start asks
// of it before the manager decides whether it takes the session.
type aLeaseThatRunsTheCallback struct{}

func (aLeaseThatRunsTheCallback) WithConnection(ctx context.Context, route sdkresource.AccessRoute, fn func(context.Context, sdktypes.Connection) error) error {
	return fn(ctx, sdktypes.Connection{ID: route.Connection})
}

// startsOnTheWire counts what the plugin's server was asked to start.
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
	const pluginID = "closing-logs"
	const connectionID = "route"
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	t.Cleanup(cancel)

	manager := sdklogs.NewManager(sdklogs.ManagerConfig{Logger: logging.NewNop()})
	manager.BindConnectionContextProvider(aLeaseThatRunsTheCallback{})
	starts := &startsOnTheWire{}
	server := grpc.NewServer(sdkutils.RegisterServerOpts([]grpc.ServerOption{grpc.ChainUnaryInterceptor(starts.interceptor)}, logging.NewNop())...)
	logPlugin := &sdklogs.Plugin{Impl: manager}
	require.NoError(t, logPlugin.GRPCServer(nil, server))
	listener := bufconn.Listen(1024 * 1024)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { server.Stop(); _ = listener.Close() })
	//nolint:staticcheck // Match the existing host bufconn integration convention.
	transport, err := grpc.DialContext(ctx, "passthrough:///closing-logs",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithChainUnaryInterceptor(sdk.ClientPluginContextInterceptor(logging.NewNop())),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = transport.Close() })
	client, err := logPlugin.GRPCClient(ctx, nil, transport)
	require.NoError(t, err)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"log": client}})

	ctrl := aLaneController(t, immediateUIConnection{})
	ctrl.ctx = ctx
	t.Cleanup(func() { cancel(); _ = ctrl.OnPluginStop(pluginID, config.PluginMeta{ID: pluginID}) })
	require.NoError(t, ctrl.OnPluginStart(pluginID, config.PluginMeta{ID: pluginID}, backend))

	// The plugin is stopping: its manager is closed, and the host has not been told yet.
	manager.Close()

	session, err := ctrl.CreateSession(ctx, pluginID, connectionID, sdklogs.CreateSessionOptions{
		ResourceKey: "pods", ResourceID: "checkout", Options: sdklogs.LogSessionOptions{Follow: true},
	})
	require.Nil(t, session)
	require.Error(t, err)

	// The classification crosses the plugin boundary, and the host hands it on as it is.
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
}

// The Logs tool's finite read starts its session through its own door, and a refusal ends it
// there as well: one start, the error as it is.
func TestAHeadlessReadRefusedBecauseTheProviderIsClosingIsNotRetried(t *testing.T) {
	var asked atomic.Int32
	closing := &closingLogProvider{asked: &asked}
	ctrl := &controller{clients: map[string]Provider{"plugin": closing}, logger: logging.NewNop()}
	ctrl.referenceAdmitter = func(ctx context.Context, _, _ string, _ sdkresource.AccessRoute, _ sdkresource.ResourceReference) (context.Context, error) {
		return ctx, nil
	}
	_, err := ctrl.ReadResourceLogs(context.Background(), "plugin", sdklogs.CreateSessionOptions{
		ResourceKey: "pod", ResourceID: "pod", Route: &sdkresource.AccessRoute{Connection: "route"},
		Reference: &sdkresource.ResourceReference{Address: sdkresource.ResourceAddress{
			Provider: "provider", Authority: "authority", Type: "pod", ID: "pod", Scope: []sdkresource.ScopeEntry{},
		}},
	})
	require.Error(t, err)
	require.Equal(t, "CONNECTION_ERROR", sdkresource.ErrorCode(err))
	require.EqualValues(t, 1, asked.Load())
	time.Sleep(noRetryWindow)
	require.EqualValues(t, 1, asked.Load())
}

// closingLogProvider is the provider of a plugin whose manager has been closed: the refusal
// the SDK's manager gives (CONNECTION_ERROR, "Log manager is closed.").
type closingLogProvider struct {
	Provider
	asked *atomic.Int32
}

func (p *closingLogProvider) CreateResourceSession(*sdktypes.PluginContext, sdklogs.CreateSessionOptions) (*sdklogs.LogSession, error) {
	p.asked.Add(1)
	return nil, sdkresource.NewError("CONNECTION_ERROR", "Log manager is closed.")
}

func (p *closingLogProvider) CloseSession(*sdktypes.PluginContext, string) error {
	return sdkresource.NewError("NOT_FOUND", "Log session was not found.")
}
