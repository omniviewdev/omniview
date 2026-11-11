package logs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/telemetry"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

var tracer = otel.Tracer("omniview.logs")

const (
	BatchFlushInterval = 50 * time.Millisecond
	BatchMaxSize       = 100

	// outputMuxBuffer is the buffer size of the plugin output multiplexer channel.
	outputMuxBuffer = 256

	uiSessionCreateTimeout = 90 * time.Second
)

// Controller manages log sessions across all plugins.
type Controller interface {
	internaltypes.Controller
	ServiceStartup(ctx context.Context, options application.ServiceOptions) error
	ServiceShutdown() error
	SetReferenceAdmitter(resource.ReferenceAdmitter)
	SetUIReferenceAdmitter(resource.ReferenceAdmitter)
	GetSupportedResources(pluginID string) []logs.Handler
	CreateSession(context.Context, string, string, logs.CreateSessionOptions) (*logs.LogSession, error)
	ReadResourceLogs(context.Context, string, logs.CreateSessionOptions) (*HeadlessResult, error)
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
	app                 *application.App
	ctx                 context.Context
	logger              logging.Logger
	settingsProvider    pkgsettings.Provider
	resourceClient      resource.ConnectionReader
	referenceAdmitter   resource.ReferenceAdmitter
	uiReferenceAdmitter resource.ReferenceAdmitter
	outputMux           chan logs.StreamOutput

	mu           sync.RWMutex
	clients      map[string]Provider
	sessionIndex map[string]sessionIndex
	inChans      map[string]chan logs.StreamInput
	handlerMap   map[string]map[string]logs.Handler
	headless     map[string]*headlessRead
	streams      map[string]logProviderStream

	// batch flush state
	batches  map[string]*logBatch
	batchMux sync.Mutex
}

type logProviderStream struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// SetReferenceAdmitter binds native admission without changing invocation identity.
func (c *controller) SetReferenceAdmitter(admit resource.ReferenceAdmitter) {
	c.referenceAdmitter = admit
}

// SetUIReferenceAdmitter binds the UI-only entry point to its host-issued realm.
// Headless consumption never invokes this callback.
func (c *controller) SetUIReferenceAdmitter(admit resource.ReferenceAdmitter) {
	c.uiReferenceAdmitter = admit
}

type logBatch struct {
	lines []logs.LogLine
	timer *time.Timer
}

func NewController(
	logger logging.Logger,
	sp pkgsettings.Provider,
	resourceClient resource.ConnectionReader,
) Controller {
	return &controller{
		app:              nil,
		ctx:              nil,
		logger:           logger.Named("LogController"),
		settingsProvider: sp,
		mu:               sync.RWMutex{},
		clients:          make(map[string]Provider),
		sessionIndex:     make(map[string]sessionIndex),
		inChans:          make(map[string]chan logs.StreamInput),
		outputMux:        make(chan logs.StreamOutput, outputMuxBuffer),
		resourceClient:   resourceClient,
		handlerMap:       make(map[string]map[string]logs.Handler),
		batches:          make(map[string]*logBatch),
		batchMux:         sync.Mutex{},
	}
}

func (c *controller) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	c.app = application.Get()
	c.ctx = ctx
	go c.runMux()
	return nil
}

func (c *controller) ServiceShutdown() error {
	c.mu.RLock()
	plugins := make([]string, 0, len(c.clients))
	for pluginID := range c.clients {
		plugins = append(plugins, pluginID)
	}
	c.mu.RUnlock()
	for _, pluginID := range plugins {
		if stopErr := c.OnPluginStop(pluginID, config.PluginMeta{}); stopErr != nil {
			c.logger.Warnw(context.Background(), "log provider stop failed during shutdown",
				"pluginID", pluginID, "errorClass", telemetryutil.ErrorClass(stopErr))
		}
	}
	return nil
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
	c.mu.RLock()
	read := c.headless[output.SessionID]
	_, indexed := c.sessionIndex[output.SessionID]
	c.mu.RUnlock()
	if read != nil {
		read.accept(output)
		return
	}
	if !indexed {
		// Output for a closed or retired session is expected after close; keep the trail at Debug.
		c.logger.Debugw(context.Background(), "dropped log output for unknown session",
			"sessionID", output.SessionID, "errorClass", "NOT_FOUND")
		return
	}
	if output.Line != nil {
		c.bufferLine(output.SessionID, *output.Line)
	} else if output.Event != nil {
		// Serialize publication with session retirement.
		c.batchMux.Lock()
		defer c.batchMux.Unlock()
		c.mu.RLock()
		_, active := c.sessionIndex[output.SessionID]
		c.mu.RUnlock()
		if !active {
			c.logger.Debugw(context.Background(), "dropped log event for retired session", "sessionID", output.SessionID)
			return
		}
		// Events are sent immediately, not batched
		eventKey := "core/logs/event/" + output.SessionID
		data, err := json.Marshal(output.Event)
		if err != nil {
			c.logger.Errorw(context.Background(), "failed to marshal log event", "errorClass", telemetryutil.ErrorClass(err))
			return
		}
		c.app.Event.Emit(eventKey, string(data))
	}
}

