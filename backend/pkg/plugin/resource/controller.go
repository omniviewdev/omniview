package resource

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const PluginName = "resource"

var tracer = otel.Tracer("omniview.resource")


// Controller is the lifecycle + service interface for the resource capability.
type Controller interface {
	plugintypes.ConnectedController
	Service
	SetCrashCallback(cb func(pluginID string))
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
	logger           logging.Logger
	settingsProvider pkgsettings.Provider
	emitter          EventEmitter

	pluginsMu sync.RWMutex
	plugins   map[string]*pluginState

	connsMu     sync.RWMutex
	connections map[string][]types.Connection

	autoConnectMu       sync.Mutex
	autoConnectAttempts map[string]string

	subs *subscriptionManager

	onCrashCallback func(pluginID string)
}

// compile-time assertions
var (
	_ Controller = (*controller)(nil)
	_ Service    = (*controller)(nil)
)

// NewController creates a new resource Controller.
func NewController(logger logging.Logger, sp pkgsettings.Provider) Controller {
	return &controller{
		logger:              logger.Named("ResourceController"),
		settingsProvider:    sp,
		plugins:             make(map[string]*pluginState),
		connections:         make(map[string][]types.Connection),
		autoConnectAttempts: make(map[string]string),
		subs:                newSubscriptionManager(),
	}
}

// SetCrashCallback sets the function called when a plugin crash is detected.
func (c *controller) SetCrashCallback(cb func(pluginID string)) {
	c.onCrashCallback = cb
}

// ============================================================================
// Plugin Lifecycle
// ============================================================================

// Run starts the controller's background tasks.
func (c *controller) Run(ctx context.Context) {
	c.emitter = newWailsEmitter(ctx)
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
			return nil, 0, apperror.New(apperror.TypePluginLoadFailed, 500,
				"Plugin type mismatch",
				fmt.Sprintf("Expected resource.Provider for v1, got %T", raw))
		}
		return NewAdapterV1(v1), version, nil
	default:
		return nil, 0, apperror.New(apperror.TypePluginLoadFailed, 500,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d, engine supports v1", pluginID, version))
	}
}

func (c *controller) OnPluginInit(pluginID string, meta config.PluginMeta) {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginInit")

	// Load persisted connections from disk.
	state, err := loadFromLocalStore(pluginID)
	if err != nil {
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

func (c *controller) OnPluginStart(pluginID string, meta config.PluginMeta, backend plugintypes.PluginBackend) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginStart")

	provider, version, err := dispenseProvider(pluginID, backend)
	if err != nil {
		return err
	}

	watchCtx, watchCancel := context.WithCancel(context.Background())

	c.pluginsMu.Lock()
	if existing, ok := c.plugins[pluginID]; ok {
		existing.watchCancel()
	}
	c.plugins[pluginID] = &pluginState{
		provider:    provider,
		version:     version,
		watchCancel: watchCancel,
	}
	c.pluginsMu.Unlock()
	c.clearAutoConnectAttempts(pluginID)

	// Load connections from the plugin.
	if conns, err := c.LoadConnections(pluginID); err != nil {
		logger.Errorw(context.Background(), "failed to load connections from plugin", "error", err)
	} else if len(conns) > 0 {
		eventKey := fmt.Sprintf("%s/connection/sync", pluginID)
		c.emitter.Emit(eventKey, c.getConnections(pluginID))
		c.scheduleAutoConnect(pluginID, conns, types.ConnectionAutoConnectTriggerPluginStart)
	}

	// Start watch event listener (uses WatchEventSink callback pattern).
	sink := &engineWatchSink{pluginID: pluginID, ctrl: c}
	watchReady := make(chan struct{})
	go c.listenForWatchEvents(pluginID, provider, watchCtx, sink, watchReady)

	// Wait for the gRPC stream to be established (with timeout).
	select {
	case <-watchReady:
		logger.Debugw(context.Background(), "watch event stream established")
	case <-time.After(10 * time.Second):
		logger.Warnw(context.Background(), "watch event stream did not establish in time, continuing anyway")
	}

	// Start connection watcher.
	go c.listenForConnectionEvents(pluginID, provider, watchCtx)

	return nil
}

func (c *controller) OnPluginStop(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginStop")

	// Persist connections.
	c.connsMu.RLock()
	conns := c.connections
	c.connsMu.RUnlock()
	if err := saveToLocalStore(pluginID, conns); err != nil {
		logger.Errorw(context.Background(), "failed to save connections to local store", "error", err)
	}

	// Cancel watch goroutines.
	c.pluginsMu.Lock()
	if ps, ok := c.plugins[pluginID]; ok {
		ps.watchCancel()
	}
	delete(c.plugins, pluginID)
	c.pluginsMu.Unlock()

	c.connsMu.Lock()
	delete(c.connections, pluginID)
	c.connsMu.Unlock()
	c.clearAutoConnectAttempts(pluginID)

	c.subs.RemoveAll(pluginID)

	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	return c.OnPluginStop(pluginID, meta)
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginDestroy")
	if err := removeLocalStore(pluginID); err != nil {
		logger.Errorw(context.Background(), "failed to remove local store", "error", err)
	}
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	plugins := make([]string, 0, len(c.plugins))
	for id := range c.plugins {
		plugins = append(plugins, id)
	}
	return plugins, nil
}

func (c *controller) HasPlugin(pluginID string) bool {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	_, ok := c.plugins[pluginID]
	return ok
}

// ============================================================================
// Provider Access
// ============================================================================

func (c *controller) getProvider(pluginID string) (ResourceProvider, error) {
	c.pluginsMu.RLock()
	defer c.pluginsMu.RUnlock()
	ps, ok := c.plugins[pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}
	return ps.provider, nil
}

// withSession returns the provider and a context with session info for connection-scoped calls.
// The parent context is preserved so that span context propagates to gRPC calls.
func (c *controller) withSession(ctx context.Context, pluginID, connectionID string) (ResourceProvider, context.Context, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, nil, err
	}
	ctx = resource.WithSession(ctx, &resource.Session{
		Connection: &types.Connection{ID: connectionID},
	})
	return provider, ctx, nil
}

