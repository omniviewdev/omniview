package logs

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
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
	resourceClient   resource.Service
	outputMux        chan logs.StreamOutput

	mu           sync.RWMutex
	clients      map[string]LogsProvider
	sessionIndex map[string]sessionIndex
	inChans      map[string]chan logs.StreamInput
	handlerMap   map[string]map[string]logs.Handler

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
	resourceClient resource.Service,
) Controller {
	return &controller{
		logger:           logger.Named("LogController"),
		settingsProvider: sp,
		clients:          make(map[string]LogsProvider),
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

	c.mu.Lock()
	if c.clients == nil {
		c.clients = make(map[string]LogsProvider)
	}
	c.mu.Unlock()
}

// dispenseProvider extracts the logs provider from the backend,
// wrapping it in the version-appropriate adapter.
func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (LogsProvider, error) {
	raw, err := backend.Dispense("log")
	if err != nil {
		return nil, err
	}

	version := backend.NegotiatedVersion()
	switch version {
	case 1:
		v1, ok := raw.(logs.Provider)
		if !ok {
			return nil, apperror.New(
				apperror.TypePluginLoadFailed, 500,
				"Plugin type mismatch",
				fmt.Sprintf("Expected logs.Provider for v1, got %T", raw),
			)
		}
		return NewAdapterV1(v1), nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, 500,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for log, engine supports v1", pluginID, version),
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
	handlers := provider.GetSupportedResources(c.getUnconnectedCtx(context.Background()))

	inchan := make(chan logs.StreamInput)

	c.mu.Lock()
	c.clients[pluginID] = provider
	for _, handler := range handlers {
		if _, ok := c.handlerMap[handler.Plugin]; !ok {
			c.handlerMap[handler.Plugin] = make(map[string]logs.Handler)
		}
		c.handlerMap[handler.Plugin][handler.Resource] = handler
	}
	c.inChans[pluginID] = inchan
	c.mu.Unlock()

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
	c.logger.With("pluginID", pluginID).Debug("OnPluginStop")
	c.mu.Lock()
	if ch, ok := c.inChans[pluginID]; ok {
		close(ch)
		delete(c.inChans, pluginID)
	}
	delete(c.clients, pluginID)
	// Clean up handler map entries so stale plugins don't advertise resources.
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
	c.mu.Unlock()
	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	c.logger.With("pluginID", pluginID).Debug("OnPluginShutdown")
	c.mu.Lock()
	if ch, ok := c.inChans[pluginID]; ok {
		close(ch)
		delete(c.inChans, pluginID)
	}
	delete(c.clients, pluginID)
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
	c.mu.Unlock()
	return nil
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	c.logger.With("pluginID", pluginID).Debug("OnPluginDestroy")
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
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
	c.mu.RLock()
	defer c.mu.RUnlock()
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
	c.mu.RLock()
	client, ok := c.clients[pluginID]
	c.mu.RUnlock()
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

	c.mu.Lock()
	c.sessionIndex[session.ID] = sessionIndex{
		pluginID:     pluginID,
		connectionID: connectionID,
	}
	c.mu.Unlock()

	return session, nil
}

func (c *controller) GetSession(sessionID string) (*logs.LogSession, error) {
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		c.mu.RUnlock()
		return nil, apperror.SessionNotFound(sessionID)
	}
	client, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
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

	c.mu.RLock()
	clients := make([]LogsProvider, 0, len(c.clients))
	for _, client := range c.clients {
		clients = append(clients, client)
	}
	c.mu.RUnlock()

	sessions := make([]*logs.LogSession, 0)
	for _, client := range clients {
		clientSessions, err := client.ListSessions(ctx)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, clientSessions...)
	}

	return sessions, nil
}

func (c *controller) CloseSession(sessionID string) error {
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		c.mu.RUnlock()
		return apperror.SessionNotFound(sessionID)
	}
	client, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
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

	c.mu.Lock()
	delete(c.sessionIndex, sessionID)
	c.mu.Unlock()
	return nil
}

func (c *controller) SendCommand(sessionID string, cmd logs.LogStreamCommand) error {
	c.mu.Lock()
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		c.mu.Unlock()
		return apperror.SessionNotFound(sessionID)
	}
	inchan, ok := c.inChans[index.pluginID]
	if !ok {
		c.mu.Unlock()
		return apperror.PluginNotFound(index.pluginID)
	}
	inchan <- logs.StreamInput{
		SessionID: sessionID,
		Command:   cmd,
	}
	c.mu.Unlock()
	return nil
}

func (c *controller) UpdateSessionOptions(
	sessionID string,
	opts logs.LogSessionOptions,
) (*logs.LogSession, error) {
	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		c.mu.RUnlock()
		return nil, apperror.SessionNotFound(sessionID)
	}
	client, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.PluginNotFound(index.pluginID)
	}

	return client.UpdateSessionOptions(
		c.getConnectedCtx(context.Background(), index.pluginID, index.connectionID),
		sessionID,
		opts,
	)
}
