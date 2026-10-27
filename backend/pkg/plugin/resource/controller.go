package resource

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/indexer"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const PluginName = "resource"

// Event constants for resource controller events.
const (
	EventConnectionStatus = "connection/status"
	EventWatchState       = "watch/STATE"
)

// ConnectionStatusPayload is emitted when a connection's status changes.
type ConnectionStatusPayload struct {
	PluginID     string `json:"pluginID"`
	ConnectionID string `json:"connectionID"`
	Status       string `json:"status"`
	Name         string `json:"name"`
}

func init() {
	application.RegisterEvent[ConnectionStatusPayload](EventConnectionStatus)
	application.RegisterEvent[resource.WatchStateEvent](EventWatchState)
}

var tracer = otel.Tracer("omniview.resource")

const (
	// relationshipBootstrapTimeout bounds fetching relationship declarations on plugin start.
	relationshipBootstrapTimeout = 30 * time.Second
	// watchStreamReadyTimeout is how long OnPluginStart waits for the watch event stream.
	watchStreamReadyTimeout = 10 * time.Second
	// streamChannelBuffer is the buffer size of action event and connection streams.
	streamChannelBuffer = 16
)

// Controller is the lifecycle + service interface for the resource capability.
type Controller interface {
	plugintypes.LifecycleController
	Run(context.Context)
	Service
	SetCrashCallback(cb func(pluginID string))
	Graph() *graph.RelationshipGraph
}

// pluginState holds per-plugin runtime state.
type pluginState struct {
	provider    ResourceProvider
	version     int
	watchCancel context.CancelFunc
	crashOnce   sync.Once
}

// controller manages resource plugins on the engine side.
type controller struct {
	app              *application.App
	logger           logging.Logger
	settingsProvider pkgsettings.Provider
	emitter          EventEmitter

	// lifecycleMu fences admission against the entire previous generation's
	// retirement. Take it before subordinate state locks; never hold pluginsMu
	// across cancellation, delivery retirement, or registry/graph cleanup.
	lifecycleMu sync.Mutex
	pluginsMu   sync.RWMutex
	plugins     map[string]*pluginState

	connsMu     sync.RWMutex
	connections map[string][]types.Connection

	autoConnectMu       sync.Mutex
	autoConnectAttempts map[string]string

	subs     *subscriptionManager
	boundary *invocation.Boundary
	actions  *actionRegistry

	// Resource registry and relationship graph
	registryStore registry.Store
	dispatcher    *indexer.Dispatcher
	graph         *graph.RelationshipGraph
	graphNotifier *graphChangeNotifier

	onCrashCallback func(pluginID string)
	pluginStoreFn   func(pluginID string) (*appstate.ScopedRoot, error)
	watchAfterFunc  func(time.Duration, func()) actionTimer
}

// compile-time assertions.
var (
	_ Controller = (*controller)(nil)
	_ Service    = (*controller)(nil)
)

// NewController creates a new resource Controller.
// pluginStoreFn returns a ScopedRoot for the given plugin's store directory.
func NewController(
	logger logging.Logger,
	sp pkgsettings.Provider,
	pluginStoreFn func(string) (*appstate.ScopedRoot, error),
	boundary *invocation.Boundary,
) Controller {
	store := registry.NewMemoryStore()
	g := graph.NewRelationshipGraph()
	graphIndexer := graph.NewGraphIndexer(g, store)
	dispatcher := indexer.NewDispatcher([]indexer.ResourceIndexer{graphIndexer})

	c := &controller{
		app:                 nil,
		logger:              logger.Named("ResourceController"),
		settingsProvider:    sp,
		emitter:             nil,
		pluginsMu:           sync.RWMutex{},
		plugins:             make(map[string]*pluginState),
		connsMu:             sync.RWMutex{},
		connections:         make(map[string][]types.Connection),
		autoConnectMu:       sync.Mutex{},
		autoConnectAttempts: make(map[string]string),
		subs:                newSubscriptionManager(),
		boundary:            boundary,
		actions:             newActionRegistry(),
		registryStore:       store,
		dispatcher:          dispatcher,
		graph:               g,
		graphNotifier:       nil,
		onCrashCallback:     nil,
		pluginStoreFn:       pluginStoreFn,
		watchAfterFunc:      func(d time.Duration, fn func()) actionTimer { return time.AfterFunc(d, fn) },
	}
	c.actions.emit = func(id string, snapshot ActionSnapshot) { c.emitter.Emit("action/stream/"+id, snapshot) }
	// Read c.emitter at emit time: it is replaced when the app starts.
	c.graphNotifier = newGraphChangeNotifier(g, func(eventKey string, data ...any) {
		c.emitter.Emit(eventKey, data...)
	}, graphChangeDebounce)
	return c
}

// SetCrashCallback sets the function called when a plugin crash is detected.
func (c *controller) SetCrashCallback(cb func(pluginID string)) {
	c.onCrashCallback = cb
}

// Graph returns the underlying RelationshipGraph for use by external services.
func (c *controller) Graph() *graph.RelationshipGraph {
	return c.graph
}

// ============================================================================
// Plugin Lifecycle
// ============================================================================

// Run starts the controller's background tasks.
// Native lifecycle startup; prefer ServiceStartup for Wails v3.
func (c *controller) Run(_ context.Context) {
	if c.emitter == nil {
		c.emitter = NoopEmitter{}
	}
	c.dispatcher.Start()
	c.graphNotifier.Start()
}

// ServiceStartup is called by the Wails v3 runtime when the application starts.
func (c *controller) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	c.app = application.Get()
	c.emitter = newAppEmitter(c.app)
	c.dispatcher.Start()
	c.graphNotifier.Start()
	return nil
}

// ServiceShutdown is called by the Wails v3 runtime when the application shuts down.
func (c *controller) ServiceShutdown() error {
	c.actions.stopAll()
	c.graphNotifier.Stop()
	c.dispatcher.Stop()
	return nil
}

