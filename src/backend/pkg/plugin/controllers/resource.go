package controllers

import (
	"encoding/gob"
	"fmt"
	"reflect"

	"github.com/hashicorp/go-plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcetypes "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"go.uber.org/zap"
)

const (
	StoreName  = "connections"
	PluginName = "resource"
)

// ResourceController is a controller that manages the lifecycle of resource plugins. Resource plugins
// interact with a backend that supplies various entities that can be read, created, updated, and deleted.
type ResourceController interface {
	ConnectedController
}

// Handles all of the client-side logic of resource plugins.
type resourceController struct {
	logger      *zap.SugaredLogger
	connections map[string][]types.Connection
	clients     map[string]resourcetypes.ResourceProvider
}

// NewResourceController returns a new ResourceController instance.
func NewResourceController(logger *zap.SugaredLogger) ResourceController {
	return &resourceController{
		logger:      logger.Named("ResourceController"),
		connections: make(map[string][]types.Connection),
		clients:     make(map[string]resourcetypes.ResourceProvider),
	}
}

// make sure we have a local store on disk to save and store the connections
// map, so we can load it up on start.
func (c *resourceController) saveToLocalStore(pluginID string) error {
	store, err := getStore(StoreName, pluginID)
	if err != nil {
		return err
	}
	defer store.Close()

	encoder := gob.NewEncoder(store)
	return encoder.Encode(c.connections)
}

// load the connections from the local store, initializing a new state if the
// file is empty.
func (c *resourceController) loadFromLocalStore(pluginID string) error {
	store, err := getStore(StoreName, pluginID)
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

func (c *resourceController) OnPluginInit(meta config.PluginMeta) {
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

func (c *resourceController) OnPluginStart(
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

func (c *resourceController) OnPluginStop(meta config.PluginMeta) error {
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

func (c *resourceController) OnPluginShutdown(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginShutdown")

	return c.OnPluginStop(meta)
}

func (c *resourceController) OnPluginDestroy(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginDestroy")

	// remove the local store file
	if err := removeStore(StoreName, meta.ID); err != nil {
		// log but don't fail
		logger.Errorw("failed to remove local store", "error", err)
	}
	return nil
}

func (c *resourceController) ListPlugins() ([]string, error) {
	c.logger.Debug("ListPlugins")

	panic("implement me")
}

func (c *resourceController) HasPlugin(pluginID string) bool {
	c.logger.Debug("HasPlugin")

	_, hasClient := c.clients[pluginID]
	return hasClient
}

func (c *resourceController) ListAllConnections() (map[string][]types.Connection, error) {
	c.logger.Debug("ListAllConnections")
	return c.connections, nil
}

func (c *resourceController) GetConnection(
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

func (c *resourceController) ListConnections(pluginID string) ([]types.Connection, error) {
	c.logger.Debug("ListConnections")
	connections, ok := c.connections[pluginID]
	if !ok {
		return nil, fmt.Errorf("plugin '%s' has no connections", pluginID)
	}
	return connections, nil
}

func (c *resourceController) AddConnection(pluginID string, connection types.Connection) error {
	c.logger.Debug("AddConnection")
	connections, ok := c.connections[pluginID]
	if !ok {
		connections = make([]types.Connection, 0)
	}
	c.connections[pluginID] = append(connections, connection)
	return nil
}

func (c *resourceController) UpdateConnection(pluginID string, connection types.Connection) error {
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

func (c *resourceController) RemoveConnection(pluginID, connectionID string) error {
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
