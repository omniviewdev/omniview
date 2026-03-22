package exec

import (
	"context"
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

var tracer = otel.Tracer("omniview.exec")

type Controller interface {
	internaltypes.Controller
	ServiceStartup(ctx context.Context, options application.ServiceOptions) error
	ServiceShutdown() error
	GetPluginHandlers(plugin string) map[string]exec.Handler
	GetHandlers() map[string]map[string]exec.Handler
	GetHandler(plugin, resource string) *exec.Handler
	CreateSession(plugin, connectionID string, opts exec.SessionOptions) (*exec.Session, error)
	CreateTerminal(opts exec.SessionOptions) (*exec.Session, error)
	ListSessions() ([]*exec.Session, error)
	GetSession(sessionID string) (*exec.Session, error)
	AttachSession(sessionID string) (*exec.Session, []byte, error)
	DetachSession(sessionID string) (*exec.Session, error)
	WriteSession(sessionID string, data []byte) error
	CloseSession(sessionID string) error
	ResizeSession(sessionID string, rows, cols uint16) error
}

// make it easy for us to lookup sessions by ID, without having to know
// the plugin or connection ID.
type sessionIndex struct {
	pluginID     string
	connectionID string
	local        bool
}

func NewController(
	logger logging.Logger,
	sp pkgsettings.Provider,
	resourceClient resource.Service,
) Controller {
	return &controller{
		logger:           logger.Named("ExecController"),
		settingsProvider: sp,
		sessionIndex:     make(map[string]sessionIndex),
		inChans:          make(map[string]chan exec.StreamInput),
		inputMux:         make(chan exec.StreamInput),
		outputMux:        make(chan exec.StreamOutput),
		resizeMux:        make(chan exec.StreamResize),
		resourceClient:   resourceClient,
		handlerMap:       make(map[string]map[string]exec.Handler),
	}
}

var _ Controller = &controller{}

type controller struct {
	// wails v3 application reference
	app              *application.App
	ctx              context.Context
	logger           logging.Logger
	settingsProvider pkgsettings.Provider

	mu           sync.RWMutex
	clients      map[string]ExecProvider
	sessionIndex map[string]sessionIndex
	inChans      map[string]chan exec.StreamInput
	handlerMap   map[string]map[string]exec.Handler

	// multiplexer channels
	inputMux  chan exec.StreamInput
	outputMux chan exec.StreamOutput
	resizeMux chan exec.StreamResize

	resourceClient  resource.Service
	terminalManager *terminal.Manager
}

func (c *controller) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	c.app = application.Get()
	c.ctx = ctx

	// Initialize the terminal manager synchronously so c.terminalManager is
	// safe to read before any goroutine starts.
	manager, inMux, outMux, resizeMux := terminal.NewManager(ctx, c.logger)
	c.terminalManager = manager

	go c.runMux()                                // plugin mux
	go c.runLocalMux(inMux, outMux, resizeMux)   // local terminal should be muxed separately to avoid latency
	return nil
}

