package exec

import (
	"context"
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

type Controller interface {
	internaltypes.Controller
	Run(ctx context.Context)
	GetPluginHandlers(plugin string) map[string]exec.Handler
	GetHandlers() map[string]map[string]exec.Handler
	GetHandler(plugin, resource string) *exec.Handler
	CreateSession(plugin, connectionID string, opts exec.SessionOptions) (*exec.Session, error)
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
	logger *zap.SugaredLogger,
	sp pkgsettings.Provider,
	resourceClient resource.Service,
) Controller {
	return &controller{
		logger:           logger.Named("ExecController"),
		settingsProvider: sp,
		stops:            make(map[string]chan struct{}),
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
	// wails context
	ctx              context.Context
	logger           *zap.SugaredLogger
	settingsProvider pkgsettings.Provider

	mu           sync.RWMutex
	clients      map[string]ExecProvider
	sessionIndex map[string]sessionIndex
	stops        map[string]chan struct{}
	inChans      map[string]chan exec.StreamInput
	handlerMap   map[string]map[string]exec.Handler

	// multiplexer channels
	inputMux  chan exec.StreamInput
	outputMux chan exec.StreamOutput
	resizeMux chan exec.StreamResize

	resourceClient  resource.Service
	terminalManager *terminal.Manager
}

func (c *controller) Run(ctx context.Context) {
	c.ctx = ctx
	go c.runMux()      // plugin mux
	go c.runLocalMux() // local terminal should be muxed separately to avoid latency
}

func listenOnOut(
	cancel chan struct{},
	source chan exec.StreamOutput,
	target chan exec.StreamOutput,
) {
	for {
		select {
		case <-cancel:
			return
		case output := <-source:
			target <- output
		}
	}
}

func (c *controller) runLocalMux() {
	manager, inMux, outMux, resizeMux := terminal.NewManager(c.logger)
	c.terminalManager = manager
	for {
		select {
		case <-c.ctx.Done():
			return
		case input := <-inMux:
			if err := manager.WriteSession(input.SessionID, input.Data); err != nil {
				c.logger.Error("error writing to session: ", err)
			}
		case output := <-outMux:
			// dispatch to ui
			if c.ctx == nil {
				c.logger.Error("context is nil, cannot dispatch output")
			}

			var eventkey string

			switch output.Signal {
			case exec.StreamSignalNone:
				eventkey = "core/exec/stream/" + output.Target.String() + "/" + output.SessionID
			case exec.StreamSignalError:
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
				if output.Error != nil {
					runtime.EventsEmit(c.ctx, eventkey, output.Error)
				} else {
					runtime.EventsEmit(c.ctx, eventkey, map[string]interface{}{
						"title":      "Session error",
						"message":    string(output.Data),
						"suggestion": "The session encountered an error.",
						"retryable":  false,
					})
				}
				continue
			case exec.StreamSignalClose:
				c.logger.Debug("closing session")
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
				// session doesn't exist anymore, remove it from the index
				c.mu.Lock()
				delete(c.sessionIndex, output.SessionID)
				c.mu.Unlock()
			default:
				c.logger.Debugw("received signal", "signal", output.Signal.String())
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
			}

			runtime.EventsEmit(c.ctx, eventkey, output.Data)
		case resize := <-resizeMux:
			if err := manager.ResizeSession(resize.SessionID, resize.Rows, resize.Cols); err != nil {
				c.logger.Error("error resizing session: ", err)
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
			c.logger.Debugw("got input", "input", input)
			c.mu.RLock()
			client, ok := c.inChans[input.SessionID]
			c.mu.RUnlock()
			if ok {
				client <- input
			}
		case output := <-c.outputMux:
			// dispatch to ui
			if c.ctx == nil {
				c.logger.Error("context is nil, cannot dispatch output")
			}

			var eventkey string

			switch output.Signal {
			case exec.StreamSignalNone:
				eventkey = "core/exec/stream/" + output.Target.String() + "/" + output.SessionID
			case exec.StreamSignalError:
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
				if output.Error != nil {
					runtime.EventsEmit(c.ctx, eventkey, output.Error)
				} else {
					runtime.EventsEmit(c.ctx, eventkey, map[string]interface{}{
						"title":      "Session error",
						"message":    string(output.Data),
						"suggestion": "The session encountered an error.",
						"retryable":  false,
					})
				}
				continue
			case exec.StreamSignalClose:
				c.logger.Debug("closing session")
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
				// session doesn't exist anymore, remove it from the index
				c.mu.Lock()
				delete(c.sessionIndex, output.SessionID)
				c.mu.Unlock()
			default:
				c.logger.Debugw("received signal", "signal", output.Signal.String())
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
			}

			runtime.EventsEmit(c.ctx, eventkey, output.Data)
		}
	}
}

func (c *controller) OnPluginInit(pluginID string, meta config.PluginMeta) {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginInit")

	c.mu.Lock()
	if c.clients == nil {
		c.clients = make(map[string]ExecProvider)
	}
	if c.stops == nil {
		c.stops = make(map[string]chan struct{})
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
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		logger.Error(err)
		return err
	}

	// Get the handlers before acquiring the lock (this makes an RPC call).
	handlers := provider.GetSupportedResources(c.getUnconnectedCtx(context.Background(), ""))

	inchan := make(chan exec.StreamInput)

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

	// start the stream on a goroutine
	go func() {
		stream, err := provider.Stream(c.ctx, inchan)
		if err != nil {
			logger.Error("error starting stream: ", err)
			return
		}

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

func (c *controller) OnPluginStop(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginStop")

	c.mu.Lock()
	if ch, ok := c.inChans[pluginID]; ok {
		close(ch)
		delete(c.inChans, pluginID)
	}
	provider, ok := c.clients[pluginID]
	delete(c.clients, pluginID)
	c.mu.Unlock()
	if ok {
		provider.Close()
	}
	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginShutdown")

	c.mu.Lock()
	delete(c.clients, pluginID)
	c.mu.Unlock()
	return nil
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginDestroy")

	// nil action
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	c.logger.Debug("ListPlugins")
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
		c.logger.Errorw("error getting connection: ", "err", err)
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

func (c *controller) CreateSession(
	plugin string,
	connectionID string,
	opts exec.SessionOptions,
) (*exec.Session, error) {
	if plugin == "local" {
		// start local terminal
		session, err := c.terminalManager.StartSession(
			c.getUnconnectedCtx(context.Background(), plugin),
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

	session, err := client.CreateSession(
		c.getConnectedCtx(context.Background(), plugin, connectionID),
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

func (c *controller) ListSessions() ([]*exec.Session, error) {
	c.logger.Debug("ListSessions")
	ctx := c.getUnconnectedCtx(context.Background(), "")

	c.mu.RLock()
	clients := make([]ExecProvider, 0, len(c.clients))
	for _, client := range c.clients {
		clients = append(clients, client)
	}
	c.mu.RUnlock()

	sessions := make([]*exec.Session, 0)
	for _, client := range clients {
		clientSessions, err := client.ListSessions(ctx)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, clientSessions...)
	}

	// add the local terminal sessions
	sessions = append(sessions, c.terminalManager.ListSessions(ctx)...)

	return sessions, nil
}

func (c *controller) GetSession(
	sessionID string,
) (*exec.Session, error) {
	c.logger.Debug("GetSession")
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}

	if index.local {
		return c.terminalManager.GetSession(sessionID)
	}

	c.mu.RLock()
	client, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.PluginNotFound(index.pluginID)
	}
	return client.GetSession(
		c.getConnectedCtx(context.TODO(), index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) AttachSession(sessionID string) (*exec.Session, []byte, error) {
	c.logger.Debug("AttachSession")
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	c.mu.RUnlock()
	if !ok {
		return nil, nil, apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.AttachSession(sessionID)
	}

	c.mu.RLock()
	client, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		return nil, nil, apperror.PluginNotFound(index.pluginID)
	}
	return client.AttachSession(
		c.getConnectedCtx(context.TODO(), index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) DetachSession(sessionID string) (*exec.Session, error) {
	c.logger.Debug("DetachSession")
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.DetachSession(sessionID)
	}

	c.mu.RLock()
	client, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.PluginNotFound(index.pluginID)
	}
	return client.DetachSession(
		c.getConnectedCtx(context.TODO(), index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) WriteSession(
	sessionID string,
	data []byte,
) error {
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	c.mu.RUnlock()
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.WriteSession(sessionID, data)
	}

	c.mu.RLock()
	inchan, ok := c.inChans[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}
	c.logger.Debug("Writing to session")
	inchan <- exec.StreamInput{
		SessionID: sessionID,
		Data:      data,
	}
	return nil
}

func (c *controller) CloseSession(
	sessionID string,
) error {
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	c.mu.RUnlock()
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.CloseSession(sessionID)
	}

	c.mu.RLock()
	client, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		return apperror.PluginNotFound(index.pluginID)
	}

	return client.CloseSession(
		c.getConnectedCtx(context.TODO(), index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) ResizeSession(
	sessionID string,
	rows, cols uint16,
) error {
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	c.mu.RUnlock()
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}
	if index.local {
		return c.terminalManager.ResizeSession(sessionID, rows, cols)
	}
	c.mu.RLock()
	client, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		return apperror.PluginNotFound(index.pluginID)
	}
	return client.ResizeSession(
		c.getConnectedCtx(context.TODO(), index.pluginID, index.connectionID),
		sessionID,
		int32(cols),
		int32(rows),
	)
}