// dispenseProvider creates a ResourceProvider from a PluginBackend using version negotiation.
func dispenseProvider(pluginID string, backend plugintypes.PluginBackend) (ResourceProvider, int, error) {
	raw, err := backend.Dispense(PluginName)
	if err != nil {
		return nil, 0, err
	}

	version := backend.NegotiatedVersion()
	switch version {
	case 1:
		v1, ok := raw.(resource.Provider)
		if !ok {
			return nil, 0, apperror.New(apperror.TypePluginLoadFailed, http.StatusInternalServerError,
				"Plugin type mismatch",
				fmt.Sprintf("Expected resource.Provider for v1, got %T", raw))
		}
		return NewAdapterV1(v1), version, nil
	default:
		return nil, 0, apperror.New(apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d, engine supports v1", pluginID, version))
	}
}

func (c *controller) OnPluginInit(pluginID string, _ config.PluginMeta) {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginInit")
	c.lifecycleMu.Lock()
	defer c.lifecycleMu.Unlock()

	// Load persisted connections from disk.
	var state map[string][]types.Connection
	if storeRoot, err := c.pluginStoreFn(pluginID); err != nil {
		logger.Errorw(context.Background(), "failed to resolve plugin store root", "error", err)
		state = make(map[string][]types.Connection)
	} else if state, err = loadFromLocalStore(storeRoot); err != nil {
		logger.Errorw(context.Background(), "failed to load connections from local store", "error", err)
		state = make(map[string][]types.Connection)
	}

	c.connsMu.Lock()
	for k, v := range state {
		c.connections[k] = v
	}
	if _, ok := c.connections[pluginID]; !ok {
		c.connections[pluginID] = make([]types.Connection, 0)
	}
	c.connsMu.Unlock()
}

func (c *controller) OnPluginStart(pluginID string, _ config.PluginMeta, backend plugintypes.PluginBackend) (retErr error) {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginStart")

	provider, version, err := dispenseProvider(pluginID, backend)
	if err != nil {
		return err
	}
	c.lifecycleMu.Lock()
	c.actions.stopPlugin(pluginID)
	c.actions.startPlugin(pluginID)

	watchCtx, watchCancel := context.WithCancel(context.Background())

	state := &pluginState{
		version: version, watchCancel: watchCancel,
	}
	c.pluginsMu.Lock()
	existing := c.plugins[pluginID]
	c.plugins[pluginID] = state
	c.pluginsMu.Unlock()
	if existing != nil {
		existing.watchCancel()
	}
	defer func() {
		if retErr == nil {
			return
		}
		watchCancel()
		c.lifecycleMu.Lock()
		defer c.lifecycleMu.Unlock()
		c.pluginsMu.Lock()
		owned := c.plugins[pluginID] == state
		if owned {
			// Retain generation ownership until all of its state is retired.
			state.provider = nil
		}
		c.pluginsMu.Unlock()
		if !owned {
			return
		}
		c.actions.stopPlugin(pluginID)
		// Normal failed-plugin stop must still persist its saved configuration.
		c.connsMu.RLock()
		conns := append([]types.Connection(nil), c.connections[pluginID]...)
		c.connsMu.RUnlock()
		c.clearAutoConnectAttempts(pluginID)
		c.subs.RemoveAll(pluginID)
		c.cleanupPluginGraphState(pluginID, conns)
		c.pluginsMu.Lock()
		delete(c.plugins, pluginID)
		c.pluginsMu.Unlock()
	}()
	c.clearAutoConnectAttempts(pluginID)

	// Clean up stale registry/graph state from the previous plugin instance.
	c.connsMu.RLock()
	prevConns := append([]types.Connection(nil), c.connections[pluginID]...)
	c.connsMu.RUnlock()
	if len(prevConns) > 0 {
		c.cleanupPluginGraphState(pluginID, prevConns)
	}
	c.lifecycleMu.Unlock()

	// Start watch event listener (uses WatchEventSink callback pattern).
	sink := &engineWatchSink{
		pluginID:   pluginID,
		ctrl:       c,
		store:      c.registryStore,
		dispatcher: c.dispatcher,
	}
	watchReady := make(chan error, 1)
	go c.listenForWatchEvents(watchCtx, pluginID, provider, sink, watchReady)

	// Only the provider's actual registration acknowledgement admits sources.
	expired := make(chan struct{})
	timer := c.watchAfterFunc(watchStreamReadyTimeout, func() { close(expired) })
	defer timer.Stop()
	select {
	case err := <-watchReady:
		if err != nil {
			return fmt.Errorf("watch event stream startup: %w", err)
		}
		logger.Debugw(context.Background(), "watch event stream established")
	case <-watchCtx.Done():
		return watchCtx.Err()
	case <-expired:
		return fmt.Errorf("watch event stream startup: %w", context.DeadlineExceeded)
	}
	c.pluginsMu.Lock()
	if c.plugins[pluginID] != state || watchCtx.Err() != nil {
		c.pluginsMu.Unlock()
		return context.Canceled
	}
	// Keep concurrent resource calls from starting sources during registration.
	state.provider = provider
	c.pluginsMu.Unlock()

	// Load connections from the plugin.
	if conns, loadErr := c.LoadConnections(invocation.HostContext(watchCtx), pluginID); loadErr != nil {
		logger.Errorw(context.Background(), "failed to load connections from plugin", "error", loadErr)
	} else if len(conns) > 0 {
		eventKey := pluginID + "/connection/sync"
		c.emitter.Emit(eventKey, c.getConnections(pluginID))
		c.scheduleAutoConnect(pluginID, conns, types.ConnectionAutoConnectTriggerPluginStart)
	}

	// Bootstrap relationship declarations for the graph indexer.
	bootstrapCtx, bootstrapCancel := context.WithTimeout(watchCtx, relationshipBootstrapTimeout)
	defer bootstrapCancel()
	if resourceTypes, discoveryErr := provider.GetResourceTypes(bootstrapCtx, ""); discoveryErr == nil {
		for rk := range resourceTypes {
			decls, relErr := provider.GetRelationships(bootstrapCtx, rk)
			if relErr != nil {
				logger.Warnw(bootstrapCtx, "failed to get relationships", "resourceKey", rk, "error", relErr)
				continue
			}
			if len(decls) > 0 {
				c.graph.SetDeclarations(pluginID, rk, decls)
				logger.Debugw(bootstrapCtx, "cached relationship declarations", "resourceKey", rk, "count", len(decls))
			}
		}
	}

	// Start connection watcher.
	go c.listenForConnectionEvents(watchCtx, pluginID, provider)

	return watchCtx.Err()
}

func (c *controller) OnPluginStop(pluginID string, _ config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginStop")
	c.lifecycleMu.Lock()
	defer c.lifecycleMu.Unlock()
	c.actions.stopPlugin(pluginID)

	// Persist only this plugin's connections.
	c.connsMu.RLock()
	pluginConnsForPersist := make(map[string][]types.Connection, 1)
	if pcs, ok := c.connections[pluginID]; ok {
		pluginConnsForPersist[pluginID] = pcs
	}
	c.connsMu.RUnlock()
	if storeRoot, err := c.pluginStoreFn(pluginID); err != nil {
		logger.Errorw(context.Background(), "failed to resolve plugin store root", "error", err)
	} else if err = saveToLocalStore(storeRoot, pluginConnsForPersist); err != nil {
		logger.Errorw(context.Background(), "failed to save connections to local store", "error", err)
	}

	// Cancel watch goroutines.
	c.pluginsMu.RLock()
	stopped := c.plugins[pluginID]
	c.pluginsMu.RUnlock()
	if stopped != nil {
		stopped.watchCancel()
	}
	// Cancel first so a concurrent readiness acknowledgement cannot republish
	// the retiring provider after invalidation.
	c.pluginsMu.Lock()
	// Make calls unavailable now; release ownership only after retirement.
	if stopped != nil {
		stopped.provider = nil
	}
	c.pluginsMu.Unlock()

	// Capture connections before deleting them — needed for registry cleanup.
	c.connsMu.RLock()
	pluginConns := append([]types.Connection(nil), c.connections[pluginID]...)
	c.connsMu.RUnlock()

	c.connsMu.Lock()
	delete(c.connections, pluginID)
	c.connsMu.Unlock()
	c.clearAutoConnectAttempts(pluginID)

	c.subs.RemoveAll(pluginID)

	c.cleanupPluginGraphState(pluginID, pluginConns)
	c.pluginsMu.Lock()
	delete(c.plugins, pluginID)
	c.pluginsMu.Unlock()

	return nil
}

// cleanupPluginGraphState removes registry entries, graph edges, and
// declarations for the given plugin and its connections. Called during both
// plugin stop and plugin restart (to avoid stale state leaking into the
// replacement).
func (c *controller) cleanupPluginGraphState(pluginID string, conns []types.Connection) {
	for _, conn := range conns {
		removed := c.registryStore.DeleteByConnection(pluginID, conn.ID)
		for _, entry := range removed {
			c.dispatcher.Enqueue(indexer.Event{
				Type:  indexer.EventDelete,
				Entry: entry,
				Old:   nil,
				Raw:   nil,
			})
		}
		c.graph.RemoveEdgesForConnection(pluginID, conn.ID)
	}
	c.graph.ClearDeclarationsForPlugin(pluginID)
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	return c.OnPluginStop(pluginID, meta)
}

func (c *controller) OnPluginDestroy(pluginID string, _ config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginDestroy")
	if storeRoot, err := c.pluginStoreFn(pluginID); err != nil {
		logger.Errorw(context.Background(), "failed to resolve plugin store root", "error", err)
	} else if err = removeLocalStore(storeRoot); err != nil {
		logger.Errorw(context.Background(), "failed to remove local store", "error", err)
	}
	return nil
}

func (c *controller) ListPlugins(ctx context.Context) (_result []string, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.ListPlugins", invocation.Target{})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	plugins := make([]string, 0, len(c.plugins))
	for id := range c.plugins {
		plugins = append(plugins, id)
	}
	return plugins, nil

}

func (c *controller) HasPlugin(ctx context.Context, pluginID string) (_result bool, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.HasPlugin", invocation.Target{Provider: pluginID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	ps, ok := c.plugins[pluginID]
	return ok && ps.provider != nil, nil

}

// ============================================================================
// Provider Access
// ============================================================================

func (c *controller) getProvider(pluginID string) (ResourceProvider, error) {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	ps, ok := c.plugins[pluginID]
	if !ok || ps.provider == nil {
		return nil, apperror.PluginNotFound(pluginID)
	}
	return ps.provider, nil
}

// withSession returns the provider and a context with session info for connection-scoped calls.
// The parent context is preserved so that span context propagates to gRPC calls.
func (c *controller) withSession(
	ctx context.Context,
	pluginID, connectionID string,
) (ResourceProvider, context.Context, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, nil, err
	}
	request, _ := invocation.FromContext(ctx)
	ctx = resource.WithSession(ctx, &resource.Session{
		Connection:   &types.Connection{ID: connectionID},
		PluginConfig: nil,
		GlobalConfig: nil,
		RequestID:    request.ID(),
		RequesterID:  string(request.Principal().Origin()),
	})
	return provider, ctx, nil
}

