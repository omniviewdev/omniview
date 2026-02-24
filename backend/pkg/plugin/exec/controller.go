package exec

import (
	"context"
	"fmt"
	"reflect"

	"github.com/hashicorp/go-plugin"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/exec"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/settings"
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
	resourceClient resource.IClient,
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
	clients          map[string]exec.Provider
	sessionIndex     map[string]sessionIndex

	// session channels
	stops   map[string]chan struct{}
	inChans map[string]chan exec.StreamInput

	// multiplexer channels
	inputMux  chan exec.StreamInput
	outputMux chan exec.StreamOutput
	resizeMux chan exec.StreamResize

	resourceClient  resource.IClient
	handlerMap      map[string]map[string]exec.Handler
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
				delete(c.sessionIndex, output.SessionID)
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
			if client, ok := c.inChans[input.SessionID]; ok {
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
				delete(c.sessionIndex, output.SessionID)
			default:
				c.logger.Debugw("received signal", "signal", output.Signal.String())
				eventkey = "core/exec/signal/" + output.Signal.String() + "/" + output.SessionID
			}

			runtime.EventsEmit(c.ctx, eventkey, output.Data)
		}
	}
}

func (c *controller) OnPluginInit(meta config.PluginMeta) {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginInit")

	if c.clients == nil {
		c.clients = make(map[string]exec.Provider)
	}
	if c.stops == nil {
		c.stops = make(map[string]chan struct{})
	}
}

func (c *controller) OnPluginStart(meta config.PluginMeta, client plugin.ClientProtocol) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStart")

	raw, err := client.Dispense("exec")
	if err != nil {
		return err
	}

	provider, ok := raw.(exec.Provider)
	if !ok {
		typeof := reflect.TypeOf(raw).String()
		err = fmt.Errorf("could not start plugin: expected exec.Provider, got %s", typeof)
		logger.Error(err)
		return err
	}

	c.clients[meta.ID] = provider

	// get the handlers and ensure the map is updated
	handlers := provider.GetSupportedResources(c.getUnconnectedCtx(context.Background(), ""))
	for _, handler := range handlers {
		if _, ok := c.handlerMap[handler.Plugin]; !ok {
			c.handlerMap[handler.Plugin] = make(map[string]exec.Handler)
		}

		// TODO: for now we're just overwriting, but we should do something else here once we
		// determine what we should support. Eventually we should support multiple handlers
		// for a single resource type.
		c.handlerMap[handler.Plugin][handler.Resource] = handler
	}

	inchan := make(chan exec.StreamInput)
	c.inChans[meta.ID] = inchan

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
			case output := <-stream:
				c.outputMux <- output
			}
		}
	}()

	return nil
}

func (c *controller) OnPluginStop(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStop")

	delete(c.clients, meta.ID)
	return nil
}

func (c *controller) OnPluginShutdown(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginShutdown")

	delete(c.clients, meta.ID)
	return nil
}

func (c *controller) OnPluginDestroy(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginDestroy")

	// nil action
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	c.logger.Debug("ListPlugins")
	plugins := make([]string, 0, len(c.clients))
	for k := range c.clients {
		plugins = append(plugins, k)
	}
	return plugins, nil
}

func (c *controller) HasPlugin(pluginID string) bool {
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
	return c.handlerMap[plugin]
}

func (c *controller) GetHandlers() map[string]map[string]exec.Handler {
	return c.handlerMap
}

func (c *controller) GetHandler(
	plugin string,
	resource string,
) *exec.Handler {
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
		c.sessionIndex[session.ID] = sessionIndex{local: true}
		return session, nil
	}

	client, ok := c.clients[plugin]
	if !ok {
		return nil, fmt.Errorf("plugin %s not found", plugin)
	}

	session, err := client.CreateSession(
		c.getConnectedCtx(context.Background(), plugin, connectionID),
		opts,
	)
	if err != nil {
		return nil, err
	}

	c.sessionIndex[session.ID] = sessionIndex{
		local:        false,
		pluginID:     plugin,
		connectionID: connectionID,
	}

	return session, nil
}

func (c *controller) ListSessions() ([]*exec.Session, error) {
	c.logger.Debug("ListSessions")
	ctx := c.getUnconnectedCtx(context.Background(), "")

	// go through all clients and list sessions
	sessions := make([]*exec.Session, 0)
	for _, client := range c.clients {
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
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}

	if index.local {
		return c.terminalManager.GetSession(sessionID)
	}

	client, ok := c.clients[index.pluginID]
	if !ok {
		return nil, fmt.Errorf("plugin %s not found", index.pluginID)
	}
	return client.GetSession(
		c.getConnectedCtx(context.TODO(), index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) AttachSession(sessionID string) (*exec.Session, []byte, error) {
	c.logger.Debug("AttachSession")
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return nil, nil, fmt.Errorf("session %s not found", sessionID)
	}
	if index.local {
		return c.terminalManager.AttachSession(sessionID)
	}

	client, ok := c.clients[index.pluginID]
	if !ok {
		return nil, nil, fmt.Errorf("plugin %s not found", index.pluginID)
	}
	return client.AttachSession(
		c.getConnectedCtx(context.TODO(), index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) DetachSession(sessionID string) (*exec.Session, error) {
	c.logger.Debug("DetachSession")
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return nil, fmt.Errorf("session %s not found", sessionID)
	}
	if index.local {
		return c.terminalManager.DetachSession(sessionID)
	}

	client, ok := c.clients[index.pluginID]
	if !ok {
		return nil, fmt.Errorf("plugin %s not found", index.pluginID)
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
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}
	if index.local {
		return c.terminalManager.WriteSession(sessionID, data)
	}

	inchan, ok := c.inChans[index.pluginID]
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
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
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}
	if index.local {
		return c.terminalManager.CloseSession(sessionID)
	}

	client, ok := c.clients[index.pluginID]
	if !ok {
		return fmt.Errorf("plugin %s not found", index.pluginID)
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
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}
	if index.local {
		return c.terminalManager.ResizeSession(sessionID, rows, cols)
	}
	client, ok := c.clients[index.pluginID]
	if !ok {
		return fmt.Errorf("plugin %s not found", index.pluginID)
	}
	return client.ResizeSession(
		c.getConnectedCtx(context.TODO(), index.pluginID, index.connectionID),
		sessionID,
		int32(cols),
		int32(rows),
	)
}
