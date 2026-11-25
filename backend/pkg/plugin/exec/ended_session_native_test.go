//go:build darwin || linux

// The fixture runs a real command on a real pseudo-terminal; it does not prove Windows exec.

package exec

import (
	"context"
	"net"
	"os"
	osexec "os/exec"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/interceptors"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// The same, with the plugin's own SDK in the place of the fake: a plugin that serves the real exec manager
// over real gRPC, whose handler runs a real command on a real pseudo-terminal. The host is the controller
// as the application runs it: the plugin's stream is read, its frames reach the multiplexer, and the
// windows are told what the plugin sends.

const (
	shortCommandPlugin    = "short-command-plugin"
	shortCommandProvider  = "short-command-provider"
	shortCommandResource  = "short-command"
	shortCommandConnected = "route"
)

// aShortCommandPlugin is a running plugin with one handler, a shell command, and the host's controller on it.
type aShortCommandPlugin struct {
	ctrl    *controller
	manager *sdkexec.Manager
	window  *aStdoutWindow
}

// aStdoutWindow is what the controller emits to the windows: the names of the events, and what the session
// wrote to its stdout.
type aStdoutWindow struct {
	mu     sync.Mutex
	events []string
	stdout map[string][]byte
}

func (w *aStdoutWindow) Emit(name string, data ...any) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.events = append(w.events, name)
	if id, found := strings.CutPrefix(name, "core/exec/stream/stdout/"); found && len(data) == 1 {
		if bytes, ok := data[0].([]byte); ok {
			w.stdout[id] = append(w.stdout[id], bytes...)
		}
	}

	return false
}

func (w *aStdoutWindow) told(name string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()

	return slices.Contains(w.events, name)
}

func (w *aStdoutWindow) wrote(id string) string {
	w.mu.Lock()
	defer w.mu.Unlock()

	return string(w.stdout[id])
}

// startAShortCommandPlugin starts the plugin whose handler runs script with /bin/sh. With forwarding false
// nobody reads the host's multiplexer: the plugin's frames, the CLOSE signal among them, wait where the host
// has not taken them yet, and the host's record of the session stays as it was.
func startAShortCommandPlugin(t *testing.T, script string, forwarding bool) *aShortCommandPlugin {
	t.Helper()
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)

	handler := sdkexec.Handler{
		Plugin: shortCommandProvider, Resource: shortCommandResource,
		TTYHandler: func(pctx *sdktypes.PluginContext, _ sdkexec.SessionOptions, tty *os.File, stop chan error, _ <-chan sdkexec.SessionResizeInput) error {
			command := osexec.CommandContext(pctx.Context, "/bin/sh", "-c", script)
			command.Stdin, command.Stdout, command.Stderr = tty, tty, tty
			if startErr := command.Start(); startErr != nil {
				return startErr
			}
			go func() {
				_ = command.Wait()
				select {
				case stop <- nil:
				default:
				}
			}()

			return nil
		},
	}
	manager := sdkexec.NewManager(sdkexec.ManagerConfig{
		Logger: logging.NewNop(), Handlers: map[string]sdkexec.Handler{handler.ID(): handler}, TerminalFactory: sdkexec.NewRealTerminalFactory(),
	})
	manager.BindConnectionContextProvider(aLeaseThatRunsTheCallback{})
	t.Cleanup(manager.Close)

	listener := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer(grpc.UnaryInterceptor(interceptors.UnaryPluginContext()), grpc.StreamInterceptor(interceptors.StreamPluginContext()))
	watched := aManagerWhoseStreamIsWatched{Manager: manager, opened: make(chan struct{}), once: &sync.Once{}}
	execPlugin := &sdkexec.Plugin{Impl: watched}
	require.NoError(t, execPlugin.GRPCServer(nil, server))
	go func() { _ = server.Serve(listener) }()
	//nolint:staticcheck // Match the existing host bufconn integration convention.
	transport, err := grpc.DialContext(ctx, "bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return listener.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithUnaryInterceptor(sdk.ClientPluginContextInterceptor(logging.NewNop())),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = transport.Close(); server.Stop(); _ = listener.Close() })
	client, err := execPlugin.GRPCClient(ctx, nil, transport)
	require.NoError(t, err)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"exec": client}})

	ctrl, ok := NewController(logging.NewNop(), nil, aConnectionTheHostHolds{}).(*controller)
	require.True(t, ok, "NewController returns the controller")
	ctrl.ctx = ctx
	window := &aStdoutWindow{mu: sync.Mutex{}, events: nil, stdout: make(map[string][]byte)}
	ctrl.events = window
	ctrl.OnPluginInit(shortCommandPlugin, config.PluginMeta{})
	require.NoError(t, ctrl.OnPluginStart(shortCommandPlugin, config.PluginMeta{}, backend))
	t.Cleanup(func() { cancel(); _ = ctrl.OnPluginStop(shortCommandPlugin, config.PluginMeta{}) })
	// The host's start of the plugin returns before the plugin has the stream it opened, and the SDK drops what a session says
	// before then (emitOutput has no sink): a command that ends at once would say its CLOSE to nobody. In the application a
	// window creates a session long after its plugin started; here the create comes at once, so it waits for the stream.
	select {
	case <-watched.opened:
	case <-time.After(shortCommandWait):
		require.FailNow(t, "the plugin never had the host's stream")
	}
	if forwarding {
		go ctrl.runMux()
	}

	return &aShortCommandPlugin{ctrl: ctrl, manager: manager, window: window}
}

