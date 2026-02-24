package resource

import (
	"cmp"
	"context"
	"encoding/gob"
	"fmt"
	"reflect"
	"slices"
	"time"

	"github.com/hashicorp/go-plugin"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/settings"
)

const (
	StoreName  = "connections"
	PluginName = "resource"
)

// Controller is a controller that manages the lifecycle of resource plugins. Resource plugins
// interact with a backend that supplies various entities that can be read, created, updated, and deleted.
//
// Has to satisfy both the internal connected controller type, as well as the external client type.
type Controller interface {
	internaltypes.ConnectedController
	IClient
}

// runtime assertion to make sure we satisfy both internal and external interfaces.
var (
	_ Controller = (*controller)(nil)
	_ IClient    = (*controller)(nil)
)

// Handles all of the client-side logic of resource plugins.
type controller struct {
	// wails context
	ctx               context.Context
	logger            *zap.SugaredLogger
	settingsProvider  pkgsettings.Provider
	connections       map[string][]types.Connection
	clients           map[string]resourcetypes.ResourceProvider
	informerStopChans map[string]chan struct{}
	addChan           chan resourcetypes.InformerAddPayload
	updateChan        chan resourcetypes.InformerUpdatePayload
	deleteChan        chan resourcetypes.InformerDeletePayload
	stateChan         chan resourcetypes.InformerStateEvent
	connChan          chan resourcetypes.ConnectionControllerEvent
}

// NewController returns a new Controller instance.
func NewController(logger *zap.SugaredLogger, sp pkgsettings.Provider) Controller {
	return &controller{
		logger:            logger.Named("ResourceController"),
		settingsProvider:  sp,
		connections:       make(map[string][]types.Connection),
		clients:           make(map[string]resourcetypes.ResourceProvider),
		informerStopChans: make(map[string]chan struct{}),

		// informer channels
		addChan:    make(chan resourcetypes.InformerAddPayload),
		updateChan: make(chan resourcetypes.InformerUpdatePayload),
		deleteChan: make(chan resourcetypes.InformerDeletePayload),
		stateChan:  make(chan resourcetypes.InformerStateEvent),

		// connection update channels
		connChan: make(chan resourcetypes.ConnectionControllerEvent),
	}
}

// Runs the controller, setting up the context and starting the informer listener.
func (c *controller) Run(ctx context.Context) {
	c.ctx = ctx
	go c.informerListener()
	go c.connectionListener()
}

func (c *controller) connectionListener() {
	log := c.logger.Named("connectionListener")
	for {
		select {
		case <-c.ctx.Done():
			// shutting down
			log.Debugw("shutting down connection listeners")
			return
		case event := <-c.connChan:
			eventKey := fmt.Sprintf("%s/connection/sync", event.PluginID)
			runtime.EventsEmit(c.ctx, eventKey, event.Connections)
		}
	}
}

// Listens for informer events and emits them over the frontend IPC.
func (c *controller) informerListener() {
	log := c.logger.Named("informerListener")
	for {
		select {
		case <-c.ctx.Done():
			log.Debugw("shutting down informer listeners")
			for _, stopChan := range c.informerStopChans {
				stopChan <- struct{}{}
			}
			return
		case event := <-c.addChan:
			eventKey := fmt.Sprintf(
				"%s/%s/%s/ADD",
				event.PluginID,
				event.Connection,
				event.Key,
			)
			runtime.EventsEmit(c.ctx, eventKey, event)
		case event := <-c.updateChan:
			eventKey := fmt.Sprintf(
				"%s/%s/%s/UPDATE",
				event.PluginID,
				event.Connection,
				event.Key,
			)
			runtime.EventsEmit(c.ctx, eventKey, event)
		case event := <-c.deleteChan:
			eventKey := fmt.Sprintf(
				"%s/%s/%s/DELETE",
				event.PluginID,
				event.Connection,
				event.Key,
			)
			runtime.EventsEmit(c.ctx, eventKey, event)
		case event := <-c.stateChan:
			eventKey := fmt.Sprintf(
				"%s/%s/informer/STATE",
				event.PluginID,
				event.Connection,
			)
			runtime.EventsEmit(c.ctx, eventKey, event)
			// Global event for footer/status bar aggregation
			runtime.EventsEmit(c.ctx, "informer/STATE", event)
		}
	}
}

