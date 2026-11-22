package logs

import (
	"context"
	"io"
	"net"
	"strings"
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
	"github.com/omniviewdev/plugin-sdk/pkg/utils/timeutil"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs/logtest"
)

// The legacy log viewer syncs its selected sources 300 ms after any change of the selection, the
// first load included: LogsClient.UpdateSessionOptions(session, {params: {enabled_sources: ''}}).
// A Pod that has already exited has a log that ends in a few milliseconds, so that update lands on a
// session that has ended. On SDK v0.21.0 it restarted the sources that had ended, which streamed
// again after STREAM_ENDED, and one that raced the end could panic the plugin process (SDK B-98: a
// sync.WaitGroup reused). On v0.22.0 an update that would start a source of a session that has
// ended is refused with a classified CONFLICT and changes nothing; the host hands it on as it is,
// and the viewer's catch ignores it (the UI test of useLogSources holds that half).

func TestAnUpdateOfAnEndedSessionIsRefusedAndStartsNothing(t *testing.T) {
	const pluginID = "short-lived-logs"
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	t.Cleanup(cancel)

	// A Pod that has already exited: two sources whose logs hold three lines and end.
	handler := sdklogs.Handler{
		Plugin: "test", Resource: "pod",
		Handler: func(*sdktypes.PluginContext, sdklogs.LogStreamRequest) (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader("2026-11-22T10:00:00Z one\n2026-11-22T10:00:01Z two\n2026-11-22T10:00:02Z three\n")), nil
		},
		SourceBuilder: logtest.MultiSourceBuilder("a", "b"),
	}
	manager := sdklogs.NewManager(sdklogs.ManagerConfig{
		Logger: logging.NewNop(), Clock: timeutil.NewInstantFakeClock(), Handlers: map[string]sdklogs.Handler{"test/pod": handler},
	})
	manager.BindConnectionContextProvider(aLeaseThatRunsTheCallback{})
	t.Cleanup(manager.Close)
	server := grpc.NewServer(sdkutils.RegisterServerOpts(nil, logging.NewNop())...)
	logPlugin := &sdklogs.Plugin{Impl: manager}
	require.NoError(t, logPlugin.GRPCServer(nil, server))
	listener := bufconn.Listen(1024 * 1024)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { server.Stop(); _ = listener.Close() })
	//nolint:staticcheck // Match the existing host bufconn integration convention.
	transport, err := grpc.DialContext(ctx, "passthrough:///short-lived-logs",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithChainUnaryInterceptor(sdk.ClientPluginContextInterceptor(logging.NewNop())),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = transport.Close() })
	client, err := logPlugin.GRPCClient(ctx, nil, transport)
	require.NoError(t, err)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"log": client}})

	window := newEventRecorder()
	ctrl := aLaneController(t, immediateUIConnection{})
	ctrl.ctx = ctx
	ctrl.emitter = window
	t.Cleanup(func() { cancel(); _ = ctrl.OnPluginStop(pluginID, config.PluginMeta{ID: pluginID}) })
	require.NoError(t, ctrl.OnPluginStart(pluginID, config.PluginMeta{ID: pluginID}, backend))
	go ctrl.runMux()

	session, err := ctrl.CreateSession(ctx, pluginID, "route", sdklogs.CreateSessionOptions{
		ResourceKey: "pod", ResourceID: "pod", Options: sdklogs.LogSessionOptions{IncludeTimestamps: true, IncludeSourceEvents: true},
	})
	require.NoError(t, err)
	const linesOfTheSession = 6
	window.linesOf(t, session.ID, linesOfTheSession)
	require.Eventually(t, func() bool {
		for _, event := range eventsOf(t, window, session.ID) {
			if event.Type == sdklogs.StreamEventStreamEnded {
				return true
			}
		}
		return false
	}, 10*time.Second, 2*time.Millisecond, "the session did not end")
	eventsAtTheEnd := len(eventsOf(t, window, session.ID))

	// The viewer's sync, for all the sources and for one of them: what it sends decodes into options
	// with only Params set.
	for _, selection := range []string{"", "a"} {
		_, updateErr := ctrl.UpdateSessionOptions(session.ID, sdklogs.LogSessionOptions{Params: map[string]string{"enabled_sources": selection}})
		require.Error(t, updateErr, "an update that would start a source of an ended session is refused (selection %q)", selection)
		require.Equal(t, "CONFLICT", sdkresource.ErrorCode(updateErr))
		require.Equal(t, codes.Aborted, status.Code(updateErr), "the SDK says Aborted on the wire")
		// What the host composes of the class for a window that shows it: its own words, not the plugin's.
		shown := apperror.ForResource(updateErr, "")
		require.Equal(t, apperror.TypeResourceConflict, shown.Type)
		require.Equal(t, 409, shown.Status)
		require.Equal(t, "Conflict", shown.Title)
		require.Equal(t, "refreshContract", shown.Recovery)
	}

	// Nothing started: the sources that ended did not stream again (v0.21.0 restarted them), the
	// window was told of nothing more, and the session is still the host's to read and to close.
	time.Sleep(300 * time.Millisecond)
	require.Len(t, window.linesOf(t, session.ID, linesOfTheSession), linesOfTheSession, "an ended source streamed again after the end")
	require.Len(t, eventsOf(t, window, session.ID), eventsAtTheEnd, "the window was told of more after the end")
	current, err := ctrl.GetSession(session.ID)
	require.NoError(t, err)
	require.Equal(t, session.ID, current.ID)

	// An update that starts no source is applied on an ended session as it always was.
	_, err = ctrl.UpdateSessionOptions(session.ID, sdklogs.LogSessionOptions{TailLines: 5, Params: map[string]string{"keep": "me"}})
	require.NoError(t, err, "an update that starts no source is applied")
	require.NoError(t, ctrl.CloseSession(session.ID))
}
