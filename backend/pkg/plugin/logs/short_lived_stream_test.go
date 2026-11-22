package logs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	hclog "github.com/hashicorp/go-hclog"
	goplugin "github.com/hashicorp/go-plugin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// SDK B-98 and its fix (plugin-sdk v0.21.0 to v0.22.0), as the host sees them. The legacy log viewer
// (LogViewer/hooks/useLogSources.ts) calls UpdateSessionOptions 300 ms after any change of its selected sources,
// the first load included; the Wails call decodes {params: {enabled_sources: ''}} into LogSessionOptions with only
// Params set. A Pod that has exited has a log that ends within a few hundred milliseconds, so that update lands at
// or after the end of the session. On v0.21.0 it was applied (nil, the options stored), and one that raced the end
// added a member to a sync.WaitGroup while the session's end called Wait, which panicked the plugin process
// ("sync: WaitGroup is reused before previous Wait has returned"). On v0.22.0 an update that would start a source
// of a session that has ended, or is closing, is refused with a CONFLICT and changes nothing; one that starts no
// source is applied as ever.
//
// The plugin is a real process: this test binary, started again by go-plugin the way the loader starts a plugin
// (handshake, automatic mTLS, the SDK's dial options), serving a real logs.Manager and the lifecycle capability
// through the SDK's gRPC server, with its panic recovery. Its stderr and exit status are read, so a crash is
// measured. The host is this package's controller on the SDK's PluginClient to that process, driven through
// ServiceWrapper. Two stand-ins: the connection is a bare Connection, and the plugin's lease on it holds nothing.

const (
	shortLivedChildEnv   = "OMNIVIEW_SHORTLIVED_LOGS_CHILD"
	shortLivedParentEnv  = "OMNIVIEW_SHORTLIVED_LOGS_PARENT"
	shortLivedPluginID   = "shortlived-logs"
	shortLivedConnection = "shortlived-connection"
	shortLivedKey        = "pod"
	shortLivedLines      = 4 // lines of the log of each container
	shortLivedApplied    = "applied"
	shortLivedConflict   = "CONFLICT"
	shortLivedWait       = 30 * time.Second // bounds every wait for something that has to happen
)

// ============================== the plugin process ==============================

// TestShortLivedStreamChildProcess is not a test: it is the plugin process. The tests start this binary again with
// the environment variable set, and it serves until it is stopped. Without the variable it does nothing.
func TestShortLivedStreamChildProcess(_ *testing.T) {
	if os.Getenv(shortLivedChildEnv) != "" {
		shortLivedServe()
	}
}

// shortLivedServe is the plugin's main: a logs.Manager with one resource whose logs are finite, served with the
// handshake, capabilities and gRPC server factory of a plugin built on the SDK. Only errors are logged to stderr,
// which is what the SDK's panic recovery writes when it keeps the process alive.
func shortLivedServe() {
	log := logging.New(logging.Config{
		Name:    "plugin",
		Level:   logging.NewLevelController(logging.LevelError),
		Backend: logging.NewDefaultHCLBackend(shortLivedPluginID, logging.LevelError),
	})
	logging.SetDefault(log)
	pods := &shortLivedPods{ends: make(map[string]time.Time)}
	manager := sdklogs.NewManager(sdklogs.ManagerConfig{
		Logger: log,
		Handlers: map[string]sdklogs.Handler{shortLivedPluginID + "/" + shortLivedKey: {
			Plugin: shortLivedPluginID, Resource: shortLivedKey, SourceBuilder: pods.sources, Handler: pods.open,
		}},
	})
	manager.BindConnectionContextProvider(shortLivedLease{})
	go func() { // end with the test binary that started this process, which leaves it to another parent when it dies
		for host, err := strconv.Atoi(os.Getenv(shortLivedParentEnv)); err == nil; time.Sleep(200 * time.Millisecond) {
			if os.Getppid() != host {
				os.Exit(3)
			}
		}
	}()
	goplugin.Serve(&goplugin.ServeConfig{
		HandshakeConfig: (&config.PluginMeta{ID: shortLivedPluginID}).GenerateHandshakeConfig(),
		VersionedPlugins: map[int]goplugin.PluginSet{sdk.CurrentProtocolVersion: {
			"log": &sdklogs.Plugin{Impl: manager},
			"lifecycle": &lc.Plugin{Impl: &lc.Server{
				PluginID: shortLivedPluginID, SDKProtocolVersion: sdk.CurrentProtocolVersion, Capabilities: []string{"log"},
			}},
		}},
		GRPCServer: func(options []grpc.ServerOption) *grpc.Server { return sdk.GRPCServerFactoryWithLogger(log, options) },
	})
	manager.Close()
	os.Exit(0)
}

