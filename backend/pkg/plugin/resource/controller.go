package resource

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const PluginName = "resource"

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
	logger           *zap.SugaredLogger
	settingsProvider pkgsettings.Provider
	emitter          EventEmitter

	pluginsMu sync.RWMutex
	plugins   map[string]*pluginState

	connsMu     sync.RWMutex
	connections map[string][]types.Connection

	subs *subscriptionManager

	onCrashCallback func(pluginID string)
}

// compile-time assertions
var (
	_ Controller = (*controller)(nil)
	_ Service    = (*controller)(nil)
)

// NewController creates a new resource Controller.
func NewController(logger *zap.SugaredLogger, sp pkgsettings.Provider) Controller {
	return &controller{
		logger:           logger.Named("ResourceController"),
		settingsProvider: sp,
		plugins:          make(map[string]*pluginState),
		connections:      make(map[string][]types.Connection),
		subs:             newSubscriptionManager(),
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
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginInit")

	// Load persisted connections from disk.
	state, err := loadFromLocalStore(pluginID)
	if err != nil {
		logger.Errorw("failed to load connections from local store", "error", err)
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
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginStart")

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

	// Load connections from the plugin.
	if conns, err := c.LoadConnections(pluginID); err != nil {
		logger.Errorw("failed to load connections from plugin", "error", err)
	} else if len(conns) > 0 {
		eventKey := fmt.Sprintf("%s/connection/sync", pluginID)
		c.emitter.Emit(eventKey, c.getConnections(pluginID))
	}

	// Start watch event listener (uses WatchEventSink callback pattern).
	sink := &engineWatchSink{pluginID: pluginID, ctrl: c}
	go c.listenForWatchEvents(pluginID, provider, watchCtx, sink)

	// Start connection watcher.
	go c.listenForConnectionEvents(pluginID, provider, watchCtx)

	return nil
}

func (c *controller) OnPluginStop(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginStop")

	// Persist connections.
	c.connsMu.RLock()
	conns := c.connections
	c.connsMu.RUnlock()
	if err := saveToLocalStore(pluginID, conns); err != nil {
		logger.Errorw("failed to save connections to local store", "error", err)
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

	c.subs.RemoveAll(pluginID)

	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	return c.OnPluginStop(pluginID, meta)
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginDestroy")
	if err := removeLocalStore(pluginID); err != nil {
		logger.Errorw("failed to remove local store", "error", err)
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
func (c *controller) withSession(pluginID, connectionID string) (ResourceProvider, context.Context, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, nil, err
	}
	ctx := resource.WithSession(context.Background(), &resource.Session{
		Connection: &types.Connection{ID: connectionID},
	})
	return provider, ctx, nil
}

// ============================================================================
// CRUD
// ============================================================================

func (c *controller) Get(pluginID, connectionID, key string, input resource.GetInput) (*resource.GetResult, error) {
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	result, err := provider.Get(ctx, key, input)
	if err != nil {
		c.logger.Errorw("RPC failed", "op", "Get", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
	}
	return result, err
}

func (c *controller) List(pluginID, connectionID, key string, input resource.ListInput) (*resource.ListResult, error) {
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	result, err := provider.List(ctx, key, input)
	if err != nil {
		c.logger.Errorw("RPC failed", "op", "List", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
	}
	return result, err
}

func (c *controller) Find(pluginID, connectionID, key string, input resource.FindInput) (*resource.FindResult, error) {
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	result, err := provider.Find(ctx, key, input)
	if err != nil {
		c.logger.Errorw("RPC failed", "op", "Find", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
	}
	return result, err
}

func (c *controller) Create(pluginID, connectionID, key string, input resource.CreateInput) (*resource.CreateResult, error) {
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	result, err := provider.Create(ctx, key, input)
	if err != nil {
		c.logger.Errorw("RPC failed", "op", "Create", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
	}
	return result, err
}

func (c *controller) Update(pluginID, connectionID, key string, input resource.UpdateInput) (*resource.UpdateResult, error) {
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	result, err := provider.Update(ctx, key, input)
	if err != nil {
		c.logger.Errorw("RPC failed", "op", "Update", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
	}
	return result, err
}

func (c *controller) Delete(pluginID, connectionID, key string, input resource.DeleteInput) (*resource.DeleteResult, error) {
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	result, err := provider.Delete(ctx, key, input)
	if err != nil {
		c.logger.Errorw("RPC failed", "op", "Delete", "pluginID", pluginID, "key", key, "error", err)
		c.checkConnectionError(pluginID, err)
	}
	return result, err
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
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return types.ConnectionStatus{}, err
	}

	conn, err := provider.StartConnection(context.Background(), connectionID)
	if err != nil {
		return types.ConnectionStatus{}, err
	}

	if conn.Status == types.ConnectionStatusConnected && conn.Connection != nil {
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
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return types.Connection{}, err
	}

	conn, err := provider.StopConnection(context.Background(), connectionID)
	if err != nil {
		return types.Connection{}, err
	}

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

func (c *controller) LoadConnections(pluginID string) ([]types.Connection, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}

	conns, err := provider.LoadConnections(context.Background())
	if err != nil {
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
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.GetConnectionNamespaces(context.Background(), connectionID)
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
// Watch / Informer
// ============================================================================

func (c *controller) StartConnectionWatch(pluginID, connectionID string) error {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return err
	}
	return provider.StartConnectionWatch(context.Background(), connectionID)
}

func (c *controller) StopConnectionWatch(pluginID, connectionID string) error {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return err
	}
	return provider.StopConnectionWatch(context.Background(), connectionID)
}

func (c *controller) GetWatchState(pluginID, connectionID string) (*resource.WatchConnectionSummary, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.GetWatchState(context.Background(), connectionID)
}

func (c *controller) EnsureResourceWatch(pluginID, connectionID, resourceKey string) error {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return err
	}
	return provider.EnsureResourceWatch(context.Background(), connectionID, resourceKey)
}

func (c *controller) StopResourceWatch(pluginID, connectionID, resourceKey string) error {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return err
	}
	return provider.StopResourceWatch(context.Background(), connectionID, resourceKey)
}

func (c *controller) RestartResourceWatch(pluginID, connectionID, resourceKey string) error {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return err
	}
	return provider.RestartResourceWatch(context.Background(), connectionID, resourceKey)
}

func (c *controller) IsResourceWatchRunning(pluginID, connectionID, resourceKey string) (bool, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return false, err
	}
	return provider.IsResourceWatchRunning(context.Background(), connectionID, resourceKey)
}

// ============================================================================
// Subscriptions
// ============================================================================

func (c *controller) SubscribeResource(pluginID, connectionID, resourceKey string) error {
	count := c.subs.Subscribe(pluginID, connectionID, resourceKey)
	c.logger.Debugw("resource subscribed",
		"key", subscriptionKey(pluginID, connectionID, resourceKey), "refcount", count)
	return nil
}

func (c *controller) UnsubscribeResource(pluginID, connectionID, resourceKey string) error {
	count := c.subs.Unsubscribe(pluginID, connectionID, resourceKey)
	c.logger.Debugw("resource unsubscribed",
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
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil
	}
	return provider.GetResourceGroups(context.Background(), connectionID)
}

func (c *controller) GetResourceGroup(pluginID, groupID string) (resource.ResourceGroup, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return resource.ResourceGroup{}, err
	}
	return provider.GetResourceGroup(context.Background(), groupID)
}

func (c *controller) GetResourceTypes(pluginID, connectionID string) map[string]resource.ResourceMeta {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil
	}
	return provider.GetResourceTypes(context.Background(), connectionID)
}

func (c *controller) GetResourceType(pluginID, typeID string) (*resource.ResourceMeta, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.GetResourceType(context.Background(), typeID)
}

func (c *controller) HasResourceType(pluginID, typeID string) bool {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return false
	}
	return provider.HasResourceType(context.Background(), typeID)
}

func (c *controller) GetResourceDefinition(pluginID, typeID string) (resource.ResourceDefinition, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return resource.ResourceDefinition{}, err
	}
	return provider.GetResourceDefinition(context.Background(), typeID)
}