func (c *controller) bufferLine(sessionID string, line logs.LogLine) {
	c.batchMux.Lock()
	defer c.batchMux.Unlock()
	c.mu.RLock()
	_, active := c.sessionIndex[sessionID]
	c.mu.RUnlock()
	if !active {
		c.logger.Debugw(context.Background(), "dropped log line for retired session", "sessionID", sessionID)
		return
	}

	batch, ok := c.batches[sessionID]
	if !ok {
		batch = &logBatch{
			lines: make([]logs.LogLine, 0, BatchMaxSize),
			timer: nil,
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

			if b, found := c.batches[sessionID]; found && len(b.lines) > 0 {
				c.flushBatchLocked(sessionID, b)
			}
		})
	}
}

func (c *controller) flushBatchLocked(sessionID string, batch *logBatch) {
	c.mu.RLock()
	_, active := c.sessionIndex[sessionID]
	c.mu.RUnlock()
	if !active {
		if batch.timer != nil {
			batch.timer.Stop()
		}
		delete(c.batches, sessionID)
		return
	}
	if batch.timer != nil {
		batch.timer.Stop()
		batch.timer = nil
	}

	eventKey := "core/logs/lines/" + sessionID
	data, err := json.Marshal(batch.lines)
	if err != nil {
		c.logger.Errorw(context.Background(), "failed to marshal log batch", "errorClass", telemetryutil.ErrorClass(err))
	} else {
		c.app.Event.Emit(eventKey, string(data))
	}

	batch.lines = batch.lines[:0]
}

// ================================ Controller Lifecycle ================================ //

func (c *controller) OnPluginInit(pluginID string, _ config.PluginMeta) {
	ctx, end := startOp(context.Background(), "logs.OnPluginInit", attribute.String("plugin_id", pluginID))
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

// dispenseProvider extracts the logs provider from the backend,
// wrapping it in the version-appropriate adapter.
func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (Provider, error) {
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
				apperror.TypePluginLoadFailed, http.StatusInternalServerError,
				"Plugin type mismatch",
				fmt.Sprintf("Expected logs.Provider for v1, got %T", raw),
			)
		}
		return NewAdapterV1(v1), nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for log, engine supports v1", pluginID, version),
		)
	}
}