// make sure we have a local store on disk to save and store the connections
// map, so we can load it up on start.
func (c *controller) saveToLocalStore(pluginID string) error {
	gob.Register(map[string]interface{}{})
	store, err := utils.GetStore(StoreName, pluginID)
	if err != nil {
		return err
	}
	defer store.Close()

	encoder := gob.NewEncoder(store)
	return encoder.Encode(c.connections)
}

// load the connections from the local store, initializing a new state if the
// file is empty.
func (c *controller) loadFromLocalStore(pluginID string) error {
	gob.Register(map[string]interface{}{})
	store, err := utils.GetStore(StoreName, pluginID)
	if err != nil {
		return err
	}
	defer store.Close()

	// Check if the file is empty by trying to read a single byte
	fileInfo, err := store.Stat()
	if err != nil {
		return err // Unable to obtain file stats
	}

	// nothing to decode if the file is empty
	if fileInfo.Size() == 0 {
		c.logger.Debugw("store file is empty, initializing new state", "pluginID", pluginID)
		if c.connections == nil {
			c.connections = make(map[string][]types.Connection)
		}

		encoder := gob.NewEncoder(store)
		return encoder.Encode(c.connections)
	}

	var state map[string][]types.Connection

	// proceed with decoding since the file is not empty
	decoder := gob.NewDecoder(store)
	err = decoder.Decode(&state)
	if err != nil {
		return err
	}

	for id, plugin := range state {
		loaded := make([]types.Connection, 0, len(plugin))
		for _, conn := range plugin {
			// ensure we don't accidently load and say we're connected, because we're not
			conn.LastRefresh = time.Time{}
			loaded = append(loaded, conn)
		}
		state[id] = loaded
	}

	c.connections = state
	return nil
}

func (c *controller) OnPluginInit(meta config.PluginMeta) {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginInit")

	// make sure we have our maps initialized
	if c.connections == nil {
		c.connections = make(map[string][]types.Connection)
	}
	if c.clients == nil {
		c.clients = make(map[string]resourcetypes.ResourceProvider)
	}

	// load up the connections from the local store
	if err := c.loadFromLocalStore(meta.ID); err != nil {
		logger.Errorw("failed to load connections from local store", "error", err)
	}

	// if we have no connections, make sure we initialize the map
	// with empty slices, and attempt to load connections from the plugin
	if _, ok := c.connections[meta.ID]; !ok {
		c.connections[meta.ID] = make([]types.Connection, 0)
	}
}

func (c *controller) OnPluginStart(
	meta config.PluginMeta,
	client plugin.ClientProtocol,
) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStart")

	// make sure we have a client we can call for this plugin
	raw, err := client.Dispense(PluginName)
	if err != nil {
		return err
	}

	resourceClient, ok := raw.(resourcetypes.ResourceProvider)
	if !ok {
		// get the type for for debugging/error
		typeOfClient := reflect.TypeOf(raw).String()
		return apperror.New(
			apperror.TypePluginLoadFailed, 500,
			"Plugin type mismatch",
			fmt.Sprintf("Expected ResourceProvider but got '%s'.", typeOfClient),
		)
	}

	c.clients[meta.ID] = resourceClient

	// start running informer receivers
	stopChan := make(chan struct{})

	// try to load the connections from the plugin, start connection watcher
	if conns, err := c.LoadConnections(meta.ID); err != nil {
		logger.Errorw("failed to load connections from plugin", "error", err)
	} else if len(conns) > 0 {
		eventKey := fmt.Sprintf("%s/connection/sync", meta.ID)
		runtime.EventsEmit(c.ctx, eventKey, c.connections[meta.ID])
	}
	go c.listenForPluginConnectionEvents(
		meta.ID,
		resourceClient,
		stopChan,
		c.connChan,
	)

	c.informerStopChans[meta.ID] = stopChan
	go c.listenForPluginInformerEvents(
		meta.ID,
		resourceClient,
		stopChan,
		c.addChan,
		c.updateChan,
		c.deleteChan,
		c.stateChan,
	)
	return nil
}

func (c *controller) OnPluginStop(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStop")

	// make sure we backup the connections to the local store
	if err := c.saveToLocalStore(meta.ID); err != nil {
		// log but don't fail
		logger.Errorw("failed to save connections to local store", "error", err)
	}

	delete(c.clients, meta.ID)
	delete(c.connections, meta.ID)

	return nil
}

func (c *controller) OnPluginShutdown(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginShutdown")

	return c.OnPluginStop(meta)
}

