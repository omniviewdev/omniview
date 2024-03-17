package resource

import (
	"context"
	"encoding/gob"
	"fmt"
	"reflect"

	"github.com/hashicorp/go-plugin"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.uber.org/zap"
)

const (
	StoreName  = "connections"
	PluginName = "resource"
)

// Controller is a controller that manages the lifecycle of resource plugins. Resource plugins
// interact with a backend that supplies various entities that can be read, created, updated, and deleted.
//
// Has to satisfy both the internal connected controller type, as well as the external client type
type Controller interface {
	internaltypes.ConnectedController
	IClient
}

// runtime assertion to make sure we satisfy both internal and external interfaces
var (
	_ Controller = (*controller)(nil)
	_ IClient    = (*controller)(nil)
)

// Handles all of the client-side logic of resource plugins.
type controller struct {
	logger      *zap.SugaredLogger
	connections map[string][]types.Connection
	clients     map[string]resourcetypes.ResourceProvider
}

// NewController returns a new Controller instance.
func NewController(logger *zap.SugaredLogger) Controller {
	return &controller{
		logger:      logger.Named("Controller"),
		connections: make(map[string][]types.Connection),
		clients:     make(map[string]resourcetypes.ResourceProvider),
	}
}

// make sure we have a local store on disk to save and store the connections
// map, so we can load it up on start.
func (c *controller) saveToLocalStore(pluginID string) error {
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

	// proceed with decoding since the file is not empty
	decoder := gob.NewDecoder(store)
	err = decoder.Decode(&c.connections)
	if err != nil {
		return err
	}

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
		err = fmt.Errorf(
			"could not start plugin: expected ResourceProvider but got '%s'",
			typeOfClient,
		)
		logger.Error(err)
		return err
	}

	c.clients[meta.ID] = resourceClient
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

	panic("implement me")
}

func (c *controller) HasPlugin(pluginID string) bool {
	c.logger.Debug("HasPlugin")

	_, hasClient := c.clients[pluginID]
	return hasClient
}

func (c *controller) LoadConnections(pluginID string) ([]types.Connection, error) {
	c.logger.Debug("LoadConnections")

	client, ok := c.clients[pluginID]
	if !ok {
		return nil, fmt.Errorf("plugin '%s' not found", pluginID)
	}

	return client.LoadConnections(nil)
}

func (c *controller) ListAllConnections() (map[string][]types.Connection, error) {
	c.logger.Debug("ListAllConnections")
	return c.connections, nil
}

func (c *controller) GetConnection(
	pluginID, connectionID string,
) (types.Connection, error) {
	c.logger.Debug("GetConnection")
	connections, ok := c.connections[pluginID]
	if !ok {
		return types.Connection{}, fmt.Errorf("plugin '%s' has no connections", pluginID)
	}
	for _, conn := range connections {
		if conn.ID == connectionID {
			return conn, nil
		}
	}
	return types.Connection{}, fmt.Errorf(
		"connection '%s' not found for plugin '%s'",
		connectionID,
		pluginID,
	)
}