// ============================================================================
// CRUD
// ============================================================================

// startResourceSpan starts a span for a resource-scoped call and tags it with
// the plugin, connection and resource key.
func startResourceSpan(ctx context.Context, name, pluginID, connectionID, key string) (context.Context, trace.Span) {
	ctx, span := tracer.Start(ctx, name)
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
		attribute.String("resource_key", key),
	)
	return ctx, span
}

// rpcFailed records and logs a failed resource RPC, checks it for connection
// errors, and returns it converted to an AppError.
func (c *controller) rpcFailed(ctx context.Context, span trace.Span, op, pluginID, key string, err error) error {
	telemetryutil.RecordError(span, err)
	c.logger.Errorw(ctx, "RPC failed", "op", op, "pluginID", pluginID, "key", key, "error", err)
	c.checkConnectionError(pluginID, err)
	return err
}

func (c *controller) Get(ctx context.Context, pluginID, connectionID, key string, input resource.GetInput) (_result *resource.GetResult, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.Get", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key, Scope: namespaceScope(input.Namespace), Object: input.ID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.Get", pluginID, connectionID, key)
	defer span.End()
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Get(ctx, key, input)
	if err != nil {
		return nil, c.rpcFailed(ctx, span, "Get", pluginID, key, err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if result != nil && len(result.Result) > 0 {
		c.observeResponse(pluginID, connectionID, key, input.ID, input.Namespace, result.Result)
	}
	return result, nil

}

func (c *controller) List(ctx context.Context, pluginID, connectionID, key string, input resource.ListInput) (_result *resource.ListResult, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.List", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key, Scope: namespaceScope(input.Namespaces...)})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.List", pluginID, connectionID, key)
	defer span.End()
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.List(ctx, key, input)
	if err != nil {
		return nil, c.rpcFailed(ctx, span, "List", pluginID, key, err)
	}
	return result, nil

}