func (c *controller) OnPluginDestroy(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginDestroy")

	// remove the local store file
	if err := utils.RemoveStore(StoreName, meta.ID); err != nil {
		// log but don't fail
		logger.Errorw("failed to remove local store", "error", err)
	}
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	c.logger.Debug("ListPlugins")

	plugins := make([]string, 0, len(c.clients))
	for pluginID := range c.clients {
		plugins = append(plugins, pluginID)
	}

	return plugins, nil
}

func (c *controller) HasPlugin(pluginID string) bool {
	c.logger.Debug("HasPlugin")

	_, hasClient := c.clients[pluginID]
	return hasClient
}

func mergeConnections(
	connections []types.Connection,
	newConnections []types.Connection,
) []types.Connection {
	// perform a merge of the connections, deduplicating by ID
	merged := make(map[string]types.Connection)
	for _, conn := range connections {
		merged[conn.ID] = conn
	}
	for _, conn := range newConnections {
		merged[conn.ID] = conn
	}

	list := make([]types.Connection, 0, len(merged))
	for _, conn := range merged {
		list = append(list, conn)
	}

	return list
}

// ================================== CONNECTION METHODS ================================== //

func (c *controller) StartConnection(
	pluginID, connectionID string,
) (types.ConnectionStatus, error) {
	c.logger.Debug("StartConnection")
	client, ok := c.clients[pluginID]
	if !ok {
		return types.ConnectionStatus{}, apperror.PluginNotFound(pluginID)
	}
	ctx := c.unconnectedCtx()
	conn, err := client.StartConnection(ctx, connectionID)
	if err != nil {
		return types.ConnectionStatus{}, err
	}
	if conn.Status != types.ConnectionStatusConnected {
		return conn, nil
	}

	// purposely don't write to state, we're not trying to persist realtime connection state, just
	// the connection
	if conn.Connection != nil {
		c.connections[pluginID] = mergeConnections(
			c.connections[pluginID],
			[]types.Connection{*conn.Connection},
		)
	}

	// Emit connection status event for the frontend footer indicator
	connName := connectionID
	if conn.Connection != nil && conn.Connection.Name != "" {
		connName = conn.Connection.Name
	}
	runtime.EventsEmit(c.ctx, "connection/status", map[string]interface{}{
		"pluginID":     pluginID,
		"connectionID": connectionID,
		"status":       string(conn.Status),
		"name":         connName,
	})

	return conn, nil
}

func (c *controller) StopConnection(pluginID, connectionID string) (types.Connection, error) {
	log := c.logger.Named("StopConnection").With("pluginID", pluginID, "connectionID", connectionID)
	client, ok := c.clients[pluginID]
	if !ok {
		log.Error("plugin not found")
		return types.Connection{}, apperror.PluginNotFound(pluginID)
	}
	ctx := c.unconnectedCtx()
	conn, err := client.StopConnection(ctx, connectionID)
	if err != nil {
		return types.Connection{}, err
	}

	c.connections[pluginID] = mergeConnections(c.connections[pluginID], []types.Connection{conn})

	// Emit connection status event for the frontend footer indicator
	runtime.EventsEmit(c.ctx, "connection/status", map[string]interface{}{
		"pluginID":     pluginID,
		"connectionID": connectionID,
		"status":       "DISCONNECTED",
		"name":         conn.Name,
	})

	return conn, nil
}

func (c *controller) LoadConnections(pluginID string) ([]types.Connection, error) {
	log := c.logger.Named("LoadConnections").With("pluginID", pluginID)
	log.Debug("calling LoadConnections")

	client, ok := c.clients[pluginID]
	if !ok {
		log.Error("plugin not found")
		return nil, apperror.PluginNotFound(pluginID)
	}

	ctx := c.unconnectedCtx()

	log.Debug("loading connections from plugin")
	connections, err := client.LoadConnections(ctx)
	if err != nil {
		log.Errorw("failed to load connections from plugin", "error", err)
		return nil, err
	}

	log.Debug("loaded connections from backend", "count", len(connections))

	// writethrough to local state
	c.connections[pluginID] = mergeConnections(c.connections[pluginID], connections)
	c.saveToLocalStore(pluginID)
	return connections, nil
}