// ============================================================================
// Error Conversion
// ============================================================================

// toAppError converts resource operation errors to structured AppErrors for the
// Wails boundary. ResourceOperationError carries machine-readable codes (FORBIDDEN,
// UNAUTHORIZED, etc.) that would otherwise be lost when Wails calls .Error().
func toAppError(err error, pluginID string) error {
	if err == nil {
		return nil
	}
	var roe *resource.ResourceOperationError
	if errors.As(err, &roe) {
		return apperror.FromResourceOperationError(roe.Error(), pluginID)
	}
	return apperror.Internal(err, "Resource operation failed")
}

// ============================================================================
// CRUD
// ============================================================================

func (c *controller) Get(pluginID, connectionID, key string, input resource.GetInput) (*resource.GetResult, error) {
	ctx, span := tracer.Start(context.Background(), "resource.Get")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Get(ctx, key, input)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(ctx, "RPC failed", "op", "Get", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
		return nil, toAppError(err, pluginID)
	}
	return result, nil
}

func (c *controller) List(pluginID, connectionID, key string, input resource.ListInput) (*resource.ListResult, error) {
	ctx, span := tracer.Start(context.Background(), "resource.List")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.List(ctx, key, input)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(ctx, "RPC failed", "op", "List", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
		return nil, toAppError(err, pluginID)
	}
	return result, nil
}

func (c *controller) Find(pluginID, connectionID, key string, input resource.FindInput) (*resource.FindResult, error) {
	ctx, span := tracer.Start(context.Background(), "resource.Find")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Find(ctx, key, input)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(ctx, "RPC failed", "op", "Find", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
		return nil, toAppError(err, pluginID)
	}
	return result, nil
}

func (c *controller) Create(pluginID, connectionID, key string, input resource.CreateInput) (*resource.CreateResult, error) {
	ctx, span := tracer.Start(context.Background(), "resource.Create")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Create(ctx, key, input)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(ctx, "RPC failed", "op", "Create", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
		return nil, toAppError(err, pluginID)
	}
	return result, nil
}

