package logs

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/logs"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const (
	BatchFlushInterval = 50 * time.Millisecond
	BatchMaxSize       = 100
)

// Controller manages log sessions across all plugins.
type Controller interface {
	internaltypes.Controller
	Run(ctx context.Context)
	GetSupportedResources(pluginID string) []logs.Handler
	CreateSession(plugin, connectionID string, opts logs.CreateSessionOptions) (*logs.LogSession, error)
	GetSession(sessionID string) (*logs.LogSession, error)
	ListSessions() ([]*logs.LogSession, error)
	CloseSession(sessionID string) error
	SendCommand(sessionID string, cmd logs.LogStreamCommand) error
	UpdateSessionOptions(sessionID string, opts logs.LogSessionOptions) (*logs.LogSession, error)
}

type sessionIndex struct {
	pluginID     string
	connectionID string
}

var _ Controller = (*controller)(nil)

type controller struct {
	ctx              context.Context
	logger           *zap.SugaredLogger
	settingsProvider pkgsettings.Provider
	clients          map[string]logs.Provider
	sessionIndex     map[string]sessionIndex
	inChans          map[string]chan logs.StreamInput
	outputMux        chan logs.StreamOutput
	resourceClient   resource.IClient
	handlerMap       map[string]map[string]logs.Handler

	// batch flush state
	batches   map[string]*logBatch
	batchMux  sync.Mutex
}

type logBatch struct {
	lines []logs.LogLine
	timer *time.Timer
}

func NewController(
	logger *zap.SugaredLogger,
	sp pkgsettings.Provider,
	resourceClient resource.IClient,
) Controller {
	return &controller{
		logger:           logger.Named("LogController"),
		settingsProvider: sp,
		clients:          make(map[string]logs.Provider),
		sessionIndex:     make(map[string]sessionIndex),
		inChans:          make(map[string]chan logs.StreamInput),
		outputMux:        make(chan logs.StreamOutput, 256),
		resourceClient:   resourceClient,
		handlerMap:       make(map[string]map[string]logs.Handler),
		batches:          make(map[string]*logBatch),
	}
}

func (c *controller) Run(ctx context.Context) {
	c.ctx = ctx
	go c.runMux()
}

func (c *controller) runMux() {
	for {
		select {
		case <-c.ctx.Done():
			return
		case output := <-c.outputMux:
			c.handleOutput(output)
		}
	}
}

func (c *controller) handleOutput(output logs.StreamOutput) {
	if output.Line != nil {
		c.bufferLine(output.SessionID, *output.Line)
	} else if output.Event != nil {
		// Events are sent immediately, not batched
		eventKey := "core/logs/event/" + output.SessionID
		data, err := json.Marshal(output.Event)
		if err != nil {
			c.logger.Errorw("failed to marshal log event", "error", err)
			return
		}
		runtime.EventsEmit(c.ctx, eventKey, string(data))
	}
}

func (c *controller) bufferLine(sessionID string, line logs.LogLine) {
	c.batchMux.Lock()
	defer c.batchMux.Unlock()

	batch, ok := c.batches[sessionID]
	if !ok {
		batch = &logBatch{
			lines: make([]logs.LogLine, 0, BatchMaxSize),
		}
		c.batches[sessionID] = batch
	}

	batch.lines = append(batch.lines, line)

	if len(batch.lines) >= BatchMaxSize {
		c.flushBatchLocked(sessionID, batch)
		return
	}

	if batch.timer == nil {
		batch.timer = time.AfterFunc(BatchFlushInterval, func() {
			c.batchMux.Lock()
			defer c.batchMux.Unlock()

			if b, ok := c.batches[sessionID]; ok && len(b.lines) > 0 {
				c.flushBatchLocked(sessionID, b)
			}
		})
	}
}

func (c *controller) flushBatchLocked(sessionID string, batch *logBatch) {
	if batch.timer != nil {
		batch.timer.Stop()
		batch.timer = nil
	}

	eventKey := "core/logs/lines/" + sessionID
	data, err := json.Marshal(batch.lines)
	if err != nil {
		c.logger.Errorw("failed to marshal log batch", "error", err)
	} else {
		runtime.EventsEmit(c.ctx, eventKey, string(data))
	}

	batch.lines = batch.lines[:0]
}

// ================================ Controller Lifecycle ================================ //

func (c *controller) OnPluginInit(pluginID string, meta config.PluginMeta) {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginInit")

	if c.clients == nil {
		c.clients = make(map[string]logs.Provider)
	}
}