func (c *controller) OnPluginStart(pluginID string, _ config.PluginMeta, backend internaltypes.PluginBackend) error {
	ctx, span := tracer.Start(context.Background(), "logs.OnPluginStart")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		telemetryutil.RecordError(span, err)
		logger.Errorw(ctx, "error", "errorClass", telemetryutil.ErrorClass(err))
		return err
	}

	// Get the handlers before acquiring the lock (this makes an RPC call).
	handlers := provider.GetSupportedResources(c.getUnconnectedCtx(ctx))
	// Retire the previous generation before publishing its replacement.
	if stopErr := c.OnPluginStop(pluginID, config.PluginMeta{}); stopErr != nil {
		logger.Warnw(ctx, "failed to stop previous log provider before restart",
			"errorClass", telemetryutil.ErrorClass(stopErr))
	}

	base := c.ctx
	if base == nil {
		base = context.Background()
	}
	streamCtx, cancel := context.WithCancel(trace.ContextWithSpan(base, span))
	done := make(chan struct{})
	inchan := make(chan logs.StreamInput)

	c.mu.Lock()
	if previous, ok := c.inChans[pluginID]; ok {
		close(previous)
	}
	for _, read := range c.headless {
		if read.pluginID == pluginID {
			read.mu.Lock()
			read.finish(resourcev2.NewError("CONNECTION_ERROR", "Log provider replaced."))
			read.mu.Unlock()
		}
	}
	if c.streams == nil {
		c.streams = make(map[string]logProviderStream)
	}
	c.streams[pluginID] = logProviderStream{cancel: cancel, done: done}
	c.clients[pluginID] = provider
	for _, handler := range handlers {
		if _, ok := c.handlerMap[handler.Plugin]; !ok {
			c.handlerMap[handler.Plugin] = make(map[string]logs.Handler)
		}
		c.handlerMap[handler.Plugin][handler.Resource] = handler
	}
	c.inChans[pluginID] = inchan
	c.mu.Unlock()

	// Start the stream using the span-linked context for trace correlation.
	// We derive a new context from c.ctx that carries the current span so
	// that logs emitted inside the goroutine are correlated with the
	// OnPluginStart trace, while still respecting the controller's lifecycle.
	go func() {
		defer close(done)
		openCtx, end := startOp(streamCtx, "logs.StreamOpen", attribute.String("plugin_id", pluginID))
		stream, streamErr := provider.Stream(openCtx, inchan)
		end(&streamErr)
		if streamErr != nil {
			logger.Errorw(openCtx, "error starting log stream", "errorClass", telemetryutil.ErrorClass(streamErr))
			telemetry.RecordPluginStreamEvent(streamCtx, pluginID, "logs", "closed_error")
			return
		}
		first := true
		for {
			select {
			case <-streamCtx.Done():
				logger.Debugw(streamCtx, "log provider stream closed", "closeReason", "canceled")
				return
			case output, ok := <-stream:
				if !ok {
					// A stream that ends while the plugin is still installed means the provider exited.
					if streamCtx.Err() == nil {
						logger.Warnw(streamCtx, "log provider stream closed unexpectedly")
						telemetry.RecordPluginStreamEvent(streamCtx, pluginID, "logs", "closed_error")
					}
					return // stream closed, plugin exited
				}
				if first {
					logger.Debugw(streamCtx, "log provider stream first event", "sessionID", output.SessionID)
					first = false
				}
				if output.Event != nil {
					switch output.Event.Type {
					case logs.StreamEventStreamError:
						logger.Warnw(streamCtx, "log session stream failed", "sessionID", output.SessionID, "closeReason", "error")
						telemetry.RecordPluginStreamEvent(streamCtx, pluginID, "logs", "closed_error")
					case logs.StreamEventStreamEnded:
						logger.Debugw(streamCtx, "log session stream ended", "sessionID", output.SessionID, "closeReason", "normal")
					case logs.StreamEventSourceAdded, logs.StreamEventSourceRemoved,
						logs.StreamEventReconnecting, logs.StreamEventReconnected, logs.StreamEventSessionReady:
						// These event types need no additional diagnostics.
					}
				}
				select {
				case c.outputMux <- output:
				case <-streamCtx.Done():
					return
				}
			}
		}
	}()

	return nil
}