func (c *controller) ServiceShutdown() error {
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

func (c *controller) runLocalMux(
	inMux chan exec.StreamInput,
	outMux chan exec.StreamOutput,
	resizeMux chan exec.StreamResize,
) {
	for {
		select {
		case <-c.ctx.Done():
			return
		case input := <-inMux:
			if err := c.terminalManager.WriteSession(input.SessionID, input.Data); err != nil {
				c.logger.Errorw(context.Background(), "error writing to session", "error", err)
			}
		case output := <-outMux:
			// dispatch to ui
			if c.app == nil {
				c.logger.Errorw(context.Background(), "app is nil, cannot dispatch output")
			}

			var eventkey string

			switch output.Signal {
			case exec.StreamSignalNone:
				eventkey = "core/exec/stream/" + output.Target.String() + "/" + output.SessionID
			case exec.StreamSignalError:
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
				if output.Error != nil {
					c.app.Event.Emit(eventkey, output.Error)
				} else {
					c.app.Event.Emit(eventkey, map[string]interface{}{
						"title":      "Session error",
						"message":    string(output.Data),
						"suggestion": "The session encountered an error.",
						"retryable":  false,
					})
				}
				continue
			case exec.StreamSignalClose:
				c.logger.Debugw(context.Background(), "closing session")
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
				// session doesn't exist anymore, remove it from the index
				c.mu.Lock()
				delete(c.sessionIndex, output.SessionID)
				c.mu.Unlock()
			default:
				c.logger.Debugw(context.Background(), "received signal", "signal", output.Signal.String())
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
			}

			c.app.Event.Emit(eventkey, output.Data)
		case resize := <-resizeMux:
			if err := c.terminalManager.ResizeSession(resize.SessionID, resize.Rows, resize.Cols); err != nil {
				c.logger.Errorw(context.Background(), "error resizing session", "error", err)
			}
		}
	}
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
			if idx, found := c.sessionIndex[input.SessionID]; found {
				ch = c.inChans[idx.pluginID]
			}
			c.mu.RUnlock()
			if ch != nil {
				c.safeSend(ch, input)
			}
		case output := <-c.outputMux:
			// dispatch to ui
			if c.app == nil {
				c.logger.Errorw(context.Background(), "app is nil, cannot dispatch output")
			}

			var eventkey string

			switch output.Signal {
			case exec.StreamSignalNone:
				eventkey = "core/exec/stream/" + output.Target.String() + "/" + output.SessionID
			case exec.StreamSignalError:
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
				if output.Error != nil {
					c.app.Event.Emit(eventkey, output.Error)
				} else {
					c.app.Event.Emit(eventkey, map[string]interface{}{
						"title":      "Session error",
						"message":    string(output.Data),
						"suggestion": "The session encountered an error.",
						"retryable":  false,
					})
				}
				continue
			case exec.StreamSignalClose:
				c.logger.Debugw(context.Background(), "closing session")
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
				// session doesn't exist anymore, remove it from the index
				c.mu.Lock()
				delete(c.sessionIndex, output.SessionID)
				c.mu.Unlock()
			default:
				c.logger.Debugw(context.Background(), "received signal", "signal", output.Signal.String())
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
			}

			c.app.Event.Emit(eventkey, output.Data)
		}
	}
}

func (c *controller) OnPluginInit(pluginID string, meta config.PluginMeta) {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginInit")

	c.mu.Lock()
	if c.clients == nil {
		c.clients = make(map[string]ExecProvider)
	}
	c.mu.Unlock()
}

// dispenseProvider extracts the exec provider from the backend,
// wrapping it in the version-appropriate adapter.
func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (ExecProvider, error) {
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
				apperror.TypePluginLoadFailed, 500,
				"Plugin type mismatch",
				fmt.Sprintf("Expected exec.Provider for v1, got %T", raw),
			)
		}
		return NewAdapterV1(v1), nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, 500,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for exec, engine supports v1", pluginID, version),
		)
	}
}

func (c *controller) OnPluginStart(pluginID string, meta config.PluginMeta, backend internaltypes.PluginBackend) error {
	ctx, span := tracer.Start(context.Background(), "exec.OnPluginStart")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		telemetryutil.RecordError(span, err)
		logger.Errorw(ctx, "error dispensing provider", "error", err)
		return err
	}

	// Get the handlers before acquiring the lock (this makes an RPC call).
	handlers := provider.GetSupportedResources(c.getUnconnectedCtx(ctx, ""))

	inchan := make(chan exec.StreamInput)

	// Start the stream before registering state so a Stream failure doesn't
	// leave stale entries in clients/inChans/handlerMap.
	stream, err := provider.Stream(c.ctx, inchan)
	if err != nil {
		telemetryutil.RecordError(span, err)
		close(inchan)
		logger.Errorw(ctx, "error starting stream", "error", err)
		return err
	}

	c.mu.Lock()
	c.clients[pluginID] = provider
	for _, handler := range handlers {
		if _, ok := c.handlerMap[handler.Plugin]; !ok {
			c.handlerMap[handler.Plugin] = make(map[string]exec.Handler)
		}
		c.handlerMap[handler.Plugin][handler.Resource] = handler
	}
	c.inChans[pluginID] = inchan
	c.mu.Unlock()

	go func() {
		for {
			select {
			case <-c.ctx.Done():
				return
			case output, ok := <-stream:
				if !ok {
					return // stream closed, plugin exited
				}
				c.outputMux <- output
			}
		}
	}()

	return nil
}