func (c *controller) Find(ctx context.Context, pluginID, connectionID, key string, input resource.FindInput) (_result *resource.FindResult, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.Find", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key, Scope: namespaceScope(input.Namespaces...)})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.Find", pluginID, connectionID, key)
	defer span.End()
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Find(ctx, key, input)
	if err != nil {
		return nil, c.rpcFailed(ctx, span, "Find", pluginID, key, err)
	}
	return result, nil

}

func (c *controller) Create(ctx context.Context, pluginID, connectionID, key string, input resource.CreateInput) (_result *resource.CreateResult, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.Create", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key, Scope: namespaceScope(input.Namespace)})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.Create", pluginID, connectionID, key)
	defer span.End()
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Create(ctx, key, input)
	if err != nil {
		return nil, c.rpcFailed(ctx, span, "Create", pluginID, key, err)
	}
	return result, nil

}

func (c *controller) Update(ctx context.Context, pluginID, connectionID, key string, input resource.UpdateInput) (_result *resource.UpdateResult, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.Update", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key, Scope: namespaceScope(input.Namespace), Object: input.ID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.Update", pluginID, connectionID, key)
	defer span.End()
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Update(ctx, key, input)
	if err != nil {
		return nil, c.rpcFailed(ctx, span, "Update", pluginID, key, err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if result != nil && len(result.Result) > 0 {
		c.observeResponse(pluginID, connectionID, key, input.ID, input.Namespace, result.Result)
	}
	return result, nil

}

func (c *controller) Delete(ctx context.Context, pluginID, connectionID, key string, input resource.DeleteInput) (_result *resource.DeleteResult, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.Delete", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key, Scope: namespaceScope(input.Namespace), Object: input.ID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.Delete", pluginID, connectionID, key)
	defer span.End()
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Delete(ctx, key, input)
	if err != nil {
		return nil, c.rpcFailed(ctx, span, "Delete", pluginID, key, err)
	}
	return result, nil

}

// ============================================================================
// Connection Management
// ============================================================================

func (c *controller) getConnections(pluginID string) []types.Connection {
	c.connsMu.RLock()
	defer c.connsMu.RUnlock()
	return c.connections[pluginID]
}

func (c *controller) StartConnection(ctx context.Context, pluginID, connectionID string) (_result types.ConnectionStatus, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.StartConnection", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.StartConnection")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return types.ConnectionStatus{}, err
	}

	conn, err := provider.StartConnection(ctx, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return types.ConnectionStatus{}, err
	}

	if conn.Status == types.ConnectionStatusConnected && conn.Connection != nil {
		// Stamp the refresh time so the frontend TTL check reflects the real state.
		conn.Connection.LastRefresh = time.Now()
		if conn.Connection.ExpiryTime == 0 {
			conn.Connection.ExpiryTime = types.ConnectionDefaultExpiryTime
		}
		c.connsMu.Lock()
		c.connections[pluginID] = mergeConnections(c.connections[pluginID], []types.Connection{*conn.Connection})
		c.connsMu.Unlock()
	}

	connName := connectionID
	if conn.Connection != nil && conn.Connection.Name != "" {
		connName = conn.Connection.Name
	}
	c.emitter.Emit(EventConnectionStatus, ConnectionStatusPayload{
		PluginID:     pluginID,
		ConnectionID: connectionID,
		Status:       string(conn.Status),
		Name:         connName,
	})

	return conn, nil

}

func (c *controller) StopConnection(ctx context.Context, pluginID, connectionID string) (_result types.Connection, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.StopConnection", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.StopConnection")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return types.Connection{}, err
	}

	conn, err := provider.StopConnection(ctx, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return types.Connection{}, err
	}

	// Clear LastRefresh so the frontend TTL check shows disconnected.
	conn.LastRefresh = time.Time{}
	c.connsMu.Lock()
	c.connections[pluginID] = mergeConnections(c.connections[pluginID], []types.Connection{conn})
	c.connsMu.Unlock()

	c.emitter.Emit(EventConnectionStatus, ConnectionStatusPayload{
		PluginID:     pluginID,
		ConnectionID: connectionID,
		Status:       "DISCONNECTED",
		Name:         conn.Name,
	})

	return conn, nil

}

func (c *controller) CheckConnection(ctx context.Context, pluginID, connectionID string) (_result types.ConnectionStatus, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.CheckConnection", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.CheckConnection")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return types.ConnectionStatus{}, err
	}

	status, err := provider.CheckConnection(ctx, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(
			ctx,
			"RPC failed",
			"op",
			"CheckConnection",
			"pluginID",
			pluginID,
			"connectionID",
			connectionID,
			"error",
			err,
		)
		c.checkConnectionError(pluginID, err)
		return types.ConnectionStatus{}, err
	}
	return status, nil

}

func (c *controller) LoadConnections(ctx context.Context, pluginID string) (_result []types.Connection, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.LoadConnections", invocation.Target{Provider: pluginID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.LoadConnections")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}

	conns, err := provider.LoadConnections(ctx)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}

	c.connsMu.Lock()
	c.connections[pluginID] = mergeConnections(c.connections[pluginID], conns)
	c.connsMu.Unlock()

	// Best-effort persist — only this plugin's connections.
	if storeRoot, storeErr := c.pluginStoreFn(pluginID); storeErr == nil {
		c.connsMu.RLock()
		pluginConns := make(map[string][]types.Connection, 1)
		if pcs, ok := c.connections[pluginID]; ok {
			pluginConns[pluginID] = pcs
		}
		c.connsMu.RUnlock()
		_ = saveToLocalStore(storeRoot, pluginConns)
	}

	return conns, nil

}