func (c *controller) Update(pluginID, connectionID, key string, input resource.UpdateInput) (*resource.UpdateResult, error) {
	ctx, span := tracer.Start(context.Background(), "resource.Update")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Update(ctx, key, input)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(ctx, "RPC failed", "op", "Update", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
		return nil, toAppError(err, pluginID)
	}
	return result, nil
}

func (c *controller) Delete(pluginID, connectionID, key string, input resource.DeleteInput) (*resource.DeleteResult, error) {
	ctx, span := tracer.Start(context.Background(), "resource.Delete")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	result, err := provider.Delete(ctx, key, input)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(ctx, "RPC failed", "op", "Delete", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
		return nil, toAppError(err, pluginID)
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

func (c *controller) StartConnection(pluginID, connectionID string) (types.ConnectionStatus, error) {
	ctx, span := tracer.Start(context.Background(), "resource.StartConnection")
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
	c.emitter.Emit("connection/status", map[string]interface{}{
		"pluginID":     pluginID,
		"connectionID": connectionID,
		"status":       string(conn.Status),
		"name":         connName,
	})

	return conn, nil
}

func (c *controller) StopConnection(pluginID, connectionID string) (types.Connection, error) {
	ctx, span := tracer.Start(context.Background(), "resource.StopConnection")
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

	c.emitter.Emit("connection/status", map[string]interface{}{
		"pluginID":     pluginID,
		"connectionID": connectionID,
		"status":       "DISCONNECTED",
		"name":         conn.Name,
	})

	return conn, nil
}

func (c *controller) CheckConnection(pluginID, connectionID string) (types.ConnectionStatus, error) {
	ctx, span := tracer.Start(context.Background(), "resource.CheckConnection")
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
		c.logger.Errorw(ctx, "RPC failed", "op", "CheckConnection", "pluginID", pluginID, "connectionID", connectionID, "error", err)
		c.checkConnectionError(pluginID, err)
		return types.ConnectionStatus{}, toAppError(err, pluginID)
	}
	return status, nil
}

func (c *controller) LoadConnections(pluginID string) ([]types.Connection, error) {
	ctx, span := tracer.Start(context.Background(), "resource.LoadConnections")
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

	// Best-effort persist.
	c.connsMu.RLock()
	_ = saveToLocalStore(pluginID, c.connections)
	c.connsMu.RUnlock()

	return conns, nil
}

func (c *controller) ListConnections(pluginID string) ([]types.Connection, error) {
	c.connsMu.RLock()
	src, ok := c.connections[pluginID]
	if !ok {
		c.connsMu.RUnlock()
		return nil, apperror.New(apperror.TypeConnectionNotFound, 404,
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

func (c *controller) ListAllConnections() (map[string][]types.Connection, error) {
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

func (c *controller) GetAllConnectionStates() (map[string][]ConnectionState, error) {
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
				Resources:      make(map[string]resource.WatchState),
				ResourceCounts: make(map[string]int),
			}

			// Try to get watch state; if it succeeds the connection is active.
			summary, err := c.GetWatchState(pluginID, conn.ID)
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
					}
				}
			}

			states = append(states, cs)
		}

		result[pluginID] = states
	}

	return result, nil
}