func (c *controller) OnPluginStart(pluginID string, meta config.PluginMeta, backend internaltypes.PluginBackend) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginStart")

	raw, err := backend.Dispense("log")
	if err != nil {
		return err
	}

	provider, ok := raw.(logs.Provider)
	if !ok {
		typeof := reflect.TypeOf(raw).String()
		appErr := apperror.New(apperror.TypePluginLoadFailed, 500, "Plugin type mismatch", fmt.Sprintf("Expected logs.Provider but got '%s'.", typeof))
		logger.Error(appErr)
		return appErr
	}

	c.clients[pluginID] = provider

	// Get the handlers
	handlers := provider.GetSupportedResources(c.getUnconnectedCtx(context.Background()))
	for _, handler := range handlers {
		if _, ok := c.handlerMap[handler.Plugin]; !ok {
			c.handlerMap[handler.Plugin] = make(map[string]logs.Handler)
		}
		c.handlerMap[handler.Plugin][handler.Resource] = handler
	}

	inchan := make(chan logs.StreamInput)
	c.inChans[pluginID] = inchan

	// Start the stream
	go func() {
		stream, err := provider.Stream(c.ctx, inchan)
		if err != nil {
			logger.Errorw("error starting log stream", "error", err)
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

func (c *controller) OnPluginStop(pluginID string, meta config.PluginMeta) error {
	c.logger.With("pluginID", pluginID).Debug("OnPluginStop")
	delete(c.clients, pluginID)
	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	c.logger.With("pluginID", pluginID).Debug("OnPluginShutdown")
	delete(c.clients, pluginID)
	return nil
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	c.logger.With("pluginID", pluginID).Debug("OnPluginDestroy")
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
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

// ================================ Context Helpers ================================ //

func (c *controller) getConnectedCtx(
	ctx context.Context,
	pluginID string,
	connectionID string,
) *sdktypes.PluginContext {
	connection, err := c.resourceClient.GetConnection(pluginID, connectionID)
	if err != nil {
		c.logger.Errorw("error getting connection", "error", err)
		return nil
	}

	return sdktypes.NewPluginContextWithConnection(
		ctx,
		"log",
		nil,
		nil,
		&connection,
	)
}

func (c *controller) getUnconnectedCtx(ctx context.Context) *sdktypes.PluginContext {
	return sdktypes.NewPluginContext(
		ctx,
		"log",
		nil,
		nil,
		nil,
	)
}

// ================================ Session Management ================================ //

func (c *controller) GetSupportedResources(pluginID string) []logs.Handler {
	if handlers, ok := c.handlerMap[pluginID]; ok {
		result := make([]logs.Handler, 0, len(handlers))
		for _, h := range handlers {
			result = append(result, h)
		}
		return result
	}
	return nil
}

func (c *controller) CreateSession(
	pluginID string,
	connectionID string,
	opts logs.CreateSessionOptions,
) (*logs.LogSession, error) {
	client, ok := c.clients[pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}

	session, err := client.CreateSession(
		c.getConnectedCtx(context.Background(), pluginID, connectionID),
		opts,
	)
	if err != nil {
		return nil, err
	}

	session.PluginID = pluginID
	session.ConnectionID = connectionID

	c.sessionIndex[session.ID] = sessionIndex{
		pluginID:     pluginID,
		connectionID: connectionID,
	}

	return session, nil
}

func (c *controller) GetSession(sessionID string) (*logs.LogSession, error) {
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}

	client, ok := c.clients[index.pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(index.pluginID)
	}

	return client.GetSession(
		c.getConnectedCtx(context.Background(), index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) ListSessions() ([]*logs.LogSession, error) {
	ctx := c.getUnconnectedCtx(context.Background())

	sessions := make([]*logs.LogSession, 0)
	for _, client := range c.clients {
		clientSessions, err := client.ListSessions(ctx)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, clientSessions...)
	}

	return sessions, nil
}

func (c *controller) CloseSession(sessionID string) error {
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}

	client, ok := c.clients[index.pluginID]
	if !ok {
		return apperror.PluginNotFound(index.pluginID)
	}

	err := client.CloseSession(
		c.getConnectedCtx(context.Background(), index.pluginID, index.connectionID),
		sessionID,
	)
	if err != nil {
		return err
	}

	// Clean up batch state
	c.batchMux.Lock()
	if batch, ok := c.batches[sessionID]; ok {
		if batch.timer != nil {
			batch.timer.Stop()
		}
		delete(c.batches, sessionID)
	}
	c.batchMux.Unlock()

	delete(c.sessionIndex, sessionID)
	return nil
}

func (c *controller) SendCommand(sessionID string, cmd logs.LogStreamCommand) error {
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return apperror.SessionNotFound(sessionID)
	}

	inchan, ok := c.inChans[index.pluginID]
	if !ok {
		return apperror.PluginNotFound(index.pluginID)
	}

	inchan <- logs.StreamInput{
		SessionID: sessionID,
		Command:   cmd,
	}
	return nil
}

func (c *controller) UpdateSessionOptions(
	sessionID string,
	opts logs.LogSessionOptions,
) (*logs.LogSession, error) {
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}

	client, ok := c.clients[index.pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(index.pluginID)
	}

	return client.UpdateSessionOptions(
		c.getConnectedCtx(context.Background(), index.pluginID, index.connectionID),
		sessionID,
		opts,
	)
}