func (c *controller) ListConnections(ctx context.Context, pluginID string) (_result []types.Connection, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.ListConnections", invocation.Target{Provider: pluginID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.connsMu.RLock()
	src, ok := c.connections[pluginID]
	if !ok {
		c.connsMu.RUnlock()
		return nil, apperror.New(apperror.TypeConnectionNotFound, http.StatusNotFound,
			"No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	conns := make([]types.Connection, len(src))
	copy(conns, src)
	c.connsMu.RUnlock()
	slices.SortFunc(conns, func(a, b types.Connection) int {
		return cmp.Compare(a.Name, b.Name)
	})
	return conns, nil

}

func (c *controller) ListAllConnections(ctx context.Context) (_result map[string][]types.Connection, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.ListAllConnections", invocation.Target{})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.connsMu.RLock()
	defer c.connsMu.RUnlock()
	// Return a deep copy (map + slices) to avoid races.
	result := make(map[string][]types.Connection, len(c.connections))
	for k, v := range c.connections {
		cp := make([]types.Connection, len(v))
		copy(cp, v)
		result[k] = cp
	}
	return result, nil

}

func (c *controller) GetAllConnectionStates(ctx context.Context) (_result map[string][]ConnectionState, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetAllConnectionStates", invocation.Target{})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.connsMu.RLock()
	connsCopy := make(map[string][]types.Connection, len(c.connections))
	for k, v := range c.connections {
		cp := make([]types.Connection, len(v))
		copy(cp, v)
		connsCopy[k] = cp
	}
	c.connsMu.RUnlock()

	result := make(map[string][]ConnectionState, len(connsCopy))

	for pluginID, conns := range connsCopy {
		states := make([]ConnectionState, 0, len(conns))

		for _, conn := range conns {
			cs := ConnectionState{
				Connection:     conn,
				Started:        false,
				Resources:      make(map[string]resource.WatchState),
				ResourceCounts: make(map[string]int),
				TotalResources: 0,
				SyncedCount:    0,
				ErrorCount:     0,
				LastSyncTime:   "",
			}

			// An absent watch represents an unstarted connection, not a failed read.
			summary, err := c.GetWatchState(ctx, pluginID, conn.ID)
			if err != nil {
				var app *apperror.AppError
				if !errors.As(err, &app) || app.Code != "NOT_FOUND" || app.Type != apperror.TypeResourceNotFound {
					return nil, err
				}
			}
			if err == nil && summary != nil && len(summary.Resources) > 0 {
				cs.Started = true
				cs.Resources = summary.Resources
				cs.ResourceCounts = summary.ResourceCounts

				for _, state := range summary.Resources {
					cs.TotalResources++
					switch state {
					case resource.WatchStateSynced:
						cs.SyncedCount++
					case resource.WatchStateError, resource.WatchStateFailed:
						cs.ErrorCount++
					case resource.WatchStateIdle, resource.WatchStateSyncing, resource.WatchStateStopped,
						resource.WatchStateForbidden, resource.WatchStateSkipped:
						// Neither synced nor failed; only counted in TotalResources.
					}
				}
			}

			states = append(states, cs)
		}

		result[pluginID] = states
	}

	return result, nil

}

func (c *controller) GetConnection(ctx context.Context, pluginID, connectionID string) (_result types.Connection, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetConnection", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.connsMu.RLock()
	conns, ok := c.connections[pluginID]
	c.connsMu.RUnlock()
	if !ok {
		return types.Connection{}, apperror.New(apperror.TypeConnectionNotFound, http.StatusNotFound,
			"No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	for _, conn := range conns {
		if conn.ID == connectionID {
			return conn, nil
		}
	}
	return types.Connection{}, apperror.ConnectionNotFound(pluginID, connectionID)

}

func (c *controller) GetConnectionNamespaces(ctx context.Context, pluginID, connectionID string) (_result []string, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetConnectionNamespaces", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetConnectionNamespaces")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetConnectionNamespaces(ctx, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

func (c *controller) AddConnection(ctx context.Context, pluginID string, connection types.Connection) (retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.AddConnection", invocation.Target{Provider: pluginID, Connection: connection.ID})
	if admissionErr != nil {
		return admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.connsMu.Lock()
	c.connections[pluginID] = append(c.connections[pluginID], connection)
	c.connsMu.Unlock()
	return nil

}

func (c *controller) UpdateConnection(ctx context.Context, pluginID string, connection types.Connection) (_result types.Connection, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.UpdateConnection", invocation.Target{Provider: pluginID, Connection: connection.ID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.connsMu.Lock()
	defer c.connsMu.Unlock()
	conns, ok := c.connections[pluginID]
	if !ok {
		return types.Connection{}, apperror.New(apperror.TypeConnectionNotFound, http.StatusNotFound,
			"No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	for i, conn := range conns {
		if conn.ID == connection.ID {
			conns[i] = connection
			return connection, nil
		}
	}
	return types.Connection{}, apperror.ConnectionNotFound(pluginID, connection.ID)

}

func (c *controller) RemoveConnection(ctx context.Context, pluginID, connectionID string) (retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.RemoveConnection", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.connsMu.Lock()
	defer c.connsMu.Unlock()
	conns, ok := c.connections[pluginID]
	if !ok {
		return apperror.New(apperror.TypeConnectionNotFound, http.StatusNotFound,
			"No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	for i, conn := range conns {
		if conn.ID == connectionID {
			c.connections[pluginID] = slices.Delete(conns, i, i+1)
			return nil
		}
	}
	return apperror.ConnectionNotFound(pluginID, connectionID)

}

// ============================================================================
// Watch
// ============================================================================

func (c *controller) StartConnectionWatch(ctx context.Context, pluginID, connectionID string) (retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.StartConnectionWatch", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.StartConnectionWatch")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err = provider.StartConnectionWatch(ctx, connectionID); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil

}

func (c *controller) StopConnectionWatch(ctx context.Context, pluginID, connectionID string) (retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.StopConnectionWatch", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.StopConnectionWatch")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err = provider.StopConnectionWatch(ctx, connectionID); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil

}

func (c *controller) GetWatchState(ctx context.Context, pluginID, connectionID string) (_result *resource.WatchConnectionSummary, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetWatchState", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetWatchState")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	summary, err := provider.GetWatchState(ctx, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	var nonIdle int
	for key, state := range summary.Resources {
		if state != resource.WatchStateIdle {
			nonIdle++
			c.logger.Debugw(ctx, "[watch-state] GetWatchState non-idle",
				"pluginID", pluginID, "connectionID", connectionID,
				"key", key, "state", state,
			)
		}
	}
	c.logger.Infow(ctx, "[watch-state] GetWatchState response",
		"pluginID", pluginID, "connectionID", connectionID,
		"totalResources", len(summary.Resources), "nonIdle", nonIdle,
	)
	return summary, nil

}

func (c *controller) EnsureResourceWatch(ctx context.Context, pluginID, connectionID, resourceKey string) (retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.EnsureResourceWatch", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: resourceKey})
	if admissionErr != nil {
		return admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.EnsureResourceWatch")
	defer span.End()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
		attribute.String("resource_key", resourceKey),
	)
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err = provider.EnsureResourceWatch(ctx, connectionID, resourceKey); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil

}

func (c *controller) StopResourceWatch(ctx context.Context, pluginID, connectionID, resourceKey string) (retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.StopResourceWatch", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: resourceKey})
	if admissionErr != nil {
		return admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.StopResourceWatch")
	defer span.End()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
		attribute.String("resource_key", resourceKey),
	)
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err = provider.StopResourceWatch(ctx, connectionID, resourceKey); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil

}

func (c *controller) RestartResourceWatch(ctx context.Context, pluginID, connectionID, resourceKey string) (retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.RestartResourceWatch", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: resourceKey})
	if admissionErr != nil {
		return admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.RestartResourceWatch")
	defer span.End()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
		attribute.String("resource_key", resourceKey),
	)
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err = provider.RestartResourceWatch(ctx, connectionID, resourceKey); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil

}

func (c *controller) IsResourceWatchRunning(ctx context.Context, pluginID, connectionID, resourceKey string) (_result bool, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.IsResourceWatchRunning", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: resourceKey})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.IsResourceWatchRunning")
	defer span.End()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
		attribute.String("resource_key", resourceKey),
	)
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return false, err
	}
	result, err := provider.IsResourceWatchRunning(ctx, connectionID, resourceKey)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return false, err
	}
	return result, nil

}

// ============================================================================
// Subscriptions
// ============================================================================

func (c *controller) SubscribeResource(ctx context.Context, pluginID, connectionID, resourceKey string) (retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.SubscribeResource", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: resourceKey})
	if admissionErr != nil {
		return admissionErr
	}
	defer finishResource(ctx, &retErr)
	count := c.subs.Subscribe(pluginID, connectionID, resourceKey)
	c.logger.Debugw(context.Background(), "resource subscribed",
		"key", subscriptionKey(pluginID, connectionID, resourceKey), "refcount", count)
	return nil

}

func (c *controller) UnsubscribeResource(ctx context.Context, pluginID, connectionID, resourceKey string) (retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.UnsubscribeResource", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: resourceKey})
	if admissionErr != nil {
		return admissionErr
	}
	defer finishResource(ctx, &retErr)
	count := c.subs.Unsubscribe(pluginID, connectionID, resourceKey)
	c.logger.Debugw(context.Background(), "resource unsubscribed",
		"key", subscriptionKey(pluginID, connectionID, resourceKey), "refcount", count)
	return nil

}

func (c *controller) isSubscribed(pluginID, connectionID, resourceKey string) bool {
	return c.subs.IsSubscribed(pluginID, connectionID, resourceKey)
}

// ============================================================================
// Type Metadata
// ============================================================================

func (c *controller) GetResourceGroups(ctx context.Context, pluginID, connectionID string) (_result map[string]resource.ResourceGroup, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetResourceGroups", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetResourceGroups")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return provider.GetResourceGroups(ctx, connectionID)

}