// shortLivedLease is the plugin's lease on a connection: it runs the call with the connection and holds nothing.
type shortLivedLease struct{}

func (shortLivedLease) WithConnection(ctx context.Context, route resourcev2.AccessRoute, run func(context.Context, sdktypes.Connection) error) error {
	return run(ctx, sdktypes.Connection{ID: route.Connection})
}

// shortLivedPods are the Pods the plugin serves, each named "<a ms>,<b ms>,<token>": containers a and b whose logs
// end after that many milliseconds. It holds when the read of each log ends: the first read takes that long, a read
// of the same log that starts before the end joins it and ends with it, as a node serves one log to every reader,
// and a read that starts after the end is instant.
type shortLivedPods struct {
	mu   sync.Mutex
	ends map[string]time.Time
}

func (p *shortLivedPods) sources(resourceID string, _ *resourcev2.Value, _ sdklogs.LogSessionOptions) []sdklogs.LogSource {
	fields := append(strings.SplitN(resourceID, ",", 3), "", "")
	return []sdklogs.LogSource{
		{ID: "a", Labels: map[string]string{"ms": fields[0], "pod": resourceID}},
		{ID: "b", Labels: map[string]string{"ms": fields[1], "pod": resourceID}},
	}
}

// open opens the log of one container: four lines, the last of them at the end of the read, and then its end.
func (p *shortLivedPods) open(pctx *sdktypes.PluginContext, request sdklogs.LogStreamRequest) (io.ReadCloser, error) {
	milliseconds, err := strconv.Atoi(request.Labels["ms"])
	if err != nil {
		return nil, err
	}
	key := request.Labels["pod"] + "/" + request.SourceID
	p.mu.Lock()
	end, known := p.ends[key]
	if !known {
		end = time.Now().Add(time.Duration(milliseconds) * time.Millisecond)
		p.ends[key] = end
	}
	p.mu.Unlock()
	return &shortLivedReader{ctx: pctx.Context, source: request.SourceID, done: make(chan struct{}),
		gap: max(time.Until(end), 0) / (shortLivedLines - 1)}, nil
}

// shortLivedReader reads a finite log: a line at once, the others a gap apart, and then the end.
type shortLivedReader struct {
	ctx    context.Context
	source string
	gap    time.Duration
	next   int
	done   chan struct{}
	once   sync.Once
}

func (r *shortLivedReader) Read(buffer []byte) (int, error) {
	if r.next == shortLivedLines {
		return 0, io.EOF
	}
	if r.next > 0 && r.gap > 0 {
		timer := time.NewTimer(r.gap)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-r.done:
			return 0, io.EOF
		case <-r.ctx.Done():
			return 0, io.EOF
		}
	}
	r.next++
	return copy(buffer, r.source+" line "+strconv.Itoa(r.next)+"\n"), nil
}

func (r *shortLivedReader) Close() error {
	r.once.Do(func() { close(r.done) })
	return nil
}

// ============================== the host's side of the process ==============================

// shortLivedStderr is a writer that can be read while the plugin's stderr is still being written to it.
type shortLivedStderr struct {
	mu   sync.Mutex
	text bytes.Buffer
}

func (s *shortLivedStderr) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.text.Write(p)
}

func (s *shortLivedStderr) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.text.String()
}