func (c *controller) ListConnections(pluginID string) ([]types.Connection, error) {
	log := c.logger.Named("ListConnections").With("pluginID", pluginID)
	log.Debug("calling ListConnections")

	connections, ok := c.connections[pluginID]
	if !ok {
		return nil, apperror.New(apperror.TypeConnectionNotFound, 404, "No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	slices.SortFunc(connections,
		func(a, b types.Connection) int {
			return cmp.Compare(a.Name, b.Name)
		})

	return connections, nil
}

func (c *controller) ListAllConnections() (map[string][]types.Connection, error) {
	c.logger.Debug("ListAllConnections")
	return c.connections, nil
}

func (c *controller) GetConnection(
	pluginID, connectionID string,
) (types.Connection, error) {
	connections, ok := c.connections[pluginID]
	if !ok {
		return types.Connection{}, apperror.New(apperror.TypeConnectionNotFound, 404, "No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	for _, conn := range connections {
		if conn.ID == connectionID {
			return conn, nil
		}
	}
	return types.Connection{}, apperror.ConnectionNotFound(pluginID, connectionID)
}

func (c *controller) GetConnectionNamespaces(
	pluginID, connectionID string,
) ([]string, error) {
	c.logger.Debug("GetConnectionNamespaces")
	client, ok := c.clients[pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}

	connections, ok := c.connections[pluginID]
	if !ok {
		return nil, apperror.New(apperror.TypeConnectionNotFound, 404, "No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	// find the connection
	found := false
	var connection types.Connection
	for _, conn := range connections {
		if conn.ID == connectionID {
			connection = conn
			found = true
			break
		}
	}

	if !found {
		return nil, apperror.ConnectionNotFound(pluginID, connectionID)
	}

	ctx := c.connectedCtx(&connection)
	return client.GetConnectionNamespaces(ctx, connectionID)
}

func (c *controller) AddConnection(pluginID string, connection types.Connection) error {
	c.logger.Debug("AddConnection")
	connections, ok := c.connections[pluginID]
	if !ok {
		connections = make([]types.Connection, 0)
	}
	c.connections[pluginID] = append(connections, connection)
	return nil
}

func (c *controller) UpdateConnection(
	pluginID string,
	connection types.Connection,
) (types.Connection, error) {
	c.logger.Debug("UpdateConnection")
	connections, ok := c.connections[pluginID]
	if !ok {
		return types.Connection{}, apperror.New(apperror.TypeConnectionNotFound, 404, "No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	for i, conn := range connections {
		if conn.ID == connection.ID {
			connections[i] = connection
			return connection, nil
		}
	}
	return types.Connection{}, apperror.ConnectionNotFound(pluginID, connection.ID)
}

func (c *controller) RemoveConnection(pluginID, connectionID string) error {
	c.logger.Debug("RemoveConnection")
	connections, ok := c.connections[pluginID]
	if !ok {
		return apperror.New(apperror.TypeConnectionNotFound, 404, "No connections", fmt.Sprintf("Plugin '%s' has no connections configured.", pluginID))
	}
	for i, conn := range connections {
		if conn.ID == connectionID {
			c.connections[pluginID] = slices.Delete(connections, i, i+1)
			return nil
		}
	}
	return apperror.ConnectionNotFound(pluginID, connectionID)
}

// ================================== CONTEXT HELPERS ================================== //

func (c *controller) connectedCtx(conn *types.Connection) *types.PluginContext {
	return types.NewPluginContextWithConnection(context.Background(), "CORE", nil, nil, conn)
}

func (c *controller) unconnectedCtx() *types.PluginContext {
	return types.NewPluginContext(context.Background(), "CORE", nil, nil, nil)
}

// ================================== CLIENT METHODS ================================== //

func (c *controller) getClientConnection(
	pluginID, connectionID string,
) (resourcetypes.ResourceProvider, types.Connection, error) {
	client, ok := c.clients[pluginID]
	if !ok {
		return nil, types.Connection{}, apperror.PluginNotFound(pluginID)
	}
	conn, err := c.GetConnection(pluginID, connectionID)
	if err != nil {
		return nil, types.Connection{}, err
	}

	return client, conn, nil
}

func (c *controller) Get(
	pluginID, connectionID, key string,
	input resourcetypes.GetInput,
) (*resourcetypes.GetResult, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("Get")

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}

	ctx := c.connectedCtx(&conn)
	return client.Get(ctx, key, input)
}

func (c *controller) List(
	pluginID, connectionID, key string,
	input resourcetypes.ListInput,
) (*resourcetypes.ListResult, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("List", "key", key, "input", input)

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}

	ctx := c.connectedCtx(&conn)
	return client.List(ctx, key, input)
}

func (c *controller) Find(
	pluginID, connectionID, key string,
	input resourcetypes.FindInput,
) (*resourcetypes.FindResult, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("Find", "key", key, "input", input)

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}

	ctx := c.connectedCtx(&conn)
	return client.Find(ctx, key, input)
}

func (c *controller) Create(
	pluginID, connectionID, key string,
	input resourcetypes.CreateInput,
) (*resourcetypes.CreateResult, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("Create", "key", key, "input", input)

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}

	ctx := c.connectedCtx(&conn)
	return client.Create(ctx, key, input)
}

func (c *controller) Update(
	pluginID, connectionID, key string,
	input resourcetypes.UpdateInput,
) (*resourcetypes.UpdateResult, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("Update", "key", key, "input", input)

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	ctx := c.connectedCtx(&conn)
	return client.Update(ctx, key, input)
}

func (c *controller) Delete(
	pluginID, connectionID, key string,
	input resourcetypes.DeleteInput,
) (*resourcetypes.DeleteResult, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debugw("Delete", "key", key, "input", input)

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}
	ctx := c.connectedCtx(&conn)
	return client.Delete(ctx, key, input)
}

