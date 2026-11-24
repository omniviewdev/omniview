package exec

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	"github.com/omniviewdev/omniview/internal/telemetry"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

var tracer = otel.Tracer("omniview.exec")

type Controller interface {
	internaltypes.Controller
	ServiceStartup(ctx context.Context, options application.ServiceOptions) error
	ServiceShutdown() error
	SetReferenceAdmitter(resource.ReferenceAdmitter)
	GetPluginHandlers(plugin string) map[string]exec.Handler
	GetHandlers() map[string]map[string]exec.Handler
	GetHandler(plugin, resource string) *exec.Handler
	CreateSession(ctx context.Context, plugin, connectionID string, opts exec.SessionOptions) (*exec.Session, error)
	OpenNativeSession(ctx context.Context, plugin, connectionID string, opts exec.SessionOptions) error
	GetNativeTerminalSupport() bool
	// CreateTerminal starts a shell on this machine for owner, a comparable value that names the window
	// that opened it: the terminal ends with that window, or, with a page key, is detached when the window
	// goes away (ReleaseOwnedTerminals).
	CreateTerminal(ctx context.Context, owner terminal.Owner, opts terminal.Options) (*terminal.Session, error)
	// WriteTerminal and ResizeTerminal apply input to a local terminal; seq is the caller's sequence
	// number, or zero.
	WriteTerminal(sessionID string, seq uint64, data []byte) error
	ResizeTerminal(sessionID string, seq uint64, rows, cols int) error
	// AckTerminal tells a local terminal that n more bytes of its output were taken in by the caller. A
	// session that is ending, or is one of the last 256 that ended, answers success: there is nothing left to
	// credit.
	AckTerminal(sessionID string, n int) error
	// IsBusy says whether something other than the shell holds a terminal's foreground.
	IsBusy(sessionID string) (terminal.Foreground, error)
	// GetCwd says which directory a terminal's shell is in now.
	GetCwd(sessionID string) (terminal.Directory, error)
	// ReleaseOwnedTerminals is what a window going away does to its local terminals: those with a page key are
	// detached and kept for their lease, any other is ended.
	ReleaseOwnedTerminals(owner terminal.Owner, by terminal.ClosedBy) terminal.Released
	// CloseTerminalUnlessTakenOver ends a local terminal that a call could not hand to owner's window, unless
	// another window took it over meanwhile.
	CloseTerminalUnlessTakenOver(sessionID string, owner terminal.Owner)
	// AttachTerminal takes a local terminal over for owner and hands it the output it lacks, in one step that is
	// ordered with the terminal's events (terminal.Manager.Attach).
	AttachTerminal(ctx context.Context, owner terminal.Owner, sessionID string, request terminal.AttachRequest) (*terminal.Attached, error)
	// DetachTerminal leaves a local terminal waiting for a page for a lease.
	DetachTerminal(ctx context.Context, owner terminal.Owner, sessionID string, request terminal.DetachRequest) (*terminal.Detached, error)
	// ListTerminals says which local terminals the owner, or whoever holds the key, may attach.
	ListTerminals(owner terminal.Owner, pageKey string) []terminal.Listed
	ListSessions() ([]*exec.Session, error)
	GetSession(sessionID string) (*exec.Session, error)
	AttachSession(sessionID string) (*exec.Session, []byte, error)
	DetachSession(sessionID string) (*exec.Session, error)
	WriteSession(sessionID string, data []byte) error
	CloseSession(sessionID string) error
	ResizeSession(sessionID string, rows, cols uint16) error
}

const (
	// endedSessionTTL is how long the host keeps the record of a session that ended by itself with nobody attached: longer
	// than the plugin keeps the session's output for the first attach (plugin-sdk v0.22.1: a minute), so that the host never
	// forgets a session whose output is still there.
	endedSessionTTL = 90 * time.Second
	// endedSessionLimit is how many such records it keeps, as many as the plugin keeps outputs: the oldest goes first.
	endedSessionLimit = 32
)