// shortLivedFault returns what a plugin's stderr says about a failure (a panic, a fatal error, a data race report,
// or a panic that the SDK's interceptor recovered) with the lines after it, or "" when it says none.
func shortLivedFault(stderr string) string {
	for _, marker := range []string{"panic: ", "fatal error: ", "WARNING: DATA RACE", "panic recovered in"} {
		if at := strings.Index(stderr, marker); at >= 0 {
			lines := strings.SplitAfterN(stderr[at:], "\n", 15)
			return "\n" + strings.Join(lines[:min(len(lines), 14)], "")
		}
	}
	return ""
}

// shortLivedChild is the plugin process as the tests hold it: go-plugin's client, the SDK's log and lifecycle
// clients dispensed from it, and what can be read of the process: its pid, its stderr, its exit.
type shortLivedChild struct {
	client    *goplugin.Client
	cmd       *exec.Cmd
	stderr    *shortLivedStderr
	pid       int
	logs      *sdklogs.PluginClient
	lifecycle *lc.Client
	stopping  atomic.Bool // the test asked it to stop: its exit is not a crash
}

// startShortLivedChild starts the plugin process the way the loader does (without the broker multiplexing the loader
// asks for, which the log capability does not use and whose muxer races os.Stderr in go-plugin v1.8.0 under -race)
// and waits for its handshake. When the test ends the process is stopped and its stderr is read for a fault.
func startShortLivedChild(t *testing.T) *shortLivedChild {
	t.Helper()
	executable, err := os.Executable()
	require.NoError(t, err)
	child := &shortLivedChild{stderr: &shortLivedStderr{}}
	child.cmd = exec.Command(executable, "-test.run=^TestShortLivedStreamChildProcess$")
	child.cmd.Env = append(os.Environ(), shortLivedChildEnv+"=1", shortLivedParentEnv+"="+strconv.Itoa(os.Getpid()))
	clientLog := &shortLivedStderr{} // what go-plugin says, for a start that fails
	child.client = goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig: (&config.PluginMeta{ID: shortLivedPluginID}).GenerateHandshakeConfig(),
		VersionedPlugins: map[int]goplugin.PluginSet{
			sdk.CurrentProtocolVersion: {"log": &sdklogs.Plugin{}, "lifecycle": &lc.Plugin{}},
		},
		Cmd: child.cmd, SkipHostEnv: true, AutoMTLS: true,
		GRPCDialOptions:  sdk.GRPCDialOptions(),
		AllowedProtocols: []goplugin.Protocol{goplugin.ProtocolGRPC},
		StartTimeout:     shortLivedWait,
		Stderr:           child.stderr,
		Logger:           hclog.New(&hclog.LoggerOptions{Name: "shortlived", Output: clientLog, Level: hclog.Debug}),
	})
	t.Cleanup(func() {
		child.stopping.Store(true)
		child.client.Kill()
		if fault := shortLivedFault(child.stderr.String()); fault != "" {
			t.Errorf("the plugin process (pid %d) wrote a fault to its stderr: %s", child.pid, fault)
		}
		t.Logf("plugin process pid %d ended: %v", child.pid, child.cmd.ProcessState)
	})
	rpcClient, err := child.client.Client()
	require.NoErrorf(t, err, "the plugin process did not start; go-plugin said:\n%s\nits stderr:\n%s", clientLog, child.stderr)
	child.pid = child.client.ReattachConfig().Pid
	rawLogs, err := rpcClient.Dispense("log")
	require.NoError(t, err)
	rawLifecycle, err := rpcClient.Dispense("lifecycle")
	require.NoError(t, err)
	var logsOK, lifecycleOK bool
	child.logs, logsOK = rawLogs.(*sdklogs.PluginClient)
	child.lifecycle, lifecycleOK = rawLifecycle.(*lc.Client)
	require.True(t, logsOK && lifecycleOK, "the capabilities are %T and %T", rawLogs, rawLifecycle)
	profiling, err := child.lifecycle.GetProfilingStatus(t.Context())
	require.NoError(t, err)
	require.Equal(t, int64(child.pid), profiling.GetPid(), "the process that was started is the one that answers")
	t.Logf("plugin process pid %d: %s", child.pid, strings.Join(child.cmd.Args, " "))
	return child
}