func (c *controller) GetConnection(pluginID, connectionID string) (types.Connection, error) {
	c.connsMu.RLock()
	conns, ok := c.connections[pluginID]
	c.connsMu.RUnlock()
	if !ok {
		return types.Connection{}, apperror.New(apperror.TypeConnectionNotFound, 404,
			"No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	for _, conn := range conns {
		if conn.ID == connectionID {
			return conn, nil
		}
	}
	return types.Connection{}, apperror.ConnectionNotFound(pluginID, connectionID)
}

func (c *controller) GetConnectionNamespaces(pluginID, connectionID string) ([]string, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetConnectionNamespaces")
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

func (c *controller) AddConnection(pluginID string, connection types.Connection) error {
	c.connsMu.Lock()
	c.connections[pluginID] = append(c.connections[pluginID], connection)
	c.connsMu.Unlock()
	return nil
}

func (c *controller) UpdateConnection(pluginID string, connection types.Connection) (types.Connection, error) {
	c.connsMu.Lock()
	defer c.connsMu.Unlock()
	conns, ok := c.connections[pluginID]
	if !ok {
		return types.Connection{}, apperror.New(apperror.TypeConnectionNotFound, 404,
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

func (c *controller) RemoveConnection(pluginID, connectionID string) error {
	c.connsMu.Lock()
	defer c.connsMu.Unlock()
	conns, ok := c.connections[pluginID]
	if !ok {
		return apperror.New(apperror.TypeConnectionNotFound, 404,
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

func (c *controller) StartConnectionWatch(pluginID, connectionID string) error {
	ctx, span := tracer.Start(context.Background(), "resource.StartConnectionWatch")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err := provider.StartConnectionWatch(ctx, connectionID); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil
}

func (c *controller) StopConnectionWatch(pluginID, connectionID string) error {
	ctx, span := tracer.Start(context.Background(), "resource.StopConnectionWatch")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err := provider.StopConnectionWatch(ctx, connectionID); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil
}

func (c *controller) GetWatchState(pluginID, connectionID string) (*resource.WatchConnectionSummary, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetWatchState")
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

func (c *controller) EnsureResourceWatch(pluginID, connectionID, resourceKey string) error {
	ctx, span := tracer.Start(context.Background(), "resource.EnsureResourceWatch")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", resourceKey))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err := provider.EnsureResourceWatch(ctx, connectionID, resourceKey); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil
}

func (c *controller) StopResourceWatch(pluginID, connectionID, resourceKey string) error {
	ctx, span := tracer.Start(context.Background(), "resource.StopResourceWatch")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", resourceKey))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err := provider.StopResourceWatch(ctx, connectionID, resourceKey); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil
}

func (c *controller) RestartResourceWatch(pluginID, connectionID, resourceKey string) error {
	ctx, span := tracer.Start(context.Background(), "resource.RestartResourceWatch")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", resourceKey))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	if err := provider.RestartResourceWatch(ctx, connectionID, resourceKey); err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}
	return nil
}

func (c *controller) IsResourceWatchRunning(pluginID, connectionID, resourceKey string) (bool, error) {
	ctx, span := tracer.Start(context.Background(), "resource.IsResourceWatchRunning")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", resourceKey))
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

func (c *controller) SubscribeResource(pluginID, connectionID, resourceKey string) error {
	count := c.subs.Subscribe(pluginID, connectionID, resourceKey)
	c.logger.Debugw(context.Background(), "resource subscribed",
		"key", subscriptionKey(pluginID, connectionID, resourceKey), "refcount", count)
	return nil
}

func (c *controller) UnsubscribeResource(pluginID, connectionID, resourceKey string) error {
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

func (c *controller) GetResourceGroups(pluginID, connectionID string) map[string]resource.ResourceGroup {
	ctx, span := tracer.Start(context.Background(), "resource.GetResourceGroups")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil
	}
	return provider.GetResourceGroups(ctx, connectionID)
}

func (c *controller) GetResourceGroup(pluginID, groupID string) (resource.ResourceGroup, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetResourceGroup")
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

func (c *controller) GetResourceTypes(pluginID, connectionID string) map[string]resource.ResourceMeta {
	ctx, span := tracer.Start(context.Background(), "resource.GetResourceTypes")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil
	}
	return provider.GetResourceTypes(ctx, connectionID)
}

func (c *controller) GetResourceType(pluginID, typeID string) (*resource.ResourceMeta, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetResourceType")
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

func (c *controller) HasResourceType(pluginID, typeID string) bool {
	ctx, span := tracer.Start(context.Background(), "resource.HasResourceType")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("type_id", typeID))
	provider, err := c.getProvider(pluginID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return false
	}
	return provider.HasResourceType(ctx, typeID)
}

func (c *controller) GetResourceDefinition(pluginID, typeID string) (resource.ResourceDefinition, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetResourceDefinition")
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

func (c *controller) GetResourceCapabilities(pluginID, key string) (*resource.ResourceCapabilities, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetResourceCapabilities")
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

func (c *controller) GetFilterFields(pluginID, connectionID, key string) ([]resource.FilterField, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetFilterFields")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
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

func (c *controller) GetResourceSchema(pluginID, connectionID, key string) (json.RawMessage, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetResourceSchema")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
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

func (c *controller) GetActions(pluginID, connectionID, key string) ([]resource.ActionDescriptor, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetActions")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
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

func (c *controller) ExecuteAction(pluginID, connectionID, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error) {
	ctx, span := tracer.Start(context.Background(), "resource.ExecuteAction")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key), attribute.String("action_id", actionID))
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
		return nil, toAppError(err, pluginID)
	}
	return result, nil
}

func (c *controller) StreamAction(pluginID, connectionID, key, actionID string, input resource.ActionInput) (string, error) {
	ctx, span := tracer.Start(context.Background(), "resource.StreamAction")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key), attribute.String("action_id", actionID))
	provider, ctx, err := c.withSession(ctx, pluginID, connectionID)
	if err != nil {
		telemetryutil.RecordError(span, err)
		return "", err
	}

	operationID := fmt.Sprintf("op_%s_%s_%d", actionID, input.ID, time.Now().UnixNano())
	eventStream := make(chan resource.ActionEvent, 16)

	go func() {
		streamErr := provider.StreamAction(ctx, key, actionID, input, eventStream)
		if streamErr != nil {
			c.logger.Errorw(ctx, "RPC failed", "op", "StreamAction", "pluginID", pluginID,
				"key", key, "actionID", actionID, "error", streamErr)
			eventKey := fmt.Sprintf("action/stream/%s", operationID)
			c.emitter.Emit(eventKey, resource.ActionEvent{
				Type: "error",
				Data: map[string]interface{}{"message": streamErr.Error()},
			})
		}
	}()

	go func() {
		eventKey := fmt.Sprintf("action/stream/%s", operationID)
		for event := range eventStream {
			c.emitter.Emit(eventKey, event)
		}
	}()

	return operationID, nil
}

// ============================================================================
// Editor Schemas
// ============================================================================

func (c *controller) GetEditorSchemas(pluginID, connectionID string) ([]resource.EditorSchema, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetEditorSchemas")
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

func (c *controller) GetRelationships(pluginID, key string) ([]resource.RelationshipDescriptor, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetRelationships")
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

func (c *controller) ResolveRelationships(pluginID, connectionID, key, id, namespace string) ([]resource.ResolvedRelationship, error) {
	ctx, span := tracer.Start(context.Background(), "resource.ResolveRelationships")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
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

func (c *controller) GetHealth(pluginID, connectionID, key string, data json.RawMessage) (*resource.ResourceHealth, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetHealth")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
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

func (c *controller) GetResourceEvents(pluginID, connectionID, key, id, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	ctx, span := tracer.Start(context.Background(), "resource.GetResourceEvents")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("connection_id", connectionID), attribute.String("resource_key", key))
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
// Closes the ready channel before calling ListenForEvents to signal the caller.
//
// NOTE: No span wraps this method — it runs for the entire plugin lifetime.
// The underlying gRPC stream gets its own otelgrpc span; individual watch
// events are too high-volume to trace individually.
func (c *controller) listenForWatchEvents(pluginID string, provider ResourceProvider, ctx context.Context, sink resource.WatchEventSink, ready chan struct{}) {
	c.logger.Infow(ctx, "watch event listener starting", "pluginID", pluginID)
	close(ready) // Signal that we're about to call ListenForEvents
	err := provider.ListenForEvents(ctx, sink)
	if err != nil && ctx.Err() == nil {
		c.triggerCrashRecovery(pluginID, err, "watch")
	}
	c.logger.Infow(ctx, "watch event listener stopped", "pluginID", pluginID)
}

// listenForConnectionEvents watches for external connection changes.
//
// NOTE: No span wraps the entire stream — it runs for the plugin lifetime.
// Instead, each batch of received connections gets a short-lived span so
// that connection discovery is observable without bloating Tempo.
func (c *controller) listenForConnectionEvents(pluginID string, provider ResourceProvider, ctx context.Context) {
	c.logger.Infow(ctx, "connection event listener started", "pluginID", pluginID)
	connStream := make(chan []types.Connection, 16)

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

			eventKey := fmt.Sprintf("%s/connection/sync", pluginID)
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

			status, err := c.StartConnection(pluginID, conn.ID)
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
			if err := c.StartConnectionWatch(pluginID, conn.ID); err != nil {
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