func (c *controller) GetResourceGroup(ctx context.Context, pluginID, groupID string) (_result resource.ResourceGroup, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetResourceGroup", invocation.Target{Provider: pluginID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetResourceGroup")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("group_id", groupID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return resource.ResourceGroup{}, err
	}
	result, err := provider.GetResourceGroup(ctx, groupID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return resource.ResourceGroup{}, err
	}
	return result, nil

}

func (c *controller) GetResourceTypes(ctx context.Context, pluginID, connectionID string) (_result map[string]resource.ResourceMeta, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetResourceTypes", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetResourceTypes")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return provider.GetResourceTypes(ctx, connectionID)

}

func (c *controller) GetResourceType(ctx context.Context, pluginID, typeID string) (_result *resource.ResourceMeta, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetResourceType", invocation.Target{Provider: pluginID, ResourceType: typeID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetResourceType")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("type_id", typeID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetResourceType(ctx, typeID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

func (c *controller) HasResourceType(ctx context.Context, pluginID, typeID string) (_result bool, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.HasResourceType", invocation.Target{Provider: pluginID, ResourceType: typeID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.HasResourceType")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("type_id", typeID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return false, err
	}
	return provider.HasResourceType(ctx, typeID)

}

func (c *controller) GetResourceDefinition(ctx context.Context, pluginID, typeID string) (_result resource.ResourceDefinition, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetResourceDefinition", invocation.Target{Provider: pluginID, ResourceType: typeID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetResourceDefinition")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("type_id", typeID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return resource.ResourceDefinition{}, err
	}
	result, err := provider.GetResourceDefinition(ctx, typeID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return resource.ResourceDefinition{}, err
	}
	return result, nil

}

func (c *controller) GetResourceCapabilities(ctx context.Context, pluginID, key string) (_result *resource.ResourceCapabilities, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetResourceCapabilities", invocation.Target{Provider: pluginID, ResourceType: key})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetResourceCapabilities")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("resource_key", key))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetResourceCapabilities(ctx, key)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

func (c *controller) GetFilterFields(ctx context.Context, pluginID, connectionID, key string) (_result []resource.FilterField, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetFilterFields", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.GetFilterFields", pluginID, connectionID, key)
	defer span.End()
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetFilterFields(ctx, connectionID, key)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

func (c *controller) GetResourceSchema(ctx context.Context, pluginID, connectionID, key string) (_result json.RawMessage, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetResourceSchema", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.GetResourceSchema", pluginID, connectionID, key)
	defer span.End()
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetResourceSchema(ctx, connectionID, key)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

// ============================================================================
// Actions
// ============================================================================

func (c *controller) GetActions(ctx context.Context, pluginID, connectionID, key string) (_result []resource.ActionDescriptor, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetActions", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.GetActions", pluginID, connectionID, key)
	defer span.End()
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetActions(ctx, key)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