func (c *shortLivedChild) exited() bool { return c.client.Exited() }

// crashed says how the plugin process failed, or "" while it has not: it ended before the test asked it to, or its
// stderr holds a fault.
func (c *shortLivedChild) crashed() string {
	var facts []string
	if c.exited() && !c.stopping.Load() {
		facts = append(facts, "the plugin process ended by itself ("+c.cmd.ProcessState.String()+")")
	}
	if fault := shortLivedFault(c.stderr.String()); fault != "" {
		facts = append(facts, "its stderr holds a fault:"+fault)
	}
	return strings.Join(facts, "; ")
}

// await waits for cond until the plugin process has died or the wait is over, and returns whether cond holds.
func (c *shortLivedChild) await(cond func() bool) bool {
	deadline := time.Now().Add(shortLivedWait)
	for !cond() {
		if c.exited() || time.Now().After(deadline) {
			return cond()
		}
		time.Sleep(2 * time.Millisecond)
	}
	return true
}

// ============================== what the host receives ==============================

// shortLivedEvent is a stream event as the tests keep it.
type shortLivedEvent struct {
	kind   sdklogs.LogStreamEventType
	source string
}

// shortLivedWindow is the controller's emitter: what the window receives. The controller emits a batch of lines up
// to BatchFlushInterval after it buffers it and an event at once, so only the events are in the order the plugin sent.
type shortLivedWindow struct {
	mu     sync.Mutex
	lines  map[string]int
	events map[string][]shortLivedEvent
}

func (w *shortLivedWindow) Emit(key string, data ...any) {
	payload, _ := data[0].(string)
	w.mu.Lock()
	defer w.mu.Unlock()
	if session, ok := strings.CutPrefix(key, "core/logs/lines/"); ok {
		var batch []json.RawMessage
		_ = json.Unmarshal([]byte(payload), &batch)
		w.lines[session] += len(batch)
	} else if session, ok = strings.CutPrefix(key, "core/logs/event/"); ok {
		var event sdklogs.LogStreamEvent
		_ = json.Unmarshal([]byte(payload), &event)
		w.events[session] = append(w.events[session], shortLivedEvent{event.Type, event.SourceID})
	}
}

// received is the window's lines for the session, and its events after STREAM_ENDED when that has arrived.
func (w *shortLivedWindow) received(session string) (int, []shortLivedEvent, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	var after []shortLivedEvent
	ended := false
	for _, event := range w.events[session] {
		if ended {
			after = append(after, event)
		}
		ended = ended || event.kind == sdklogs.StreamEventStreamEnded
	}
	return w.lines[session], after, ended
}

// shortLivedAfterEnd is what the plugin sent for a session after STREAM_ENDED.
type shortLivedAfterEnd struct {
	ended  bool
	lines  int
	events []shortLivedEvent
}

// shortLivedTap is the log provider the controller runs on: the SDK's client of the plugin process, which also
// keeps what the plugin sends in the order it arrives at the host, before the controller batches it. A line that
// follows STREAM_ENDED there is a line the plugin sent after it had ended the session.
type shortLivedTap struct {
	*sdklogs.PluginClient
	mu       sync.Mutex
	sessions map[string]*shortLivedAfterEnd
}

func (tap *shortLivedTap) Stream(ctx context.Context, input chan sdklogs.StreamInput) (chan sdklogs.StreamOutput, error) {
	upstream, err := tap.PluginClient.Stream(ctx, input)
	if err != nil {
		return nil, err
	}
	forwarded := make(chan sdklogs.StreamOutput)
	go func() {
		defer close(forwarded)
		for output := range upstream {
			tap.record(output)
			select {
			case forwarded <- output:
			case <-ctx.Done():
				return
			}
		}
	}()
	return forwarded, nil
}