// make it easy for us to lookup sessions by ID, without having to know
// the plugin or connection ID.
type sessionIndex struct {
	pluginID     string
	connectionID string
	local        bool

	// attached says a window has attached to the session and has not detached since: the plugin delivers its output to
	// the window while it is. A session that ends while attached is over for everyone.
	attached bool
	// closing says the host asked the plugin to close the session: the end is the host's, and the plugin keeps no
	// output of it for an attach.
	closing bool
	// ended says the session has sent its CLOSE with nobody attached, so the plugin keeps its output for the first
	// attach: the record stays until then (see ended_session.go). endedAt dates it and endedSeq orders it among the
	// others.
	ended    bool
	endedAt  time.Time
	endedSeq uint64
}

func NewController(
	logger logging.Logger,
	sp pkgsettings.Provider,
	resourceClient resource.ConnectionReader,
) Controller {
	return &controller{
		ctx:              nil,
		logger:           logger.Named("ExecController"),
		settingsProvider: sp,
		mu:               sync.RWMutex{},
		clients:          nil,
		sessionIndex:     make(map[string]sessionIndex),
		inChans:          make(map[string]chan exec.StreamInput),
		inputMux:         make(chan exec.StreamInput),
		outputMux:        make(chan execProviderOutput),
		resizeMux:        make(chan exec.StreamResize),
		resourceClient:   resourceClient,
		handlerMap:       make(map[string]map[string]exec.Handler),
		terminalManager:  nil,
	}
}

var _ Controller = (*controller)(nil)

type controller struct {
	events interface {
		Emit(string, ...any) bool
	}
	ctx              context.Context
	logger           logging.Logger
	settingsProvider pkgsettings.Provider

	mu           sync.RWMutex
	clients      map[string]Provider
	sessionIndex map[string]sessionIndex
	inChans      map[string]chan exec.StreamInput
	handlerMap   map[string]map[string]exec.Handler
	streams      map[string]execProviderStream

	// Publication and retirement share this outer lock. Never acquire it with mu held.
	outputMu sync.Mutex

	// multiplexer channels
	inputMux  chan exec.StreamInput
	outputMux chan execProviderOutput
	resizeMux chan exec.StreamResize

	resourceClient    resource.ConnectionReader
	referenceAdmitter resource.ReferenceAdmitter
	terminalManager   *terminal.Manager
	nativeLauncher    nativeTerminalLauncher

	// now is the time the controller reads (nil: the clock of the machine); a test replaces it.
	now func() time.Time
	// endedCount numbers the sessions that ended with nobody attached, in the order they did; c.mu guards it.
	endedCount uint64
}

type execProviderStream struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
}

type execProviderOutput struct {
	exec.StreamOutput
	pluginID string
	done     <-chan struct{}
}

// SetReferenceAdmitter is configured by native composition before startup.
func (c *controller) SetReferenceAdmitter(admit resource.ReferenceAdmitter) {
	c.referenceAdmitter = admit
}

// clock is the time of the controller: what the ended sessions' records are dated and expired by.
func (c *controller) clock() time.Time {
	if c.now != nil {
		return c.now()
	}

	return time.Now()
}

func (c *controller) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	if app := application.Get(); app != nil {
		c.events = app.Event
	}
	c.ctx = ctx

	// Initialize the terminal manager synchronously so c.terminalManager is
	// safe to read before any goroutine starts.
	c.startTerminals(ctx)

	go c.runMux() // plugin mux
	return nil
}

// ServiceShutdown runs after Wails has cancelled the application context, which already begins to end the
// local terminals; it ends them the way a close does (SIGHUP, then SIGKILL after the grace) and returns when
// they are gone, so that the jobs of a shell that passes the hangup on end with their terminal instead of
// outliving the host.
func (c *controller) ServiceShutdown() error {
	if c.terminalManager != nil {
		c.terminalManager.Shutdown()
	}
	return nil
}