// cleanupPluginLocked removes all state for a plugin and returns the provider if it existed.
// Must NOT be called with c.mu held — it acquires the lock internally.
func (c *controller) cleanupPluginLocked(pluginID string) (ExecProvider, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

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
	for plugin, resources := range c.handlerMap {
		for resKey, handler := range resources {
			if handler.Plugin == pluginID {
				delete(resources, resKey)
			}
		}
		if len(resources) == 0 {
			delete(c.handlerMap, plugin)
		}
	}
	return provider, ok
}

func (c *controller) OnPluginStop(pluginID string, meta config.PluginMeta) error {
	ctx, span := tracer.Start(context.Background(), "exec.OnPluginStop")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStop")

	if provider, ok := c.cleanupPluginLocked(pluginID); ok {
		provider.Close()
	}
	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginShutdown")

	c.cleanupPluginLocked(pluginID)
	return nil
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginDestroy")

	// nil action
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
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
	connection, err := c.resourceClient.GetConnection(plugin, connectionID)
	if err != nil {
		c.logger.Errorw(ctx, "error getting connection", "error", err)
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

// CreateTerminal creates a local terminal session with TTY enabled.
// This is a convenience wrapper for CreateSession("local", "local", opts)
// with TTY forced on.
func (c *controller) CreateTerminal(opts exec.SessionOptions) (*exec.Session, error) {
	opts.TTY = true
	return c.CreateSession("local", "local", opts)
}

func (c *controller) CreateSession(
	plugin string,
	connectionID string,
	opts exec.SessionOptions,
) (session *exec.Session, err error) {
	ctx, span := tracer.Start(context.Background(), "exec.CreateSession")
	defer span.End()
	defer func() {
		if err != nil {
			telemetryutil.RecordError(span, err)
		}
	}()
	span.SetAttributes(
		attribute.String("plugin_id", plugin),
		attribute.String("connection_id", connectionID),
	)

	if plugin == "local" {
		// start local terminal
		session, err = c.terminalManager.StartSession(
			c.getUnconnectedCtx(ctx, plugin),
			opts,
		)
		if err != nil {
			return nil, err
		}
		c.mu.Lock()
		c.sessionIndex[session.ID] = sessionIndex{local: true}
		c.mu.Unlock()
		return session, nil
	}

	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.PluginNotFound(plugin)
	}

	session, err = client.CreateSession(
		c.getConnectedCtx(ctx, plugin, connectionID),
		opts,
	)
	if err != nil {
		return nil, err
	}

	c.mu.Lock()
	c.sessionIndex[session.ID] = sessionIndex{
		local:        false,
		pluginID:     plugin,
		connectionID: connectionID,
	}
	c.mu.Unlock()

	return session, nil
}

func (c *controller) ListSessions() (sessions []*exec.Session, err error) {
	ctx, span := tracer.Start(context.Background(), "exec.ListSessions")
	defer span.End()
	defer func() {
		if err != nil {
			telemetryutil.RecordError(span, err)
		}
	}()

	c.logger.Debugw(ctx, "ListSessions")
	pctx := c.getUnconnectedCtx(ctx, "")

	c.mu.RLock()
	clients := make([]ExecProvider, 0, len(c.clients))
	for _, client := range c.clients {
		clients = append(clients, client)
	}
	c.mu.RUnlock()

	sessions = make([]*exec.Session, 0)
	for _, client := range clients {
		clientSessions, err := client.ListSessions(pctx)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, clientSessions...)
	}

	// add the local terminal sessions
	sessions = append(sessions, c.terminalManager.ListSessions(pctx)...)

	return sessions, nil
}