func (tap *shortLivedTap) record(output sdklogs.StreamOutput) {
	tap.mu.Lock()
	defer tap.mu.Unlock()
	state := tap.sessions[output.SessionID]
	if state == nil {
		state = &shortLivedAfterEnd{}
		tap.sessions[output.SessionID] = state
	}
	switch {
	case state.ended && output.Line != nil:
		state.lines++
	case state.ended && output.Event != nil:
		state.events = append(state.events, shortLivedEvent{output.Event.Type, output.Event.SourceID})
	case output.Event != nil && output.Event.Type == sdklogs.StreamEventStreamEnded:
		state.ended = true
	}
}

func (tap *shortLivedTap) afterEnd(session string) shortLivedAfterEnd {
	tap.mu.Lock()
	defer tap.mu.Unlock()
	if state := tap.sessions[session]; state != nil {
		return shortLivedAfterEnd{ended: state.ended, lines: state.lines, events: slices.Clone(state.events)}
	}
	return shortLivedAfterEnd{}
}

// shortLivedConnections is the controller's connection source: a bare connection, as in the package's other tests.
type shortLivedConnections struct{ hostresource.ConnectionReader }

func (shortLivedConnections) GetConnection(_ context.Context, _, connectionID string) (sdktypes.Connection, error) {
	return sdktypes.Connection{ID: connectionID}, nil
}

// shortLivedHost is the host's side: the controller, the Wails service over it, the window it emits to and the tap
// on what the plugin sends it.
type shortLivedHost struct {
	service *ServiceWrapper
	ctrl    *controller
	window  *shortLivedWindow
	tap     *shortLivedTap
	child   *shortLivedChild
}

// startShortLivedHost starts a plugin process and the controller on it, with its multiplexer running as
// ServiceStartup runs it and the window for its emitter.
func startShortLivedHost(t *testing.T) *shortLivedHost {
	t.Helper()
	child := startShortLivedChild(t)
	host := &shortLivedHost{
		child:  child,
		window: &shortLivedWindow{lines: make(map[string]int), events: make(map[string][]shortLivedEvent)},
		tap:    &shortLivedTap{PluginClient: child.logs, sessions: make(map[string]*shortLivedAfterEnd)},
	}
	ctx, cancel := context.WithCancel(t.Context())
	ctrl, isController := NewController(logging.NewNop(), nil, shortLivedConnections{}).(*controller)
	require.True(t, isController)
	host.ctrl = ctrl
	host.ctrl.emitter, host.ctrl.ctx = host.window, ctx
	host.service = &ServiceWrapper{Ctrl: host.ctrl}
	muxStopped := make(chan struct{})
	go func() {
		defer close(muxStopped)
		host.ctrl.runMux()
	}()
	t.Cleanup(func() {
		cancel()
		<-muxStopped
		_ = host.ctrl.OnPluginStop(shortLivedPluginID, config.PluginMeta{ID: shortLivedPluginID})
	})
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"log": host.tap}})
	require.NoError(t, host.ctrl.OnPluginStart(shortLivedPluginID, config.PluginMeta{ID: shortLivedPluginID}, backend))
	return host
}

// create opens the session the legacy viewer opens for the log of a Pod: not followed, with the viewer's options.
func (h *shortLivedHost) create(ctx context.Context, resourceID string) (*sdklogs.LogSession, error) {
	return h.ctrl.CreateSession(ctx, shortLivedPluginID, shortLivedConnection, sdklogs.CreateSessionOptions{
		ResourceKey: shortLivedKey, ResourceID: resourceID,
		Options: sdklogs.LogSessionOptions{Follow: false, IncludeTimestamps: true, TailLines: 1000, IncludeSourceEvents: true, Params: map[string]string{}},
	})
}

// shortLivedViewerSync is the update the viewer sends for a selection of sources (useLogSources.ts, syncToBackend).
func shortLivedViewerSync(enabledSources string) sdklogs.LogSessionOptions {
	return sdklogs.LogSessionOptions{Params: map[string]string{"enabled_sources": enabledSources}}
}