// safeSend sends to ch, recovering from a closed-channel panic that can occur
// if OnPluginStop closes the channel between our map lookup and the send.
func (c *controller) safeSend(ch chan exec.StreamInput, input exec.StreamInput) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("send on closed exec input channel for session %s", input.SessionID)
			c.logger.Warnw(context.Background(), "send on closed exec input channel", "sessionID", input.SessionID)
		}
	}()
	ch <- input
	return nil
}

// dispatchOutput emits a session output or signal to the UI. pluginID is the plugin the frame came from.
func (c *controller) dispatchOutput(output exec.StreamOutput, pluginID string) {
	if c.events == nil {
		c.logger.Errorw(context.Background(), "event emitter is nil, cannot dispatch output")
		return
	}

	var eventkey string

	switch output.Signal {
	case exec.StreamSignalNone:
		eventkey = "core/exec/stream/" + output.Target.String() + "/" + output.SessionID
	case exec.StreamSignalError:
		eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
		if output.Error != nil {
			c.events.Emit(eventkey, output.Error)
		} else {
			c.events.Emit(eventkey, map[string]interface{}{
				"title":      "Session error",
				"message":    string(output.Data),
				"suggestion": "The session encountered an error.",
				"retryable":  false,
			})
		}
		return
	case exec.StreamSignalClose:
		c.logger.Debugw(context.Background(), "closing session")
		eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
		// The session is over: its record goes, unless it ended by itself with nobody attached, when the plugin
		// keeps its output for the first attach and so does the host.
		if !c.sessionClosed(output.SessionID, pluginID) {
			return // the session is another plugin's: this plugin's CLOSE is not its end, and no window is told it was
		}
	case exec.StreamSignalSigint, exec.StreamSignalSigquit, exec.StreamSignalSigterm,
		exec.StreamSignalSigkill, exec.StreamSignalSighup, exec.StreamSignalSigusr1,
		exec.StreamSignalSigusr2, exec.StreamSignalSigwinch:
		fallthrough
	default:
		c.logger.Debugw(context.Background(), "received signal", "signal", output.Signal.String())
		eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
	}

	c.events.Emit(eventkey, output.Data)
}

func (c *controller) runMux() {
	for {
		select {
		case <-c.ctx.Done():
			return
		case input := <-c.inputMux:
			// Capture the channel under lock, then send outside it to avoid
			// holding RLock during a potentially blocking send.
			var ch chan exec.StreamInput
			c.mu.RLock()
			if idx, found := c.sessionIndex[input.SessionID]; found && !idx.ended {
				ch = c.inChans[idx.pluginID]
			}
			c.mu.RUnlock()
			if ch != nil {
				// safeSend logs the failure itself; nothing else to do here.
				_ = c.safeSend(ch, input)
			}
		case output := <-c.outputMux:
			c.dispatchProviderOutput(output)
		}
	}
}

func (c *controller) dispatchProviderOutput(output execProviderOutput) {
	c.outputMu.Lock()
	defer c.outputMu.Unlock()

	c.mu.RLock()
	stream, active := c.streams[output.pluginID]
	record, recorded := c.sessionIndex[output.SessionID]
	c.mu.RUnlock()
	if !active || stream.done != output.done || stream.ctx.Err() != nil {
		// Output from a replaced or stopped provider stream is discarded.
		c.logger.Debugw(context.Background(), "dropped output from stale exec provider stream",
			"pluginID", output.pluginID, "sessionID", output.SessionID, "active", active)
		telemetry.RecordPluginStreamEvent(context.Background(), output.pluginID, "exec", "dropped")
		return
	}
	if heldByAnother(record, recorded, output.pluginID) {
		// The host routes by session id, and this id is recorded for another session: a terminal of this host (it
		// has no plugin) or a session of another plugin. A plugin speaks for the sessions it made, so the frame is
		// not that session's.
		c.logger.Warnw(context.Background(), "dropped output of a session id the plugin does not hold",
			"pluginID", output.pluginID, "sessionID", output.SessionID)
		telemetry.RecordPluginStreamEvent(context.Background(), output.pluginID, "exec", "dropped")
		return
	}
	if output.Signal == exec.StreamSignalError {
		telemetry.RecordPluginStreamEvent(context.Background(), output.pluginID, "exec", "closed_error")
		c.logger.Warnw(context.Background(), "exec session signaled error",
			"pluginID", output.pluginID, "sessionID", output.SessionID)
	}
	c.dispatchOutput(output.StreamOutput, output.pluginID)
}