// lookupSession reads sessionIndex and clients/inChans in a single RLock.
// Returns the index, client (may be nil for WriteSession callers), and whether
// the session was found at all. Callers must check local separately.
func (c *controller) lookupSession(sessionID string) (sessionIndex, ExecProvider, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	idx, ok := c.sessionIndex[sessionID]
	if !ok {
		return sessionIndex{}, nil, false
	}
	client := c.clients[idx.pluginID]
	return idx, client, true
}

func (c *controller) GetSession(
	sessionID string,
) (session *exec.Session, err error) {
	ctx, span := tracer.Start(context.Background(), "exec.GetSession")
	defer span.End()
	defer func() {
		if err != nil {
			telemetryutil.RecordError(span, err)
		}
	}()
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.logger.Debugw(ctx, "GetSession")
	index, client, ok := c.lookupSession(sessionID)
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.GetSession(sessionID)
	}
	if client == nil {
		return nil, apperror.PluginNotFound(index.pluginID)
	}
	return client.GetSession(
		c.getConnectedCtx(ctx, index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) AttachSession(sessionID string) (session *exec.Session, data []byte, err error) {
	ctx, span := tracer.Start(context.Background(), "exec.AttachSession")
	defer span.End()
	defer func() {
		if err != nil {
			telemetryutil.RecordError(span, err)
		}
	}()
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.logger.Debugw(ctx, "AttachSession")
	index, client, ok := c.lookupSession(sessionID)
	if !ok {
		return nil, nil, apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.AttachSession(sessionID)
	}
	if client == nil {
		return nil, nil, apperror.PluginNotFound(index.pluginID)
	}
	return client.AttachSession(
		c.getConnectedCtx(ctx, index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) DetachSession(sessionID string) (session *exec.Session, err error) {
	ctx, span := tracer.Start(context.Background(), "exec.DetachSession")
	defer span.End()
	defer func() {
		if err != nil {
			telemetryutil.RecordError(span, err)
		}
	}()
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.logger.Debugw(ctx, "DetachSession")
	index, client, ok := c.lookupSession(sessionID)
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.DetachSession(sessionID)
	}
	if client == nil {
		return nil, apperror.PluginNotFound(index.pluginID)
	}
	return client.DetachSession(
		c.getConnectedCtx(ctx, index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) WriteSession(
	sessionID string,
	data []byte,
) (err error) {
	ctx, span := tracer.Start(context.Background(), "exec.WriteSession")
	defer span.End()
	defer func() {
		if err != nil {
			telemetryutil.RecordError(span, err)
		}
	}()
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	var inchan chan exec.StreamInput
	if ok && !index.local {
		inchan = c.inChans[index.pluginID]
	}
	c.mu.RUnlock()
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.WriteSession(sessionID, data)
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
	defer span.End()
	defer func() {
		if err != nil {
			telemetryutil.RecordError(span, err)
		}
	}()
	span.SetAttributes(attribute.String("session_id", sessionID))

	index, client, ok := c.lookupSession(sessionID)
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.CloseSession(sessionID)
	}
	if client == nil {
		return apperror.PluginNotFound(index.pluginID)
	}
	return client.CloseSession(
		c.getConnectedCtx(ctx, index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) ResizeSession(
	sessionID string,
	rows, cols uint16,
) (err error) {
	ctx, span := tracer.Start(context.Background(), "exec.ResizeSession")
	defer span.End()
	defer func() {
		if err != nil {
			telemetryutil.RecordError(span, err)
		}
	}()
	span.SetAttributes(attribute.String("session_id", sessionID))

	index, client, ok := c.lookupSession(sessionID)
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.ResizeSession(sessionID, rows, cols)
	}
	if client == nil {
		return apperror.PluginNotFound(index.pluginID)
	}
	return client.ResizeSession(
		c.getConnectedCtx(ctx, index.pluginID, index.connectionID),
		sessionID,
		int32(cols),
		int32(rows),
	)
}