func (c *controller) ListConnections(pluginID string) ([]types.Connection, error) {
	c.logger.Debug("ListConnections")
	connections, ok := c.connections[pluginID]
	if !ok {
		return nil, fmt.Errorf("plugin '%s' has no connections", pluginID)
	}
	return connections, nil
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

func (c *controller) UpdateConnection(pluginID string, connection types.Connection) error {
	c.logger.Debug("UpdateConnection")
	connections, ok := c.connections[pluginID]
	if !ok {
		return fmt.Errorf("plugin '%s' has no connections", pluginID)
	}
	for i, conn := range connections {
		if conn.ID == connection.ID {
			connections[i] = connection
			return nil
		}
	}
	return fmt.Errorf("connection '%s' not found for plugin '%s'", connection.ID, pluginID)
}

func (c *controller) RemoveConnection(pluginID, connectionID string) error {
	c.logger.Debug("RemoveConnection")
	connections, ok := c.connections[pluginID]
	if !ok {
		return fmt.Errorf("plugin '%s' has no connections", pluginID)
	}
	for i, conn := range connections {
		if conn.ID == connectionID {
			c.connections[pluginID] = append(connections[:i], connections[i+1:]...)
			return nil
		}
	}
	return fmt.Errorf("connection '%s' not found for plugin '%s'", connectionID, pluginID)
}

// ================================== CLIENT METHODS ================================== //

func (c *controller) getClientConnection(
	pluginID, connectionID string,
) (resourcetypes.ResourceProvider, types.Connection, error) {
	client, ok := c.clients[pluginID]
	if !ok {
		return nil, types.Connection{}, fmt.Errorf("plugin '%s' not found", pluginID)
	}
	conn, err := c.GetConnection(pluginID, connectionID)
	if err != nil {
		return nil, types.Connection{}, fmt.Errorf(
			"connection '%s' not found for plugin '%s'",
			connectionID,
			pluginID,
		)
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
		err = fmt.Errorf("failed to call GET for connection: %w", err)
		logger.Error(err)
		return nil, err
	}

	ctx := types.NewPluginContextWithConnection(
		context.Background(),
		"CORE",
		nil, // TODO: PluginConfig - fill this in
		nil, // TODO: GlobalConfig - fill this in
		&conn,
	)

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
		err = fmt.Errorf("failed to call LIST for connection: %w", err)
		logger.Error(err)
		return nil, err
	}

	ctx := types.NewPluginContextWithConnection(
		context.Background(),
		"CORE",
		nil, // TODO: PluginConfig - fill this in
		nil, // TODO: GlobalConfig - fill this in
		&conn,
	)
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
		err = fmt.Errorf("failed to call FIND for connection: %w", err)
		logger.Error(err)
		return nil, err
	}

	ctx := types.NewPluginContextWithConnection(
		context.Background(),
		"CORE",
		nil, // TODO: PluginConfig - fill this in
		nil, // TODO: GlobalConfig - fill this in
		&conn,
	)
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
		err = fmt.Errorf("failed to call CREATE for connection: %w", err)
		logger.Error(err)
		return nil, err
	}

	ctx := types.NewPluginContextWithConnection(
		context.Background(),
		"CORE",
		nil, // TODO: PluginConfig - fill this in
		nil, // TODO: GlobalConfig - fill this in
		&conn,
	)
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
		err = fmt.Errorf("failed to call UPDATE for connection: %w", err)
		logger.Error(err)
		return nil, err
	}
	ctx := types.NewPluginContextWithConnection(
		context.Background(),
		"CORE",
		nil, // TODO: PluginConfig - fill this in
		nil, // TODO: GlobalConfig - fill this in
		&conn,
	)
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
		err = fmt.Errorf("failed to call DELETE for connection: %w", err)
		logger.Error(err)
		return nil, err
	}
	ctx := types.NewPluginContextWithConnection(
		context.Background(),
		"CORE",
		nil, // TODO: PluginConfig - fill this in
		nil, // TODO: GlobalConfig - fill this in
		&conn,
	)
	return client.Delete(ctx, key, input)
}

func (c *controller) StartConnectionInformer(pluginID, connectionID string) error {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("StartConnectionInformer")

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		err = fmt.Errorf("failed to start informer for connection: %w", err)
		logger.Error(err)
		return err
	}

	ctx := types.NewPluginContextWithConnection(
		context.Background(),
		"CORE",
		nil, // TODO: PluginConfig - fill this in
		nil, // TODO: GlobalConfig - fill this in
		&conn,
	)
	return client.StartContextInformer(ctx, connectionID)
}

func (c *controller) StopConnectionInformer(pluginID, connectionID string) error {
	logger := c.logger.With("pluginID", pluginID, "connectionID", connectionID)
	logger.Debug("StopConnectionInformer")

	client, conn, err := c.getClientConnection(pluginID, connectionID)
	if err != nil {
		err = fmt.Errorf("failed to stop informer for connection: %w", err)
		logger.Error(err)
		return err
	}

	ctx := types.NewPluginContextWithConnection(
		context.Background(),
		"CORE",
		nil, // TODO: PluginConfig - fill this in
		nil, // TODO: GlobalConfig - fill this in
		&conn,
	)
	return client.StopContextInformer(ctx, connectionID)
}