func (c *controller) OnPluginInit(pluginID string, _ config.PluginMeta) {
	ctx, end := startOp(context.Background(), "exec.OnPluginInit", attribute.String("plugin_id", pluginID))
	var err error
	defer end(&err)
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginInit")

	c.mu.Lock()
	if c.clients == nil {
		c.clients = make(map[string]Provider)
	}
	c.mu.Unlock()
}

// dispenseProvider extracts the exec provider from the backend,
// wrapping it in the version-appropriate adapter.
func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (Provider, error) {
	raw, err := backend.Dispense("exec")
	if err != nil {
		return nil, err
	}

	version := backend.NegotiatedVersion()
	switch version {
	case 1:
		v1, ok := raw.(exec.Provider)
		if !ok {
			return nil, apperror.New(
				apperror.TypePluginLoadFailed, http.StatusInternalServerError,
				"Plugin type mismatch",
				fmt.Sprintf("Expected exec.Provider for v1, got %T", raw),
			)
		}
		return NewAdapterV1(v1), nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for exec, engine supports v1", pluginID, version),
		)
	}
}

func (c *controller) OnPluginStart(pluginID string, _ config.PluginMeta, backend internaltypes.PluginBackend) error {
	ctx, span := tracer.Start(context.Background(), "exec.OnPluginStart")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		telemetryutil.RecordError(span, err)
		logger.Errorw(ctx, "error dispensing provider", "errorClass", telemetryutil.ErrorClass(err))
		return err
	}

	// Get the handlers before acquiring the lock (this makes an RPC call).
	handlers := provider.GetSupportedResources(c.getUnconnectedCtx(ctx, ""))
	if stopErr := c.OnPluginStop(pluginID, config.PluginMeta{}); stopErr != nil {
		logger.Warnw(ctx, "failed to stop previous exec provider before restart",
			"errorClass", telemetryutil.ErrorClass(stopErr))
	}
	base := c.ctx
	if base == nil {
		base = context.Background()
	}
	streamCtx, cancel := context.WithCancel(base)
	done := make(chan struct{})

	inchan := make(chan exec.StreamInput)

	// Start the stream before registering state so a Stream failure doesn't
	// leave stale entries in clients/inChans/handlerMap.
	stream, err := provider.Stream(streamCtx, inchan)
	if err != nil {
		cancel()
		provider.Close()
		telemetryutil.RecordError(span, err)
		close(inchan)
		logger.Errorw(ctx, "error starting stream", "errorClass", telemetryutil.ErrorClass(err))
		return err
	}

	c.mu.Lock()
	if c.streams == nil {
		c.streams = make(map[string]execProviderStream)
	}
	c.streams[pluginID] = execProviderStream{ctx: streamCtx, cancel: cancel, done: done}
	c.clients[pluginID] = provider
	// Installation ownership is separate from the handler's canonical selector.
	c.handlerMap[pluginID] = make(map[string]exec.Handler, len(handlers))
	for i := range handlers {
		c.handlerMap[pluginID][handlers[i].Resource] = handlers[i]
	}
	c.inChans[pluginID] = inchan
	c.mu.Unlock()

	go func() {
		defer close(done)
		first := true
		for {
			select {
			case <-streamCtx.Done():
				logger.Debugw(streamCtx, "exec provider stream closed", "closeReason", "canceled")
				return
			case output, ok := <-stream:
				if !ok {
					if streamCtx.Err() == nil {
						logger.Warnw(streamCtx, "exec provider stream closed unexpectedly", "closeReason", "provider")
						telemetry.RecordPluginStreamEvent(streamCtx, pluginID, "exec", "closed_error")
					} else {
						logger.Debugw(streamCtx, "exec provider stream closed", "closeReason", "canceled")
					}
					return
				}
				if first {
					logger.Debugw(streamCtx, "exec provider stream first event")
					first = false
				}
				select {
				case c.outputMux <- (execProviderOutput{StreamOutput: output, pluginID: pluginID, done: done}):
				case <-streamCtx.Done():
					return
				}
			}
		}
	}()

	return nil
}