// ============================== the viewer's sequence ==============================

// The viewer's sequence against a Pod that has exited: the session ends, the viewer waits its 300 ms and syncs its
// sources, all of them and then one. The sync of an ended session that would start a source is refused, nothing
// streams after the end, and the plugin and the session are as they were; a change that starts no source is applied.
func TestShortLivedStreamUpdateOfAnEndedSessionIsRefused(t *testing.T) {
	var decoded sdklogs.LogSessionOptions
	require.NoError(t, json.Unmarshal([]byte(`{"params":{"enabled_sources":"a"}}`), &decoded), "the viewer's JSON")
	require.Equal(t, shortLivedViewerSync("a"), decoded)
	host := startShortLivedHost(t)
	ctx, cancel := context.WithTimeout(t.Context(), 2*shortLivedWait)
	defer cancel()

	session, err := host.create(ctx, "50,90,exited")
	require.NoError(t, err)
	require.Truef(t, host.child.await(func() bool {
		lines, _, ended := host.window.received(session.ID)
		return ended && lines >= 2*shortLivedLines
	}), "the window did not get STREAM_ENDED and the %d lines of the session; %s", 2*shortLivedLines, host.child.crashed())
	time.Sleep(300 * time.Millisecond) // the viewer's debounce

	all, allErr := host.service.UpdateSessionOptions(session.ID, shortLivedViewerSync(""))
	one, oneErr := host.service.UpdateSessionOptions(session.ID, shortLivedViewerSync("a"))
	requireShortLivedRefusal(t, "the viewer's first sync (all sources)", all, allErr)
	requireShortLivedRefusal(t, "the sync of source a", one, oneErr)
	time.Sleep(400 * time.Millisecond) // long enough for a source that an update restarted to be read to its end

	after := host.tap.afterEnd(session.ID)
	lines, windowAfter, _ := host.window.received(session.ID)
	assert.Zero(t, after.lines, "lines the plugin sent after STREAM_ENDED")
	assert.Empty(t, after.events, "events the plugin sent after STREAM_ENDED")
	assert.Empty(t, windowAfter, "events the window got after STREAM_ENDED")
	assert.Equal(t, 2*shortLivedLines, lines, "lines the window got in all")
	require.Empty(t, host.child.crashed(), "the plugin process has failed")
	_, err = host.child.lifecycle.HealthCheck(ctx)
	require.NoError(t, err, "the plugin process does not answer")
	kept, err := host.service.GetSession(session.ID)
	require.NoError(t, err)
	assert.Equal(t, sdklogs.LogSessionStatusClosed, kept.Status)
	assert.NotContains(t, kept.Options.Params, "enabled_sources", "a refused update changes nothing")
	if allErr != nil {
		// The controller returns the raw classified error, which the Wails call hands to the viewer, which swallows it.
		// The host words it for the user as apperror.ForResource does: the plugin's own sentence does not cross.
		envelope := apperror.ForResource(allErr, "")
		t.Logf("the Wails call returns %s; apperror.ForResource: code=%q type=%q status=%d title=%q detail=%q recovery=%q",
			allErr, envelope.Code, envelope.Type, envelope.Status, envelope.Title, envelope.Detail, envelope.Recovery)
		assert.Equal(t, apperror.AppError{Err: allErr, Type: apperror.TypeResourceConflict, Status: 409, Code: shortLivedConflict, Title: "Conflict",
			Detail: "The operation conflicts with current state.", Recovery: "refreshContract"}, *envelope)
	}

	// An update that starts no source is applied to an ended session, as it always was.
	for name, params := range map[string]map[string]string{
		"a selection that names no source of the session": {"enabled_sources": "no-such-source"},
		"a change with no selection of sources":           {"filter_labels": "container"},
	} {
		applied, applyErr := host.service.UpdateSessionOptions(session.ID, sdklogs.LogSessionOptions{Params: params})
		require.NoErrorf(t, applyErr, "%s: an update that starts no source of an ended session was refused", name)
		assert.Equal(t, params, applied.Options.Params, name)
		stored, getErr := host.service.GetSession(session.ID)
		require.NoError(t, getErr)
		assert.Equal(t, params, stored.Options.Params, name)
	}

	require.NoError(t, host.service.CloseSession(session.ID))
	_, err = host.service.GetSession(session.ID)
	var gone *apperror.AppError
	require.ErrorAs(t, err, &gone)
	assert.Equal(t, apperror.TypeSessionNotFound, gone.Type)
	sessions, err := host.service.ListSessions()
	require.NoError(t, err)
	assert.Empty(t, sessions)
	assert.Empty(t, host.child.crashed())
}

