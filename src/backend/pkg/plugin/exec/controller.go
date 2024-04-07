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
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/exec"
)

type Controller interface {
	internaltypes.Controller
}

// make it easy for us to lookup sessions by ID, without having to know
// the plugin or connection ID.
type sessionIndex struct {
	local        bool
	pluginID     string
	connectionID string
}

func NewController(
	logger *zap.SugaredLogger,
	resourceClient resource.IClient,
) *controller {
	return &controller{
		logger:         logger.Named("ExecController"),
		stops:          make(map[string]chan struct{}),
		sessionIndex:   make(map[string]sessionIndex),
		inChans:        make(map[string]chan exec.StreamInput),
		inputMux:       make(chan exec.StreamInput),
		outputMux:      make(chan exec.StreamOutput),
		resizeMux:      make(chan exec.StreamResize),
		resourceClient: resourceClient,
	}
}

var _ Controller = &controller{}

type controller struct {
	// wails context
	ctx          context.Context
	logger       *zap.SugaredLogger
	clients      map[string]exec.Provider
	sessionIndex map[string]sessionIndex

	// session channels
	stops   map[string]chan struct{}
	inChans map[string]chan exec.StreamInput

	// multiplexer channels
	inputMux  chan exec.StreamInput
	outputMux chan exec.StreamOutput
	resizeMux chan exec.StreamResize

	resourceClient  resource.IClient
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

			eventkey := "core/exec/stream/" + output.Target.String() + "/" + output.SessionID
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
			if client, ok := c.inChans[input.SessionID]; ok {
				client <- input
			}
		case output := <-c.outputMux:
			// dispatch to ui
			if c.ctx == nil {
				c.logger.Error("context is nil, cannot dispatch output")
			}
			eventkey := "core/exec/stream/" + output.Target.String() + "/" + output.SessionID
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
		return nil
	}

	return sdktypes.NewPluginContextWithConnection(
		ctx,
		"exec",
		nil, // TODO: pass pluginConfig
		nil, // TODO: pass globalConfig
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
		nil, // TODO: pass pluginConfig
		nil, // TODO: pass globalConfig
		nil,
	)
}

func (c *controller) CreateSession(
	plugin string,
	connectionID string,
	opts exec.SessionOptions,
) (*exec.Session, error) {
	c.logger.Debug("StartSession")

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
		c.getConnectedCtx(context.TODO(), plugin, connectionID),
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

	inchan, ok := c.inChans[sessionID]
	if !ok {
		return fmt.Errorf("session %s not found", sessionID)
	}
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