// cleanupPluginLocked removes all state and returns its provider and worker.
// Must NOT be called with outputMu or mu held — it acquires both internally.
func (c *controller) cleanupPluginLocked(pluginID string) (Provider, bool, execProviderStream) {
	c.outputMu.Lock()
	defer c.outputMu.Unlock()
	c.mu.Lock()
	defer c.mu.Unlock()

	stream := c.streams[pluginID]
	delete(c.streams, pluginID)
	if stream.cancel != nil {
		stream.cancel()
	}
	if ch, ok := c.inChans[pluginID]; ok {
		close(ch)
		delete(c.inChans, pluginID)
	}
	provider, ok := c.clients[pluginID]
	delete(c.clients, pluginID)
	for sid, idx := range c.sessionIndex {
		if idx.pluginID == pluginID {
			delete(c.sessionIndex, sid)
		}
	}
	delete(c.handlerMap, pluginID)
	return provider, ok, stream
}

func (c *controller) OnPluginStop(pluginID string, _ config.PluginMeta) error {
	ctx, span := tracer.Start(context.Background(), "exec.OnPluginStop")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStop")

	provider, ok, stream := c.cleanupPluginLocked(pluginID)
	if ok {
		provider.Close()
	}
	if stream.done != nil {
		<-stream.done
	}
	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	return c.OnPluginStop(pluginID, meta)
}

func (c *controller) OnPluginDestroy(pluginID string, _ config.PluginMeta) error {
	ctx, end := startOp(context.Background(), "exec.OnPluginDestroy", attribute.String("plugin_id", pluginID))
	var err error
	defer end(&err)
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginDestroy")

	// nil action
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	var err error
	_, end := startOp(context.Background(), "exec.ListPlugins")
	defer end(&err)
	c.logger.Debugw(context.Background(), "ListPlugins")
	c.mu.RLock()
	defer c.mu.RUnlock()
	plugins := make([]string, 0, len(c.clients))
	for k := range c.clients {
		plugins = append(plugins, k)
	}
	return plugins, nil
}

func (c *controller) HasPlugin(pluginID string) bool {
	var err error
	_, end := startOp(context.Background(), "exec.HasPlugin", attribute.String("plugin_id", pluginID))
	defer end(&err)
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.clients[pluginID]
	return ok
}

// ==================================== Session Management ============================= //

func (c *controller) getConnectedCtx(
	ctx context.Context,
	plugin string,
	connectionID string,
) *sdktypes.PluginContext {
	// get the connection from the right resource
	connection, err := c.resourceClient.GetConnection(ctx, plugin, connectionID)
	if err != nil {
		c.logger.Errorw(ctx, "error getting connection", "errorClass", telemetryutil.ErrorClass(err))
		return nil
	}

	return sdktypes.NewPluginContextWithConnection(
		ctx,
		"exec",
		nil,
		nil,
		&connection,
	)
}

func (c *controller) getUnconnectedCtx(
	ctx context.Context,
	_ string,
) *sdktypes.PluginContext {
	return sdktypes.NewPluginContext(
		ctx,
		"exec",
		nil,
		nil,
		nil,
	)
}

func (c *controller) GetPluginHandlers(plugin string) map[string]exec.Handler {
	var err error
	_, end := startOp(context.Background(), "exec.GetPluginHandlers", attribute.String("plugin_id", plugin))
	defer end(&err)
	c.mu.RLock()
	defer c.mu.RUnlock()
	src := c.handlerMap[plugin]
	if src == nil {
		return nil
	}
	cp := make(map[string]exec.Handler, len(src))
	for k, v := range src {
		cp[k] = v
	}
	return cp
}