// requireShortLivedRefusal checks, without stopping the test, that an update of an ended session was refused as the
// SDK says: a CONFLICT (gRPC Aborted) that returns no session.
func requireShortLivedRefusal(t *testing.T, name string, session *sdklogs.LogSession, err error) {
	t.Helper()
	if err == nil {
		t.Errorf("%s: the update of an ended session was applied (a session in status %v came back), not refused with CONFLICT", name, session.Status)
		return
	}
	var classified *resourcev2.ResourceOperationError
	switch {
	case resourcev2.ErrorCode(err) != shortLivedConflict:
		t.Errorf("%s: the update of an ended session failed with class %q, want CONFLICT: %v", name, resourcev2.ErrorCode(err), err)
	case !errors.As(err, &classified) || status.Code(classified.Err) != codes.Aborted:
		t.Errorf("%s: the refusal is not a ResourceOperationError carrying gRPC Aborted: %T %v", name, err, err)
	case session != nil:
		t.Errorf("%s: a refused update returned a session: %+v", name, session)
	}
}

// ============================== the hammer ==============================

const (
	shortLivedSessions = 64
	shortLivedWorkers  = 8
	shortLivedSenders  = 6
	shortLivedTrain    = 40 * time.Millisecond // how long a sender sends
)

// shortLivedTally is what the hammer's sessions came to: how each update ended, and what broke the rules.
type shortLivedTally struct {
	mu      sync.Mutex
	classes map[string]int
	faults  []string
}

func (s *shortLivedTally) fault(text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.faults = append(s.faults, text)
}

// viewerSync sends the viewer's sync for a selection to the session and records what it came to. An update that is sent
// after the host has received STREAM_ENDED must be refused.
func (h *shortLivedHost) viewerSync(tally *shortLivedTally, n int, session, selection string) string {
	ended := h.tap.afterEnd(session).ended
	_, err := h.service.UpdateSessionOptions(session, shortLivedViewerSync(selection))
	class := shortLivedApplied
	if err != nil {
		class = "other: " + err.Error()[:min(len(err.Error()), 120)]
		if resourcev2.ErrorCode(err) == shortLivedConflict {
			class = shortLivedConflict
		}
	}
	tally.mu.Lock()
	tally.classes[class]++
	tally.mu.Unlock()
	switch {
	case class != shortLivedApplied && class != shortLivedConflict:
		tally.fault("session " + strconv.Itoa(n) + ": a sync of " + strconv.Quote(selection) + " came to " + class)
	case ended && class != shortLivedConflict:
		tally.fault("session " + strconv.Itoa(n) + ": a sync of " + strconv.Quote(selection) + " sent after STREAM_ENDED was not refused")
	}
	return class
}