func (c *controller) ExecuteAction(ctx context.Context, pluginID, connectionID, key, actionID string, input resource.ActionInput) (_result *resource.ActionResult, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.ExecuteAction", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key, Action: actionID, Scope: namespaceScope(input.Namespace), Object: input.ID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.ExecuteAction")
	defer span.End()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
		attribute.String("resource_key", key),
		attribute.String("action_id", actionID),
	)
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.ExecuteAction(ctx, key, actionID, input)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(ctx, "RPC failed", "op", "ExecuteAction", "pluginID", pluginID,
			"key", key, "actionID", actionID, "error", err)
		return nil, err
	}
	return result, nil

}

// ============================================================================
// Editor Schemas
// ============================================================================

func (c *controller) GetEditorSchemas(ctx context.Context, pluginID, connectionID string) (_result []resource.EditorSchema, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetEditorSchemas", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetEditorSchemas")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetEditorSchemas(ctx, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

// ============================================================================
// Relationships
// ============================================================================

func (c *controller) GetRelationships(ctx context.Context, pluginID, key string) (_result []resource.RelationshipDescriptor, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetRelationships", invocation.Target{Provider: pluginID, ResourceType: key})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.GetRelationships")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("resource_key", key))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetRelationships(ctx, key)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

func (c *controller) ResolveRelationships(ctx context.Context, pluginID, connectionID, key, id, namespace string) (_result []resource.ResolvedRelationship, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.ResolveRelationships", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key, Object: id, Scope: namespaceScope(namespace)})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.ResolveRelationships", pluginID, connectionID, key)
	defer span.End()
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.ResolveRelationships(ctx, connectionID, key, id, namespace)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

// ============================================================================
// Health
// ============================================================================

func (c *controller) GetHealth(ctx context.Context, pluginID, connectionID, key string, data json.RawMessage) (_result *resource.ResourceHealth, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetHealth", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.GetHealth", pluginID, connectionID, key)
	defer span.End()
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetHealth(ctx, connectionID, key, data)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

func (c *controller) GetResourceEvents(ctx context.Context, pluginID, connectionID, key, id, namespace string, limit int32) (_result []resource.ResourceEvent, retErr error) {
	ctx, admissionErr := c.admit(ctx, "resource.GetResourceEvents", invocation.Target{Provider: pluginID, Connection: connectionID, ResourceType: key, Object: id, Scope: namespaceScope(namespace)})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := startResourceSpan(ctx, "resource.GetResourceEvents", pluginID, connectionID, key)
	defer span.End()
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.GetResourceEvents(ctx, connectionID, key, id, namespace, limit)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil

}

// ============================================================================
// Background Listeners
// ============================================================================

// listenForWatchEvents runs ListenForEvents with the engine sink.
// Blocks until ctx is cancelled or the stream errors.
// Reports readiness only after the provider acknowledges actual registration.
//
// NOTE: No span wraps this method — it runs for the entire plugin lifetime.
// The underlying gRPC stream gets its own otelgrpc span; individual watch
// events are too high-volume to trace individually.
func (c *controller) listenForWatchEvents(
	ctx context.Context,
	pluginID string,
	provider ResourceProvider,
	sink resource.WatchEventSink,
	ready chan<- error,
) {
	c.logger.Infow(ctx, "watch event listener starting", "pluginID", pluginID)
	registered := false
	err := provider.ListenForEvents(ctx, sink, func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		registered = true
		ready <- nil
		return nil
	})
	if !registered {
		if err == nil {
			err = fmt.Errorf("watch event listener returned before registration")
		}
		ready <- err
	} else if err != nil && ctx.Err() == nil {
		c.triggerCrashRecovery(pluginID, err, "watch")
	}
	c.logger.Infow(ctx, "watch event listener stopped", "pluginID", pluginID)
}

// listenForConnectionEvents watches for external connection changes.
//
// NOTE: No span wraps the entire stream — it runs for the plugin lifetime.
// Instead, each batch of received connections gets a short-lived span so
// that connection discovery is observable without bloating Tempo.
func (c *controller) listenForConnectionEvents(ctx context.Context, pluginID string, provider ResourceProvider) {
	c.logger.Infow(ctx, "connection event listener started", "pluginID", pluginID)
	connStream := make(chan []types.Connection, streamChannelBuffer)

	errCh := make(chan error, 1)
	go func() {
		errCh <- provider.WatchConnections(ctx, connStream)
	}()

	for {
		select {
		case <-ctx.Done():
			c.logger.Infow(ctx, "connection event listener stopped", "pluginID", pluginID, "reason", "shutdown")
			return
		case err := <-errCh:
			if err != nil && ctx.Err() == nil {
				c.triggerCrashRecovery(pluginID, err, "connection")
			}
			return
		case conns, ok := <-connStream:
			if !ok {
				return
			}
			_, span := tracer.Start(ctx, "resource.ConnectionSync",
				trace.WithAttributes(
					attribute.String("plugin_id", pluginID),
					attribute.Int("connection_count", len(conns)),
				))
			c.connsMu.Lock()
			c.connections[pluginID] = mergeConnections(c.connections[pluginID], conns)
			c.connsMu.Unlock()

			eventKey := pluginID + "/connection/sync"
			c.emitter.Emit(eventKey, conns)
			c.scheduleAutoConnect(pluginID, conns, types.ConnectionAutoConnectTriggerConnectionDiscovered)
			span.End()
		}
	}
}

func (c *controller) scheduleAutoConnect(
	pluginID string,
	conns []types.Connection,
	trigger types.ConnectionAutoConnectTrigger,
) {
	for _, conn := range conns {
		conn := conn
		auto := conn.Lifecycle.AutoConnect
		if auto == nil {
			continue
		}
		if !auto.Enabled {
			continue
		}
		if !containsAutoConnectTrigger(auto.Triggers, trigger) {
			continue
		}

		signature := autoConnectConnectionSignature(conn)
		if !c.shouldAttemptAutoConnect(pluginID, conn.ID, signature, auto.Retry) {
			continue
		}

		go func() {
			c.logger.Infow(context.Background(), "auto-connect attempt starting",
				"pluginID", pluginID,
				"connectionID", conn.ID,
				"trigger", string(trigger),
			)

			status, err := c.StartConnection(invocation.HostContext(context.Background()), pluginID, conn.ID)
			if err != nil {
				c.logger.Warnw(context.Background(), "auto-connect attempt failed",
					"pluginID", pluginID,
					"connectionID", conn.ID,
					"trigger", string(trigger),
					"error", err,
				)
				return
			}
			if status.Status != types.ConnectionStatusConnected {
				c.logger.Warnw(context.Background(), "auto-connect attempt did not connect",
					"pluginID", pluginID,
					"connectionID", conn.ID,
					"trigger", string(trigger),
					"status", string(status.Status),
					"details", status.Details,
					"error", status.Error,
				)
				return
			}
			c.logger.Infow(context.Background(), "auto-connect attempt succeeded",
				"pluginID", pluginID,
				"connectionID", conn.ID,
				"trigger", string(trigger),
			)

			// Start watches for the newly connected connection so resource
			// syncing begins automatically (especially important after crash recovery).
			if err = c.StartConnectionWatch(invocation.HostContext(context.Background()), pluginID, conn.ID); err != nil {
				c.logger.Warnw(context.Background(), "auto-connect: failed to start connection watch",
					"pluginID", pluginID,
					"connectionID", conn.ID,
					"error", err,
				)
			}
		}()
	}
}