func (c *controller) GetHandlers() map[string]map[string]exec.Handler {
	var err error
	_, end := startOp(context.Background(), "exec.GetHandlers")
	defer end(&err)
	c.mu.RLock()
	defer c.mu.RUnlock()
	cp := make(map[string]map[string]exec.Handler, len(c.handlerMap))
	for plugin, inner := range c.handlerMap {
		innerCp := make(map[string]exec.Handler, len(inner))
		for k, v := range inner {
			innerCp[k] = v
		}
		cp[plugin] = innerCp
	}
	return cp
}

func (c *controller) GetHandler(
	plugin string,
	resource string,
) *exec.Handler {
	var err error
	_, end := startOp(context.Background(), "exec.GetHandler",
		attribute.String("plugin_id", plugin), attribute.String("resource_type", resource))
	defer end(&err)
	c.mu.RLock()
	defer c.mu.RUnlock()
	p, ok := c.handlerMap[plugin]
	if !ok {
		return nil
	}
	h, ok := p[resource]
	if !ok {
		return nil
	}
	return &h
}

func (c *controller) CreateSession(
	ctx context.Context,
	plugin string,
	connectionID string,
	opts exec.SessionOptions,
) (_ *exec.Session, err error) {
	ctx, end := startOp(ctx, "exec.CreateSession")
	defer end(&err)
	trace.SpanFromContext(ctx).SetAttributes(
		attribute.String("plugin_id", plugin),
		attribute.String("connection_id", connectionID),
	)
	if plugin == "local" {
		// The host's own shell is not a plugin's session. CreateTerminal starts it, for the window that owns
		// it; this route started one that no window owned and nothing would ever end.
		return nil, resourcev2.NewError("INVALID_REQUEST", "A local terminal starts with CreateTerminal.")
	}
	ctx, err = c.admitSessionReference(ctx, plugin, connectionID, opts)
	if err != nil {
		return nil, err
	}

	var session *exec.Session
	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.PluginNotFound(plugin)
	}

	pctx := c.getConnectedCtx(ctx, plugin, connectionID)
	if pctx == nil {
		return nil, resourcev2.NewError("UNAVAILABLE", "The selected resource connection is unavailable. Reconnect and retry.")
	}
	// The host routes a call, an event and an end by the session id, so a session keeps its id: a second session
	// with the id of a terminal of this host or of a session of any plugin would take over its record, as the other
	// way CreateTerminal refuses. The page chose this id, so it is asked before a plugin is asked to start anything;
	// the id the plugin answers is the one that decides, where it is recorded.
	if opts.ID != "" && c.hasSession(opts.ID) {
		return nil, terminal.IDInUse(opts.ID)
	}
	// Providers retain this context for the session, beyond binding completion.
	pctx.Context = context.WithoutCancel(pctx.Context)
	session, err = client.CreateSession(pctx, opts)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	if held, taken := c.sessionIndex[session.ID]; taken {
		c.mu.Unlock()
		c.closeRefusedSession(ctx, pctx, client, plugin, held.pluginID, session.ID)
		return nil, terminal.IDInUse(session.ID)
	}
	c.sessionIndex[session.ID] = sessionIndex{
		pluginID:     plugin,
		connectionID: connectionID,
		local:        false,
		attached:     false,
		closing:      false,
		ended:        false,
		endedAt:      time.Time{},
		endedSeq:     0,
	}
	c.mu.Unlock()
	trace.SpanFromContext(ctx).SetAttributes(attribute.String("session_id", session.ID))
	c.logger.Infow(ctx, "exec session created", "sessionID", session.ID, "pluginID", plugin, "connectionID", connectionID)

	return session, nil
}

// hasSession says the host holds a record for the session id: a terminal of this host, a session of a plugin, or one
// that ended with nobody attached and waits for its first attach.
func (c *controller) hasSession(sessionID string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, found := c.sessionIndex[sessionID]
	return found
}

// heldByAnother says a frame from plugin names a session id the host recorded for another session: a terminal of this
// host (its record has no plugin) or a session of another plugin. A plugin speaks for the sessions it made. A frame
// whose id has no record is nobody's yet and is delivered: output and the end of a session can come before the host
// has recorded it.
func heldByAnother(record sessionIndex, recorded bool, pluginID string) bool {
	return recorded && record.pluginID != pluginID
}