// aManagerWhoseStreamIsWatched is the plugin's exec manager, and the moment the host's stream reaches it.
type aManagerWhoseStreamIsWatched struct {
	*sdkexec.Manager

	opened chan struct{}
	once   *sync.Once
}

func (m aManagerWhoseStreamIsWatched) Stream(ctx context.Context, in chan sdkexec.StreamInput) (chan sdkexec.StreamOutput, error) {
	out, err := m.Manager.Stream(ctx, in)
	m.once.Do(func() { close(m.opened) })

	return out, err
}

// create is the window's CreateSession of the command: a session with an ID of the window's choosing.
func (p *aShortCommandPlugin) create(t *testing.T) string {
	t.Helper()
	id := uuid.NewString()
	session, err := p.ctrl.CreateSession(invocation.HostContext(t.Context()), shortCommandPlugin, shortCommandConnected, sdkexec.SessionOptions{
		ID: id, ResourcePlugin: shortCommandProvider, ResourceKey: shortCommandResource,
	})
	require.NoError(t, err)
	require.Equal(t, id, session.ID)

	return id
}

func (p *aShortCommandPlugin) indexed() int {
	p.ctrl.mu.RLock()
	defer p.ctrl.mu.RUnlock()

	return len(p.ctrl.sessionIndex)
}

const shortCommandWait = 15 * time.Second

// A command that prints and exits before the window attaches: its output reaches the attach that comes after
// the session has ended and said CLOSE. It reaches the first attach and no other, and the host holds no record
// of the session afterwards.
func TestTheOutputOfAShortCommandReachesALateAttach(t *testing.T) {
	plugin := startAShortCommandPlugin(t, `echo hi`, true)
	id := plugin.create(t)

	// Nobody has attached: the session ends by itself, and the windows are told so.
	require.Eventually(t, func() bool { return plugin.window.told("core/exec/signal/CLOSE/" + id) }, shortCommandWait, 5*time.Millisecond,
		"the short command's session did not say CLOSE")
	require.Empty(t, plugin.window.wrote(id), "nothing is sent to a window that is not attached: the output waits for it")

	session, output, err := plugin.ctrl.AttachSession(id)
	require.NoError(t, err, "the output of a session that ended before the attach is for the first attach")
	require.Equal(t, id, session.ID)
	require.Equal(t, "hi\n", string(output))
	require.Zero(t, plugin.indexed(), "the first attach used the host's record of the session up")

	_, _, err = plugin.ctrl.AttachSession(id)
	requireSessionNotFound(t, err, id)
}

// A window that is attached when its session ends sees the output live, and the session is over for it: the
// host's record goes at CLOSE and there is no second attach.
func TestACommandWhoseWindowIsAttachedEndsWithoutARecord(t *testing.T) {
	plugin := startAShortCommandPlugin(t, `IFS= read -r line; printf 'you said %s\n' "$line"`, true)
	id := plugin.create(t)
	_, _, err := plugin.ctrl.AttachSession(id)
	require.NoError(t, err)

	require.NoError(t, plugin.ctrl.WriteSession(id, []byte("hello\n")))
	require.Eventually(t, func() bool { return plugin.window.told("core/exec/signal/CLOSE/" + id) }, shortCommandWait, 5*time.Millisecond,
		"the session did not say CLOSE")
	require.Contains(t, plugin.window.wrote(id), "you said hello")
	require.Zero(t, plugin.indexed())

	_, _, err = plugin.ctrl.AttachSession(id)
	requireSessionNotFound(t, err, id)
}

// SDK v0.22.1: CloseSession of a session that has ended by itself, before the host has been told, says
// not-found. The window asked for the session to be closed and it is: no error, and no record.
func TestClosingASessionThatJustEndedInAPluginIsNotAnError(t *testing.T) {
	plugin := startAShortCommandPlugin(t, `echo hi`, false)
	id := plugin.create(t)

	// The session has left the plugin; its CLOSE waits for a host that is not reading yet.
	require.Eventually(t, func() bool {
		sessions, err := plugin.manager.ListSessions(nil)
		return err == nil && len(sessions) == 0
	}, shortCommandWait, 5*time.Millisecond, "the short command's session did not end")
	require.Equal(t, 1, plugin.indexed(), "the host has not heard of the end")

	require.NoError(t, plugin.ctrl.CloseSession(id))
	require.Zero(t, plugin.indexed())
}