func (c *controller) GetResourceCapabilities(pluginID, key string) (*resource.ResourceCapabilities, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.GetResourceCapabilities(context.Background(), key)
}

func (c *controller) GetFilterFields(pluginID, connectionID, key string) ([]resource.FilterField, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.GetFilterFields(context.Background(), connectionID, key)
}

func (c *controller) GetResourceSchema(pluginID, connectionID, key string) (json.RawMessage, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.GetResourceSchema(context.Background(), connectionID, key)
}

// ============================================================================
// Actions
// ============================================================================

func (c *controller) GetActions(pluginID, connectionID, key string) ([]resource.ActionDescriptor, error) {
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	return provider.GetActions(ctx, key)
}

func (c *controller) ExecuteAction(pluginID, connectionID, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error) {
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	result, err := provider.ExecuteAction(ctx, key, actionID, input)
	if err != nil {
		c.logger.Errorw("RPC failed", "op", "ExecuteAction", "pluginID", pluginID,
			"key", key, "actionID", actionID, "error", err)
	}
	return result, err
}

func (c *controller) StreamAction(pluginID, connectionID, key, actionID string, input resource.ActionInput) (string, error) {
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return "", err
	}

	operationID := fmt.Sprintf("op_%s_%s_%d", actionID, input.ID, time.Now().UnixNano())
	eventStream := make(chan resource.ActionEvent, 16)

	go func() {
		streamErr := provider.StreamAction(ctx, key, actionID, input, eventStream)
		if streamErr != nil {
			c.logger.Errorw("RPC failed", "op", "StreamAction", "pluginID", pluginID,
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
	provider, ctx, err := c.withSession(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	return provider.GetEditorSchemas(ctx, connectionID)
}

// ============================================================================
// Relationships
// ============================================================================

func (c *controller) GetRelationships(pluginID, key string) ([]resource.RelationshipDescriptor, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.GetRelationships(context.Background(), key)
}

func (c *controller) ResolveRelationships(pluginID, connectionID, key, id, namespace string) ([]resource.ResolvedRelationship, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.ResolveRelationships(context.Background(), connectionID, key, id, namespace)
}

// ============================================================================
// Health
// ============================================================================

func (c *controller) GetHealth(pluginID, connectionID, key string, data json.RawMessage) (*resource.ResourceHealth, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.GetHealth(context.Background(), connectionID, key, data)
}

func (c *controller) GetResourceEvents(pluginID, connectionID, key, id, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	provider, err := c.getProvider(pluginID)
	if err != nil {
		return nil, err
	}
	return provider.GetResourceEvents(context.Background(), connectionID, key, id, namespace, limit)
}

// ============================================================================
// Background Listeners
// ============================================================================

// listenForWatchEvents runs ListenForEvents with the engine sink.
// Blocks until ctx is cancelled or the stream errors.
func (c *controller) listenForWatchEvents(pluginID string, provider ResourceProvider, ctx context.Context, sink resource.WatchEventSink) {
	c.logger.Infow("watch event listener started", "pluginID", pluginID)
	err := provider.ListenForEvents(ctx, sink)
	if err != nil && ctx.Err() == nil {
		c.triggerCrashRecovery(pluginID, err, "watch")
	}
	c.logger.Infow("watch event listener stopped", "pluginID", pluginID)
}

// listenForConnectionEvents watches for external connection changes.
func (c *controller) listenForConnectionEvents(pluginID string, provider ResourceProvider, ctx context.Context) {
	c.logger.Infow("connection event listener started", "pluginID", pluginID)
	connStream := make(chan []types.Connection, 16)

	errCh := make(chan error, 1)
	go func() {
		errCh <- provider.WatchConnections(ctx, connStream)
	}()

	for {
		select {
		case <-ctx.Done():
			c.logger.Infow("connection event listener stopped", "pluginID", pluginID, "reason", "shutdown")
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
			c.connsMu.Lock()
			c.connections[pluginID] = mergeConnections(c.connections[pluginID], conns)
			c.connsMu.Unlock()

			eventKey := fmt.Sprintf("%s/connection/sync", pluginID)
			c.emitter.Emit(eventKey, conns)
		}
	}
}

// ============================================================================
// Error Handling
// ============================================================================

// isConnectionError returns true if the error indicates the plugin process is unreachable.
func isConnectionError(err error) bool {
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

// triggerCrashRecovery emits a crash event and invokes the crash callback once per plugin.
func (c *controller) triggerCrashRecovery(pluginID string, err error, listener string) {
	c.logger.Errorw("plugin event stream died — plugin process may have crashed",
		"pluginID", pluginID, "error", err, "listener", listener)

	c.emitter.Emit("plugin/crash", map[string]interface{}{
		"pluginID": pluginID,
		"error":    err.Error(),
	})

	c.pluginsMu.RLock()
	ps, ok := c.plugins[pluginID]
	c.pluginsMu.RUnlock()
	if ok && c.onCrashCallback != nil {
		ps.crashOnce.Do(func() { go c.onCrashCallback(pluginID) })
	}
}