// closeRefusedSession ends the session a plugin made with an id the host holds for another session. It is closed with
// the plugin that made it and never through CloseSession, which would find the record of the other session. heldBy is
// the plugin the record names (none, for a terminal of this host). A plugin that answers an id it already holds a
// session for has one session under that id, the recorded one (the SDK refuses a duplicate; a plugin that is not built
// on it may not), and closing by the id would end that one: it is left alone.
func (c *controller) closeRefusedSession(
	ctx context.Context,
	pctx *sdktypes.PluginContext,
	client Provider,
	plugin string,
	heldBy string,
	sessionID string,
) {
	if heldBy == plugin {
		c.logger.Errorw(ctx, "plugin answered the id of a session it already holds", "sessionID", sessionID, "pluginID", plugin)
		return
	}
	c.logger.Warnw(ctx, "closing a session whose id the host holds for another session", "sessionID", sessionID, "pluginID", plugin)
	if err := client.CloseSession(pctx, sessionID); err != nil {
		c.logger.Warnw(ctx, "could not close a session whose id is in use",
			"sessionID", sessionID, "pluginID", plugin, "errorClass", telemetryutil.ErrorClass(err))
	}
}

func (c *controller) ListSessions() (_ []*exec.Session, err error) {
	ctx, span := tracer.Start(context.Background(), "exec.ListSessions")
	defer finishOp(span, &err)

	c.logger.Debugw(ctx, "ListSessions")
	pctx := c.getUnconnectedCtx(ctx, "")

	c.mu.RLock()
	clients := make([]Provider, 0, len(c.clients))
	for _, client := range c.clients {
		clients = append(clients, client)
	}
	c.mu.RUnlock()

	sessions := make([]*exec.Session, 0)
	for _, client := range clients {
		clientSessions, listErr := client.ListSessions(pctx)
		if listErr != nil {
			return nil, listErr
		}
		sessions = append(sessions, clientSessions...)
	}

	// add the local terminal sessions
	sessions = append(sessions, c.terminalManager.ListSessions()...)

	return sessions, nil
}

// lookupSession reads sessionIndex and clients/inChans in a single RLock.
// Returns the index, client (may be nil for WriteSession callers), and whether
// the session was found at all. Callers must check local separately.
func (c *controller) lookupSession(sessionID string) (sessionIndex, Provider, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	idx, ok := c.sessionIndex[sessionID]
	if !ok || idx.ended {
		var zero sessionIndex
		return zero, nil, false
	}
	client := c.clients[idx.pluginID]
	return idx, client, true
}

func (c *controller) GetSession(
	sessionID string,
) (_ *exec.Session, err error) {
	ctx, span := tracer.Start(context.Background(), "exec.GetSession")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.logger.Debugw(ctx, "GetSession")
	index, client, ok := c.lookupSession(sessionID)
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}
	span.SetAttributes(attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID))
	if index.local {
		return c.terminalManager.GetSession(sessionID)
	}
	if client == nil {
		return nil, apperror.PluginNotFound(index.pluginID)
	}
	return client.GetSession(
		c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) AttachSession(sessionID string) (_ *exec.Session, _ []byte, err error) {
	ctx, span := tracer.Start(context.Background(), "exec.AttachSession")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.logger.Debugw(ctx, "AttachSession")
	index, client, ok := c.lookupSessionOrEnded(sessionID)
	if !ok {
		return nil, nil, apperror.SessionNotFound(sessionID)
	}
	span.SetAttributes(attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID))
	if index.local {
		return c.terminalManager.AttachSession(sessionID)
	}
	if client == nil {
		return nil, nil, apperror.PluginNotFound(index.pluginID)
	}
	session, output, err := client.AttachSession(
		c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID),
		sessionID,
	)
	c.attachAnswered(sessionID, err)
	if index.ended && sessionGone(err) {
		// What the host said when it forgot the session at its CLOSE. The plugin's own words (an SDK that kept nothing, an
		// output that expired there before it did here) are its business.
		return nil, nil, apperror.SessionNotFound(sessionID)
	}
	return session, output, err
}