// drive runs one session of the hammer. Its Pod's logs end 3 to 15 ms after it opens, and its senders start either
// at once, so that they are updating when the logs end, or 0 to 380 ms later, so that some update before the end and
// some after. Each sender sends the viewer's syncs one after the other, as fast as the plugin answers, until it has
// been refused three times or its train is over. When the host has received STREAM_ENDED the session is synced twice
// more, and what the plugin sent after the end is read.
func (h *shortLivedHost) drive(ctx context.Context, tally *shortLivedTally, n int) {
	ms := []int{3, 6, 10, 15}[n%4]
	offset := time.Duration(n/2%9) * time.Millisecond
	if n%2 == 1 {
		offset = time.Duration(n/2%20) * 20 * time.Millisecond
	}
	opened := time.Now()
	session, err := h.create(ctx, strconv.Itoa(ms)+","+strconv.Itoa(ms)+","+strconv.Itoa(n))
	if err != nil {
		tally.fault("session " + strconv.Itoa(n) + " was not created: " + err.Error())
		return
	}
	defer func() { _ = h.service.CloseSession(session.ID) }()
	time.Sleep(time.Until(opened.Add(offset)))
	var senders sync.WaitGroup
	for sender := range shortLivedSenders {
		senders.Add(1)
		go func() {
			defer senders.Done()
			syncs, refusals := []string{"", "a,b", "a", "b"}, 0
			for i := 0; refusals < 3 && time.Since(opened) < offset+shortLivedTrain && ctx.Err() == nil && !h.child.exited(); i++ {
				if h.viewerSync(tally, n, session.ID, syncs[(i+sender)%len(syncs)]) == shortLivedConflict {
					refusals++
				}
			}
		}()
	}
	senders.Wait()
	if !h.child.await(func() bool { return h.tap.afterEnd(session.ID).ended }) {
		tally.fault("session " + strconv.Itoa(n) + ": the plugin never sent STREAM_ENDED; " + h.child.crashed())
		return
	}
	h.viewerSync(tally, n, session.ID, "")
	h.viewerSync(tally, n, session.ID, "a")
	time.Sleep(60 * time.Millisecond)
	// A source announced as removed can arrive late: the update that disabled it announces it after releasing its
	// lock (the SDK's known limit). Nothing else may follow STREAM_ENDED: no line, no source started, no second end.
	after := h.tap.afterEnd(session.ID)
	after.events = slices.DeleteFunc(after.events, func(event shortLivedEvent) bool { return event.kind == sdklogs.StreamEventSourceRemoved })
	if after.lines > 0 || len(after.events) > 0 {
		tally.fault("session " + strconv.Itoa(n) + ": after STREAM_ENDED the plugin sent " + strconv.Itoa(after.lines) + " lines and " + strconv.Itoa(len(after.events)) + " events")
	}
}

// Many Pods whose logs end within 15 ms, each synced the way the viewer syncs it by several senders that, as the SDK's
// own hammer does, do not wait between updates, so that updates land before the end of a session, as it ends and after
// it. Eight sessions run together on one plugin process, as the host runs them. The plugin must not die or write a
// fault, every update must come to nothing worse than a CONFLICT, an update sent after the host received STREAM_ENDED
// must be refused, and no line or started source may follow STREAM_ENDED.
func TestShortLivedStreamHammerUpdatesAcrossTheEnd(t *testing.T) {
	host := startShortLivedHost(t)
	ctx, cancel := context.WithTimeout(t.Context(), 4*shortLivedWait)
	defer cancel()
	tally := &shortLivedTally{classes: make(map[string]int)}
	started := time.Now()
	var workers sync.WaitGroup
	var next atomic.Int32
	for range shortLivedWorkers {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for n := int(next.Add(1)) - 1; n < shortLivedSessions; n = int(next.Add(1)) - 1 {
				host.drive(ctx, tally, n)
			}
		}()
	}
	workers.Wait()

	t.Logf("%d sessions in %v; what the updates came to: %v", shortLivedSessions, time.Since(started).Round(time.Millisecond), tally.classes)
	assert.Empty(t, host.child.crashed(), "the plugin process failed")
	assert.Empty(t, tally.faults[:min(len(tally.faults), 5)], "%d rules broken", len(tally.faults))
	assert.Positive(t, tally.classes[shortLivedApplied], "no update landed before the end of its session")
	_, err := host.child.lifecycle.HealthCheck(ctx)
	require.NoError(t, err, "the plugin process does not answer")
}