func (c *controller) OnPluginStop(pluginID string, _ config.PluginMeta) error {
	ctx, end := startOp(context.Background(), "logs.OnPluginStop", attribute.String("plugin_id", pluginID))
	var err error
	defer end(&err)
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(ctx, "OnPluginStop")
	// Batch publication and retirement share this outer lock. Never acquire
	// batchMux while holding mu.
	c.batchMux.Lock()
	c.mu.Lock()
	provider := c.clients[pluginID]
	stream := c.streams[pluginID]
	delete(c.streams, pluginID)
	if stream.cancel != nil {
		stream.cancel()
	}
	if ch, ok := c.inChans[pluginID]; ok {
		close(ch)
		delete(c.inChans, pluginID)
	}
	delete(c.clients, pluginID)
	for sessionID, index := range c.sessionIndex {
		if index.pluginID == pluginID {
			if batch := c.batches[sessionID]; batch != nil {
				if batch.timer != nil {
					batch.timer.Stop()
				}
				delete(c.batches, sessionID)
			}
			delete(c.sessionIndex, sessionID)
		}
	}
	for _, read := range c.headless {
		if read.pluginID == pluginID {
			c.logger.Debugw(ctx, "finishing headless log read for stopped provider", "pluginID", pluginID)
			read.mu.Lock()
			read.finish(resourcev2.NewError("CONNECTION_ERROR", "Log provider stopped."))
			read.mu.Unlock()
		}
	}
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
	c.batchMux.Unlock()
	if closer, ok := provider.(interface{ Close() }); ok {
		closer.Close()
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
	ctx, end := startOp(context.Background(), "logs.OnPluginDestroy", attribute.String("plugin_id", pluginID))
	var err error
	defer end(&err)
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(ctx, "OnPluginDestroy")
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	var err error
	_, end := startOp(context.Background(), "logs.ListPlugins")
	defer end(&err)
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
	_, end := startOp(context.Background(), "logs.HasPlugin", attribute.String("plugin_id", pluginID))
	defer end(&err)
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
) (*sdktypes.PluginContext, error) {
	connection, err := c.resourceClient.GetConnection(ctx, pluginID, connectionID)
	if err != nil {
		c.logger.Errorw(ctx, "error getting connection", "errorClass", telemetryutil.ErrorClass(err))
		return nil, err
	}

	return sdktypes.NewPluginContextWithConnection(
		ctx,
		"log",
		nil,
		nil,
		&connection,
	), nil
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
	var err error
	_, end := startOp(context.Background(), "logs.GetSupportedResources", attribute.String("plugin_id", pluginID))
	defer end(&err)
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
	ctx context.Context,
	pluginID string,
	connectionID string,
	opts logs.CreateSessionOptions,
) (*logs.LogSession, error) {
	ctx, cancel := context.WithTimeout(ctx, uiSessionCreateTimeout)
	defer cancel()
	return c.createSessionWithContext(ctx, pluginID, connectionID, opts)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) createSessionWithContext(
	ctx context.Context,
	pluginID string,
	connectionID string,
	opts logs.CreateSessionOptions,
) (_ *logs.LogSession, err error) {
	ctx, end := startOp(ctx, "logs.CreateSession",
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
	)
	defer end(&err)
	started := time.Now()
	if opts.Reference != nil {
		if c.uiReferenceAdmitter == nil {
			return nil, resourcev2.NewError("UNSUPPORTED", "Resource reference admission is unavailable.")
		}
		if opts.Route == nil || opts.Route.Connection != connectionID {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Resource route does not match the selected connection.")
		}
		admitted, admitErr := c.uiReferenceAdmitter(ctx, "logs.CreateSession", pluginID, *opts.Route, *opts.Reference)
		if admitErr != nil {
			c.logger.Warnw(ctx, "log session reference admission rejected", "pluginID", pluginID,
				"connectionID", connectionID, "errorClass", telemetryutil.ErrorClass(admitErr))
			return nil, admitErr
		}
		ctx = admitted
	}

	c.mu.RLock()
	client, ok := c.clients[pluginID]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}
	// The UI may reserve a correlation ID before the RPC to subscribe before
	// the provider emits output. The ID is correlation, not authority.
	if opts.SessionID == "" {
		opts.SessionID = uuid.NewString()
	} else if _, parseErr := uuid.Parse(opts.SessionID); parseErr != nil {
		return nil, resourcev2.NewError("INVALID_REQUEST", "Log session ID must be a UUID.")
	}
	trace.SpanFromContext(ctx).SetAttributes(attribute.String("session_id", opts.SessionID))
	c.mu.Lock()
	if _, exists := c.sessionIndex[opts.SessionID]; exists {
		c.mu.Unlock()
		return nil, resourcev2.NewError("INVALID_REQUEST", "Log session ID is already in use.")
	}
	c.sessionIndex[opts.SessionID] = sessionIndex{pluginID: pluginID, connectionID: connectionID}
	c.mu.Unlock()
	pctx, err := c.getConnectedCtx(ctx, pluginID, connectionID)
	if err != nil {
		c.mu.Lock()
		delete(c.sessionIndex, opts.SessionID)
		c.mu.Unlock()
		return nil, err
	}
	session, err := client.CreateSession(
		pctx,
		opts,
	)
	if err == nil {
		err = ctx.Err()
	}
	if err == nil && (session == nil || session.ID != opts.SessionID) {
		err = resourcev2.NewError("PROVIDER_ERROR", "Log provider returned an invalid session.")
	}
	if err != nil {
		closeCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer stop()
		closeErr := client.CloseSession(resourceLogPluginContext(closeCtx, connectionID), opts.SessionID)
		if closeErr != nil && resourcev2.ErrorCode(closeErr) != "NOT_FOUND" {
			c.logger.Errorw(closeCtx, "resource log session cleanup failed",
				"session_id", opts.SessionID, "errorClass", telemetryutil.ErrorClass(closeErr))
		}
		c.mu.Lock()
		delete(c.sessionIndex, opts.SessionID)
		c.mu.Unlock()
		c.batchMux.Lock()
		if batch := c.batches[opts.SessionID]; batch != nil {
			if batch.timer != nil {
				batch.timer.Stop()
			}
			delete(c.batches, opts.SessionID)
		}
		c.batchMux.Unlock()
		c.logger.Errorw(ctx, "log session create failed", "pluginID", pluginID, "connectionID", connectionID,
			"sessionID", opts.SessionID, "errorClass", telemetryutil.ErrorClass(err))
		return nil, err
	}

	session.PluginID = pluginID
	session.ConnectionID = connectionID
	c.logger.Infow(ctx, "log session created", "pluginID", pluginID, "connectionID", connectionID,
		"sessionID", session.ID, "durationMs", time.Since(started).Milliseconds())

	return session, nil
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) GetSession(sessionID string) (_ *logs.LogSession, err error) {
	ctx, end := startOp(context.Background(), "logs.GetSession", attribute.String("session_id", sessionID))
	defer end(&err)

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
	trace.SpanFromContext(ctx).SetAttributes(
		attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID),
	)

	pctx, err := c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID)
	if err != nil {
		return nil, err
	}
	return client.GetSession(
		pctx,
		sessionID,
	)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) ListSessions() (_ []*logs.LogSession, err error) {
	bgCtx, end := startOp(context.Background(), "logs.ListSessions")
	defer end(&err)

	ctx := c.getUnconnectedCtx(bgCtx)

	c.mu.RLock()
	clients := make([]Provider, 0, len(c.clients))
	for _, client := range c.clients {
		clients = append(clients, client)
	}
	c.mu.RUnlock()

	sessions := make([]*logs.LogSession, 0)
	for _, client := range clients {
		clientSessions, listErr := client.ListSessions(ctx)
		if listErr != nil {
			return nil, listErr
		}
		sessions = append(sessions, clientSessions...)
	}
	trace.SpanFromContext(bgCtx).SetAttributes(attribute.Int("sessions", len(sessions)))

	return sessions, nil
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) CloseSession(sessionID string) (err error) {
	ctx, end := startOp(context.Background(), "logs.CloseSession", attribute.String("session_id", sessionID))
	defer end(&err)

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
	trace.SpanFromContext(ctx).SetAttributes(
		attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID),
	)

	pctx, err := c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID)
	if err != nil {
		return err
	}
	err = client.CloseSession(
		pctx,
		sessionID,
	)
	if err != nil {
		c.logger.Warnw(ctx, "log session close failed", "pluginID", index.pluginID,
			"sessionID", sessionID, "errorClass", telemetryutil.ErrorClass(err))
		return err
	}

	// Clean up batch state
	c.batchMux.Lock()
	if batch, found := c.batches[sessionID]; found {
		if batch.timer != nil {
			batch.timer.Stop()
		}
		delete(c.batches, sessionID)
	}
	c.mu.Lock()
	delete(c.sessionIndex, sessionID)
	c.mu.Unlock()
	c.batchMux.Unlock()
	c.logger.Infow(ctx, "log session closed", "pluginID", index.pluginID,
		"sessionID", sessionID, "closeReason", "requested")

	return nil
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) SendCommand(sessionID string, cmd logs.LogStreamCommand) (err error) {
	ctx, end := startOp(context.Background(), "logs.SendCommand",
		attribute.String("session_id", sessionID),
		attribute.Int("command", int(cmd)),
	)
	defer end(&err)

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
	c.logger.Debugw(ctx, "log stream command sent", "pluginID", index.pluginID,
		"sessionID", sessionID, "command", int(cmd))
	return nil
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) UpdateSessionOptions(
	sessionID string,
	opts logs.LogSessionOptions,
) (_ *logs.LogSession, err error) {
	ctx, end := startOp(context.Background(), "logs.UpdateSessionOptions", attribute.String("session_id", sessionID))
	defer end(&err)

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
	trace.SpanFromContext(ctx).SetAttributes(
		attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID),
	)

	pctx, err := c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID)
	if err != nil {
		return nil, err
	}
	return client.UpdateSessionOptions(
		pctx,
		sessionID,
		opts,
	)
}