func (c *controller) DetachSession(sessionID string) (_ *exec.Session, err error) {
	ctx, span := tracer.Start(context.Background(), "exec.DetachSession")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.logger.Debugw(ctx, "DetachSession")
	index, client, ok := c.lookupSessionOrEnded(sessionID)
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}
	span.SetAttributes(attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID))
	if index.local {
		return c.terminalManager.DetachSession(sessionID)
	}
	if index.ended {
		// A window that never attached has nothing to detach from, as after the CLOSE of any session; it is also done with
		// the output the plugin kept for it.
		c.forgetSession(sessionID)
		return nil, apperror.SessionNotFound(sessionID)
	}
	if client == nil {
		return nil, apperror.PluginNotFound(index.pluginID)
	}
	c.detachStarted(sessionID)
	session, err := client.DetachSession(
		c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID),
		sessionID,
	)
	if sessionGone(err) {
		c.forgetSession(sessionID)
	}
	return session, err
}

func (c *controller) WriteSession(
	sessionID string,
	data []byte,
) (err error) {
	ctx, span := tracer.Start(context.Background(), "exec.WriteSession")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	ok = ok && !index.ended
	var inchan chan exec.StreamInput
	if ok && !index.local {
		inchan = c.inChans[index.pluginID]
	}
	c.mu.RUnlock()
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}
	span.SetAttributes(attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID))
	if index.local {
		return c.terminalManager.Write(sessionID, 0, data)
	}
	if inchan == nil {
		return apperror.SessionNotFound(sessionID)
	}
	c.logger.Debugw(ctx, "Writing to session")
	return c.safeSend(inchan, exec.StreamInput{
		SessionID: sessionID,
		Data:      data,
	})
}

func (c *controller) CloseSession(
	sessionID string,
) (err error) {
	ctx, span := tracer.Start(context.Background(), "exec.CloseSession")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))

	index, client, ok := c.lookupSessionOrEnded(sessionID)
	if !ok {
		// The end that a terminal leaves when it ended by itself while no page was attached is not in the index (its
		// CLOSE took the id out) and the terminal manager keeps it: closing it dismisses it. An id that is neither is
		// not found.
		if c.terminalManager != nil {
			return c.terminalManager.CloseSession(sessionID)
		}
		return apperror.SessionNotFound(sessionID)
	}
	span.SetAttributes(attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID))
	if index.local {
		return c.terminalManager.CloseSession(sessionID)
	}
	if index.ended {
		// It ended by itself and no window attached: there is nothing to close. The output the plugin kept is for an attach
		// that nobody will make now, and goes with the plugin's own limits.
		c.forgetSession(sessionID)
		return nil
	}
	if client == nil {
		return apperror.PluginNotFound(index.pluginID)
	}
	c.closeStarted(sessionID)
	err = client.CloseSession(
		c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID),
		sessionID,
	)
	if err == nil || sessionGone(err) {
		// A session that ended by itself in the instant before the host heard of it is closed: plugin-sdk v0.22.1 answers
		// not-found to a close that comes then. That is what the caller asked for, and no failure.
		c.forgetSession(sessionID)
		return nil
	}
	return err
}

func (c *controller) ResizeSession(
	sessionID string,
	rows, cols uint16,
) (err error) {
	ctx, span := tracer.Start(context.Background(), "exec.ResizeSession")
	defer finishOp(span, &err)
	span.SetAttributes(attribute.String("session_id", sessionID))

	index, client, ok := c.lookupSession(sessionID)
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}
	span.SetAttributes(attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID))
	if index.local {
		return c.terminalManager.Resize(sessionID, 0, int(rows), int(cols))
	}
	if client == nil {
		return apperror.PluginNotFound(index.pluginID)
	}
	return client.ResizeSession(
		c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID),
		sessionID,
		int32(cols),
		int32(rows),
	)
}
