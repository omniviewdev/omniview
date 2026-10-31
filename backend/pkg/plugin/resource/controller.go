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

	"github.com/google/uuid"
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
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
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
	application.RegisterEvent[HostWatchStateEvent](EventWatchState)
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
	ValidateReference(context.Context, string, resource.AccessRoute, resource.ResourceReference) error
	SetConnectionChangeHook(func(pluginID, connectionID string) func())
	AdmitReference(context.Context, string, string, resource.AccessRoute, resource.ResourceReference) (context.Context, error)
}

// pluginState holds per-plugin runtime state.
type pluginState struct {
	provider          ResourceProvider
	version           int
	watchCancel       context.CancelFunc
	ctx               context.Context
	generationID      string
	features          resource.FeatureSet
	featuresReady     bool
	sourceEpoch       map[string]uint64
	sourceChanging    map[string]bool
	catalogBindings   map[string]catalogBindingState
	crashOnce         sync.Once
	closeOnce         sync.Once
	closeErr          error
	metadata          map[string]HostConnectionMetadata
	metadataAvailable bool
	metadataEpoch     uint64
}

func (s *pluginState) closeSource(provider ResourceProvider) error {
	closer, ok := provider.(resource.Closer)
	if s == nil || !ok {
		return nil
	}
	s.closeOnce.Do(func() { s.closeErr = closer.Close() })
	return s.closeErr
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

	connsMu              sync.RWMutex
	connections          map[string][]types.Connection
	profilesMu           sync.Mutex
	profileNative        map[string][]types.Connection
	connectionChangeHook func(pluginID, connectionID string) func()

	autoConnectMu       sync.Mutex
	autoConnectAttempts map[string]string

	subs      *subscriptionManager
	boundary  *invocation.Boundary
	actions   *actionRegistry
	finite    finiteState
	inventory inventorySubscriptions

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

// dispenseProvider admits only the canonical resource-v2 boundary. The shared
// go-plugin cohort version is independent of resource wire negotiation.
func dispenseProvider(pluginID string, backend plugintypes.PluginBackend) (ResourceProvider, int, error) {
	raw, err := backend.Dispense(PluginName)
	if err != nil {
		return nil, 0, err
	}
	provider, ok := raw.(resource.Provider)
	if !ok {
		return nil, 0, apperror.New(apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Plugin type mismatch", fmt.Sprintf("Plugin %q does not expose resource wire v2", pluginID))
	}
	return provider, backend.NegotiatedVersion(), nil
}

func (c *controller) OnPluginInit(pluginID string, _ config.PluginMeta) {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginInit")
	c.lifecycleMu.Lock()
	defer c.lifecycleMu.Unlock()

	// The legacy mixed cache is passive review/import data, not source truth.
	// Leave its bytes untouched so failed discovery and restarts cannot erase it.
	c.connsMu.Lock()
	c.connections[pluginID] = make([]types.Connection, 0)
	c.connsMu.Unlock()
}

func (c *controller) OnPluginStart(pluginID string, _ config.PluginMeta, backend plugintypes.PluginBackend) (retErr error) {
	defer c.notifyInventory()
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
		version: version, watchCancel: watchCancel, ctx: watchCtx, generationID: uuid.NewString(),
	}
	c.pluginsMu.RLock()
	existing := c.plugins[pluginID]
	var previousProvider ResourceProvider
	if existing != nil {
		previousProvider = existing.provider
	}
	c.pluginsMu.RUnlock()
	if existing != nil {
		existing.watchCancel()
		c.retireMetadata(pluginID, existing)
	}
	c.pluginsMu.Lock()
	c.plugins[pluginID] = state
	c.pluginsMu.Unlock()
	defer func() {
		if retErr == nil {
			return
		}
		watchCancel()
		c.retireMetadata(pluginID, state)
		// The dispensed source is owned even before publication/readiness.
		// Close after lifecycle retirement, preserving the original startup error.
		defer func() {
			if closeErr := state.closeSource(provider); closeErr != nil {
				logger.Warnw(context.Background(), "failed resource source teardown failed", "error", closeErr)
			}
		}()
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
	if existing != nil {
		if err := existing.closeSource(previousProvider); err != nil {
			logger.Warnw(watchCtx, "previous resource source teardown failed", "error", err)
		}
	}
	featureCtx, featureCancel := context.WithTimeout(watchCtx, watchStreamReadyTimeout)
	features, featureErr := resource.DetectFeatures(featureCtx, provider)
	featureCancel()
	if featureErr != nil {
		return featureErr
	}
	if features.Has(resource.FeatureConnectionMetadata) {
		if _, ok := provider.(resource.ConnectionMetadataProvider); !ok {
			return resource.NewError("INVALID_REQUEST", "Provider advertised an unavailable metadata trait.")
		}
	}

	// Advisory updates remain optional. Finite/catalog-only providers must not
	// implement a pretend listener, but real listeners still acknowledge native
	// establishment before any source or resource call becomes available.
	if features.Has(resource.FeatureBestEffortUpdates) {
		updates, ok := provider.(resource.BestEffortUpdateProvider)
		if !ok {
			return resource.NewError("INVALID_REQUEST", "Provider advertised an unavailable update trait.")
		}
		sink := &engineWatchSink{pluginID: pluginID, ctrl: c, store: c.registryStore,
			dispatcher: c.dispatcher, ctx: invocation.HostContext(watchCtx), generationID: state.generationID}
		watchReady := make(chan error, 1)
		go c.listenForWatchEvents(watchCtx, pluginID, updates, sink, watchReady)
		expired := make(chan struct{})
		timer := c.watchAfterFunc(watchStreamReadyTimeout, func() { close(expired) })
		defer timer.Stop()
		select {
		case err := <-watchReady:
			if err != nil {
				return fmt.Errorf("best-effort update registration: %w", err)
			}
		case <-watchCtx.Done():
			return watchCtx.Err()
		case <-expired:
			return fmt.Errorf("best-effort update registration: %w", context.DeadlineExceeded)
		}
	}
	c.pluginsMu.Lock()
	if c.plugins[pluginID] != state || watchCtx.Err() != nil {
		c.pluginsMu.Unlock()
		return context.Canceled
	}
	// Keep concurrent resource calls from starting sources during registration.
	state.provider = provider
	state.features, state.featuresReady = features, true
	state.metadata = make(map[string]HostConnectionMetadata)
	state.metadataAvailable = !features.Has(resource.FeatureConnectionMetadata)
	c.emitMetadata(metadataEnvelope(pluginID, state))
	c.pluginsMu.Unlock()
	c.startMetadata(pluginID, state, provider)

	// Connections and their event source are independently optional.
	if features.Has(resource.FeatureConnections) {
		if conns, loadErr := c.LoadConnections(invocation.HostContext(watchCtx), pluginID); loadErr != nil {
			logger.Errorw(watchCtx, "failed to load connections", "error", loadErr)
		} else if len(conns) > 0 {
			c.emitter.Emit(pluginID+"/connection/sync", c.getConnections(pluginID))
			c.scheduleAutoConnect(pluginID, conns, types.ConnectionAutoConnectTriggerPluginStart)
		}
	}
	if features.Has(resource.FeatureRelationships) {
		for _, connection := range c.getConnections(pluginID) {
			c.bootstrapRelationships(invocation.HostContext(watchCtx), pluginID, resource.AccessRoute{Connection: connection.ID})
		}
	}
	if features.Has(resource.FeatureConnectionBrowser) {
		browser, ok := provider.(resource.ConnectionBrowser)
		if !ok {
			return resource.NewError("INVALID_REQUEST", "Provider advertised an unavailable connection browser.")
		}
		go c.listenForConnectionEvents(watchCtx, pluginID, browser, state)
	}

	return watchCtx.Err()
}

func (c *controller) OnPluginStop(pluginID string, _ config.PluginMeta) error {
	defer c.notifyInventory()
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginStop")
	c.lifecycleMu.Lock()
	defer c.lifecycleMu.Unlock()
	c.actions.stopPlugin(pluginID)

	// Cancel watch goroutines.
	c.pluginsMu.RLock()
	stopped := c.plugins[pluginID]
	c.pluginsMu.RUnlock()
	if stopped != nil {
		stopped.watchCancel()
		c.retireMetadata(pluginID, stopped)
	}
	// Cancel first so a concurrent readiness acknowledgement cannot republish
	// the retiring provider after invalidation.
	c.pluginsMu.Lock()
	var retired ResourceProvider
	// Make calls unavailable now; release ownership only after retirement.
	if stopped != nil {
		retired = stopped.provider
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
	return stopped.closeSource(retired)
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

// ============================================================================
// Connection Management
// ============================================================================

func (c *controller) getConnections(pluginID string) []types.Connection {
	c.connsMu.RLock()
	defer c.connsMu.RUnlock()
	return c.connections[pluginID]
}

func (c *controller) StartConnection(ctx context.Context, pluginID, connectionID string) (_result types.ConnectionStatus, retErr error) {
	defer c.notifyInventory()
	ctx, admissionErr := c.admit(ctx, "resource.StartConnection", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.profilesMu.Lock()
	defer c.profilesMu.Unlock()
	if release := c.beginMetricConnectionChange(pluginID, connectionID); release != nil {
		defer release()
	}
	ctx, span := tracer.Start(ctx, "resource.StartConnection")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getLifecycle(ctx, pluginID)
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
		c.connections[pluginID] = upsertEffectiveConnectionStatus(c.connections[pluginID], *conn.Connection)
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
	if conn.Status == types.ConnectionStatusConnected {
		c.bootstrapRelationships(ctx, pluginID, resource.AccessRoute{Connection: connectionID})
		if err := c.startConnectionUpdates(ctx, pluginID, resource.AccessRoute{Connection: connectionID}); err != nil {
			return conn, err
		}
	}

	return conn, nil

}

func (c *controller) StopConnection(ctx context.Context, pluginID, connectionID string) (_result types.Connection, retErr error) {
	defer c.notifyInventory()
	ctx, admissionErr := c.admit(ctx, "resource.StopConnection", invocation.Target{Provider: pluginID, Connection: connectionID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	c.profilesMu.Lock()
	defer c.profilesMu.Unlock()
	if release := c.beginMetricConnectionChange(pluginID, connectionID); release != nil {
		defer release()
	}
	ctx, span := tracer.Start(ctx, "resource.StopConnection")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getLifecycle(ctx, pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return types.Connection{}, err
	}
	releaseObservation, err := c.fenceStoppedRoute(pluginID, connectionID)
	if err != nil {
		return types.Connection{}, err
	}
	defer releaseObservation()

	conn, err := provider.StopConnection(ctx, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return types.Connection{}, err
	}

	// Clear LastRefresh so the frontend TTL check shows disconnected.
	conn.LastRefresh = time.Time{}
	c.connsMu.Lock()
	c.connections[pluginID] = upsertEffectiveConnectionStatus(c.connections[pluginID], conn)
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
	provider, err := c.getLifecycle(ctx, pluginID)
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
	defer c.notifyInventory()
	ctx, admissionErr := c.admit(ctx, "resource.LoadConnections", invocation.Target{Provider: pluginID})
	if admissionErr != nil {
		return _result, admissionErr
	}
	defer finishResource(ctx, &retErr)
	ctx, span := tracer.Start(ctx, "resource.LoadConnections")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))
	conns, err := c.loadConfiguredConnections(ctx, pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
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
	// The cache may not exist yet during plugin startup. An empty collection
	// is valid both before discovery and when no connections are configured.
	src := c.connections[pluginID]
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
			cs, err := c.connectionState(ctx, pluginID, conn)
			if err != nil {
				return nil, err
			}

			states = append(states, cs)
		}

		result[pluginID] = states
	}

	return result, nil

}

// connectionState snapshots registration before attempting any active-source
// catalog/watch work. The outer generation fence covers both observations.
func (c *controller) connectionState(ctx context.Context, pluginID string, conn types.Connection) (state ConnectionState, retErr error) {
	ctx, err := c.admit(ctx, "resource.GetConnectionStatus", invocation.Target{Provider: pluginID, Connection: conn.ID})
	if err != nil {
		return state, err
	}
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, resource.AccessRoute{Connection: conn.ID})
	if err != nil {
		return state, err
	}
	defer cleanup()
	defer func() {
		if retErr == nil {
			retErr = c.currentGeneration(ctx, pluginID, generation)
		}
	}()
	state = ConnectionState{
		Connection:     conn,
		Readiness:      types.ConnectionStatusUnknown,
		Resources:      make(map[string]resource.WatchState),
		ResourceCounts: make(map[string]resource.Count),
	}
	features, err := c.providerFeatures(ctx, pluginID, provider)
	if err != nil {
		return state, err
	}
	unavailable := func(err error) {
		request, _ := invocation.FromContext(ctx)
		state.ReadinessError = apperror.ForResource(err, request.ID())
	}
	if !features.Has(resource.FeatureConnectionReadiness) {
		unavailable(resource.NewError("UNSUPPORTED", "Registered connection state is unavailable."))
		return state, nil
	}
	readiness, ok := provider.(resource.ConnectionReadinessProvider)
	if !ok {
		return state, resource.NewError("INVALID_REQUEST", "Provider advertised an unavailable connection readiness trait.")
	}
	status, err := readiness.GetConnectionStatus(ctx, conn.ID)
	if err != nil {
		if resource.ErrorCode(err) == "UNSUPPORTED" {
			unavailable(err)
			return state, nil
		}
		return state, err
	}
	switch status.Status {
	case types.ConnectionStatusDisconnected, types.ConnectionStatusPending, types.ConnectionStatusConnected, types.ConnectionStatusFailed:
		state.Readiness = status.Status
	default:
		return state, resource.NewError("INVALID_REQUEST", "Provider returned an invalid registered connection state.")
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return state, err
	}
	if state.Readiness != types.ConnectionStatusConnected || !features.Has(resource.FeatureBestEffortUpdates) {
		return state, nil
	}
	summary, err := c.GetWatchState(ctx, pluginID, resource.AccessRoute{Connection: conn.ID})
	if err != nil {
		var app *apperror.AppError
		if !errors.As(err, &app) || app.Code != "NOT_FOUND" || app.Type != apperror.TypeResourceNotFound {
			return state, err
		}
	}
	if summary == nil {
		return state, nil
	}
	state.Resources = summary.Resources
	state.ResourceCounts = summary.ResourceCounts
	for _, watchState := range summary.Resources {
		state.TotalResources++
		switch watchState {
		case resource.WatchStateSynced:
			state.SyncedCount++
		case resource.WatchStateError, resource.WatchStateFailed:
			state.ErrorCount++
		case resource.WatchStateIdle, resource.WatchStateSyncing, resource.WatchStateStopped,
			resource.WatchStateForbidden, resource.WatchStateSkipped:
			// Neither synced nor failed; only counted in TotalResources.
		}
	}
	return state, nil
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

func (c *controller) ScopeValues(ctx context.Context, pluginID string, route resource.AccessRoute, dimension string) (_result []string, retErr error) {
	ctx, err := c.admit(ctx, "resource.ScopeValues", invocation.Target{Provider: pluginID, Connection: route.Connection, Scope: map[string]string{"dimension": dimension}})
	if err != nil {
		return nil, err
	}
	defer finishResource(ctx, &retErr)
	provider, generation, ctx, cleanup, err := c.operationGeneration(ctx, pluginID, route)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	browser, ok := provider.(resource.ScopeValuesProvider)
	if !ok {
		return nil, resource.NewError("UNSUPPORTED", "Scope value discovery is not supported.")
	}
	if _, retained := ctx.Value(observationKey{}).(Observation); retained {
		_, catalog, err := c.routeCatalog(ctx, pluginID, route)
		if err != nil {
			return nil, err
		}
		declared := false
		for _, descriptor := range catalog.Types {
			for _, candidate := range descriptor.QueryDimensions {
				if candidate.Name == dimension {
					declared = true
					break
				}
			}
		}
		if !declared {
			return nil, resource.NewError("UNSUPPORTED", "Scope discovery dimension is not declared on this route.")
		}
		ctx = resource.WithCatalogRevision(ctx, catalog.Revision)
	}
	values, err := browser.ScopeValues(ctx, route, dimension)
	if err != nil {
		return nil, err
	}
	if err := c.currentGeneration(ctx, pluginID, generation); err != nil {
		return nil, err
	}
	return values, nil
}

// ============================================================================
// Watch
// ============================================================================

// ============================================================================
// Subscriptions
// ============================================================================

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
	provider resource.BestEffortUpdateProvider,
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
func (c *controller) listenForConnectionEvents(ctx context.Context, pluginID string, provider resource.ConnectionBrowser, generation *pluginState) {
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
		case _, ok := <-connStream:
			if !ok {
				return
			}
			_, span := tracer.Start(ctx, "resource.ConnectionSync",
				trace.WithAttributes(
					attribute.String("plugin_id", pluginID),
				))
			// Queued frames are notifications, not current configuration proof.
			// Fetch current source facts under the same profile transaction fence.
			conns, err := c.refreshWatchedConnections(ctx, pluginID, provider, generation)
			if err != nil {
				c.logger.Errorw(ctx, "connection snapshot refresh failed", "pluginID", pluginID, "error", err)
				span.End()
				continue
			}
			span.SetAttributes(attribute.Int("connection_count", len(conns)))

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