func (c *controller) shouldAttemptAutoConnect(
	pluginID string,
	connectionID string,
	signature string,
	retry types.ConnectionAutoConnectRetry,
) bool {
	c.autoConnectMu.Lock()
	defer c.autoConnectMu.Unlock()

	if retry == "" {
		retry = types.ConnectionAutoConnectRetryNone
	}

	key := pluginID + "::" + connectionID
	prevSig, ok := c.autoConnectAttempts[key]

	switch retry {
	case types.ConnectionAutoConnectRetryOnChange:
		if ok && prevSig == signature {
			return false
		}
	case types.ConnectionAutoConnectRetryNone:
		fallthrough
	default:
		if ok {
			return false
		}
	}

	c.autoConnectAttempts[key] = signature
	return true
}

func (c *controller) clearAutoConnectAttempts(pluginID string) {
	prefix := pluginID + "::"
	c.autoConnectMu.Lock()
	defer c.autoConnectMu.Unlock()
	for key := range c.autoConnectAttempts {
		if strings.HasPrefix(key, prefix) {
			delete(c.autoConnectAttempts, key)
		}
	}
}

func containsAutoConnectTrigger(
	triggers []types.ConnectionAutoConnectTrigger,
	trigger types.ConnectionAutoConnectTrigger,
) bool {
	for _, t := range triggers {
		if t == trigger {
			return true
		}
	}
	return false
}

func autoConnectConnectionSignature(conn types.Connection) string {
	payload := struct {
		Name        string                    `json:"name"`
		Description string                    `json:"description"`
		Avatar      string                    `json:"avatar"`
		Data        map[string]any            `json:"data"`
		Labels      map[string]any            `json:"labels"`
		Lifecycle   types.ConnectionLifecycle `json:"lifecycle"`
	}{
		Name:        conn.Name,
		Description: conn.Description,
		Avatar:      conn.Avatar,
		Data:        conn.Data,
		Labels:      conn.Labels,
		Lifecycle:   conn.Lifecycle,
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return conn.ID
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// ============================================================================
// Error Handling
// ============================================================================

// isConnectionError returns true if the error indicates the plugin process is unreachable.
func isConnectionError(err error) bool {
	// A ResourceOperationError means the plugin responded over gRPC.
	// The error describes a downstream problem (e.g. cluster unreachable),
	// NOT a plugin process crash.
	var roe *resource.ResourceOperationError
	if errors.As(err, &roe) {
		return false
	}

	s, ok := status.FromError(err)
	if !ok {
		msg := err.Error()
		return strings.Contains(msg, "connection refused") || strings.Contains(msg, "EOF")
	}
	return s.Code() == codes.Unavailable || s.Code() == codes.Internal
}

// checkConnectionError triggers crash recovery if the error is a connection error.
func (c *controller) checkConnectionError(pluginID string, err error) {
	if isConnectionError(err) {
		c.triggerCrashRecovery(pluginID, err, "rpc")
	}
}

// triggerCrashRecovery invokes the crash callback once per plugin.
// The "plugin/crash" event is emitted by HandlePluginCrash (the callback)
// to avoid duplicate notifications when multiple listeners detect the same crash.
func (c *controller) triggerCrashRecovery(pluginID string, err error, listener string) {
	c.logger.Errorw(context.Background(), "plugin event stream died — plugin process may have crashed",
		"pluginID", pluginID, "error", err, "listener", listener)

	c.pluginsMu.RLock()
	ps, ok := c.plugins[pluginID]
	c.pluginsMu.RUnlock()
	if ok && c.onCrashCallback != nil {
		ps.crashOnce.Do(func() { go c.onCrashCallback(pluginID) })
	}
}

// observeResponse updates the registry from a CRUD response. Unlike watch
// events (which carry ResourceMetadata from the plugin), CRUD responses
// only have raw JSON. We build a minimal entry from the known request
// parameters. The full metadata (UID, Labels, CreatedAt) will be populated
// when the corresponding watch event arrives — watch events are authoritative.
//
// This ensures resources discovered via Get or Update are at least present
// in the registry (for graph edge resolution), even before the
// watch event confirms them.
func (c *controller) observeResponse(pluginID, connectionID, resourceKey, id, namespace string, data json.RawMessage) {
	if len(data) == 0 || id == "" {
		return
	}

	rawCopy := make(json.RawMessage, len(data))
	copy(rawCopy, data)

	entry := registry.ResourceEntry{
		PluginID:     pluginID,
		ConnectionID: connectionID,
		ResourceKey:  resourceKey,
		ID:           id,
		Namespace:    namespace,
		UID:          "",
		Labels:       nil,
		CreatedAt:    time.Time{},
	}

	// Atomically insert only if no entry exists yet. If a watch event already
	// populated the entry with authoritative metadata (Labels, UID, CreatedAt),
	// PutIfAbsent returns the existing entry and we re-index with the new raw
	// data without overwriting that metadata.
	if existing, loaded := c.registryStore.PutIfAbsent(entry); loaded {
		c.dispatcher.Enqueue(indexer.Event{
			Type: indexer.EventUpdate, Entry: *existing, Old: existing, Raw: rawCopy,
		})
	} else {
		c.dispatcher.Enqueue(indexer.Event{
			Type: indexer.EventAdd, Entry: entry, Old: nil, Raw: rawCopy,
		})
	}
}