func (c *controller) StartConnectionInformer(pluginID, connectionID string) error {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("StartConnectionInformer")

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return err
	}

	ctx := c.connectedCtx(&conn)
	return client.StartConnectionInformer(ctx, connectionID)
}

func (c *controller) StopConnectionInformer(pluginID, connectionID string) error {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("StopConnectionInformer")

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return err
	}

	ctx := c.connectedCtx(&conn)
	return client.StopConnectionInformer(ctx, connectionID)
}

// ================================== RESOURCE TYPE METHODS ================================== //

func (c *controller) GetResourceGroups(
	pluginID, connectionID string,
) map[string]resourcetypes.ResourceGroup {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("GetResourceGroups")
	client, ok := c.clients[pluginID]
	if !ok {
		logger.Error("plugin not found")
		return nil
	}
	return client.GetResourceGroups(connectionID)
}

func (c *controller) GetResourceGroup(
	pluginID, groupID string,
) (resourcetypes.ResourceGroup, error) {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("GetResourceGroup")
	client, ok := c.clients[pluginID]
	if !ok {
		return resourcetypes.ResourceGroup{}, apperror.PluginNotFound(pluginID)
	}
	return client.GetResourceGroup(groupID)
}

func (c *controller) GetResourceTypes(
	pluginID, connectionID string,
) map[string]resourcetypes.ResourceMeta {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("GetResourceTypes")

	client, ok := c.clients[pluginID]
	if !ok {
		logger.Error("plugin not found")
		return nil
	}
	return client.GetResourceTypes(connectionID)
}

func (c *controller) GetResourceType(
	pluginID, resourceType string,
) (*resourcetypes.ResourceMeta, error) {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("GetResourceType")

	client, ok := c.clients[pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}
	return client.GetResourceType(resourceType)
}

func (c *controller) HasResourceType(pluginID, resourceType string) bool {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("HasResourceType")

	client, ok := c.clients[pluginID]
	if !ok {
		return false
	}
	return client.HasResourceType(resourceType)
}

func (c *controller) GetResourceDefinition(
	pluginID, resourceType string,
) (resourcetypes.ResourceDefinition, error) {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("GetResourceDefinition")

	client, ok := c.clients[pluginID]
	if !ok {
		return resourcetypes.ResourceDefinition{}, apperror.PluginNotFound(pluginID)
	}
	return client.GetResourceDefinition(resourceType)
}

// ================================== LAYOUT METHODS ================================== //

func (c *controller) GetLayout(pluginID, layoutID string) ([]resourcetypes.LayoutItem, error) {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("GetLayout")
	client, ok := c.clients[pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}
	return client.GetLayout(layoutID)
}

func (c *controller) GetDefaultLayout(pluginID string) ([]resourcetypes.LayoutItem, error) {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("GetDefaultLayout")
	client, ok := c.clients[pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}
	return client.GetDefaultLayout()
}

func (c *controller) SetLayout(
	pluginID string,
	layoutID string,
	layout []resourcetypes.LayoutItem,
) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("SetLayout")
	client, ok := c.clients[pluginID]
	if !ok {
		return apperror.PluginNotFound(pluginID)
	}
	return client.SetLayout(layoutID, layout)
}

// ================================== SCHEMA METHODS ================================== //

func (c *controller) GetEditorSchemas(
	pluginID, connectionID string,
) ([]resourcetypes.EditorSchema, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("GetEditorSchemas")

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}

	ctx := c.connectedCtx(&conn)
	return client.GetEditorSchemas(ctx, connectionID)
}

// ================================== ACTION METHODS ================================== //

func (c *controller) GetActions(
	pluginID, connectionID, key string,
) ([]resourcetypes.ActionDescriptor, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("GetActions")

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}

	ctx := c.connectedCtx(&conn)
	return client.GetActions(ctx, key)
}

func (c *controller) ExecuteAction(
	pluginID, connectionID, key, actionID string,
	input resourcetypes.ActionInput,
) (*resourcetypes.ActionResult, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("ExecuteAction", "key", key, "actionID", actionID)

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}

	ctx := c.connectedCtx(&conn)
	return client.ExecuteAction(ctx, key, actionID, input)
}

// ================================== INFORMER STATE METHODS ================================== //

func (c *controller) GetInformerState(
	pluginID, connectionID string,
) (*resourcetypes.InformerConnectionSummary, error) {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("GetInformerState")

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return nil, err
	}

	ctx := c.connectedCtx(&conn)
	return client.GetInformerState(ctx, connectionID)
}

func (c *controller) EnsureInformerForResource(
	pluginID, connectionID, resourceKey string,
) error {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID, "resourceKey", resourceKey)
	logger.Debug("EnsureInformerForResource")

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		return err
	}

	ctx := c.connectedCtx(&conn)
	return client.EnsureInformerForResource(ctx, connectionID, resourceKey)
}

// ================================== INFORMER METHODS ================================== //

// listenForPluginInformerEvents listens for events from the plugin in a blocking event
// loop, and emits them to the controller. this should be run in a goroutine.
func (c *controller) listenForPluginInformerEvents(
	pluginID string,
	client resourcetypes.ResourceProvider,
	stopChan <-chan struct{},
	addChan chan resourcetypes.InformerAddPayload,
	updateChan chan resourcetypes.InformerUpdatePayload,
	deleteChan chan resourcetypes.InformerDeletePayload,
	stateChan chan resourcetypes.InformerStateEvent,
) {
	l := c.logger.With("pluginID", pluginID)
	l.Debug("listenForPluginInformerEvents")

	ctx := c.unconnectedCtx()

	addStream := make(chan resourcetypes.InformerAddPayload)
	updateStream := make(chan resourcetypes.InformerUpdatePayload)
	deleteStream := make(chan resourcetypes.InformerDeletePayload)
	stateStream := make(chan resourcetypes.InformerStateEvent)

	errChan := make(chan error)

	go func(errChan chan error) {
		if err := client.ListenForEvents(ctx, addStream, updateStream, deleteStream, stateStream); err != nil {
			l.Errorw("failed to listen for events", "error", err)
			errChan <- err
			return
		}
	}(errChan)

	for {
		select {
		case <-errChan:
			return
		case <-stopChan:
			return
		case event := <-addStream:
			event.PluginID = pluginID
			addChan <- event
		case event := <-updateStream:
			event.PluginID = pluginID
			updateChan <- event
		case event := <-deleteStream:
			event.PluginID = pluginID
			deleteChan <- event
		case event := <-stateStream:
			event.PluginID = pluginID
			stateChan <- event
		}
	}
}

// listenForPluginEvents listens for events from the plugin in a blocking event
// loop, and emits them to the controller. this should be run in a goroutine.
func (c *controller) listenForPluginConnectionEvents(
	pluginID string,
	client resourcetypes.ResourceProvider,
	stopChan <-chan struct{},
	eventChan chan resourcetypes.ConnectionControllerEvent,
) {
	l := c.logger.With("pluginID", pluginID)
	l.Debug("listenForPluginConnectionEvents")

	ctx := c.unconnectedCtx()
	connStream := make(chan []types.Connection)
	errChan := make(chan error)

	go func(errChan chan error) {
		if err := client.WatchConnections(ctx, connStream); err != nil {
			l.Errorw("failed to listen for connection events", "error", err)
			errChan <- err
			return
		}
	}(errChan)

	for {
		select {
		case <-errChan:
			return
		case <-stopChan:
			return
		case event := <-connStream:
			eventChan <- resourcetypes.ConnectionControllerEvent{
				PluginID:    pluginID,
				Connections: event,
			}
		}
	}
}
