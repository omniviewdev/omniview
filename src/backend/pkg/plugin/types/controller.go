package types

import (
	"github.com/hashicorp/go-plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Controller manages the lifecycle of a plugin type. Controllers can embed many managers to take care of different
// tasks, but at the base must implement the Controller interface.
type Controller interface {
	// OnPluginInit is called after the plugin is loaded in to do any pre-startup initialization.
	OnPluginInit(meta config.PluginMeta)

	// OnPluginStart is called when the plugin is started.
	OnPluginStart(meta config.PluginMeta, client plugin.ClientProtocol) error

	// OnPluginStop is called when the plugin is stopped. Modules should perform any persisting of state here
	OnPluginStop(meta config.PluginMeta) error

	// OnPluginShutdown is called when the plugin is shutdown. This is the last chance to clean up any resources
	// before the IDE is closed.
	OnPluginShutdown(meta config.PluginMeta) error

	// OnPluginDestroy is called when the plugin is being removed from the system. This is the last chance to
	// clean up any resources associated with the plugin before it is uninstalled.
	OnPluginDestroy(meta config.PluginMeta) error

	// ListPlugins returns a list of names of the plugins that are installed.
	ListPlugins() ([]string, error)

	// HasPlugin returns true if the plugin is registered with this controller.
	HasPlugin(pluginID string) bool
}

// ConnectedControllers work with plugins that have connections to backend resources. This is a superset of the
// Controller interface, with additional requirements for when events relating to connections occur.
type ConnectedController interface {
	Controller

	// LoadConnections loads the connections for the resource provider
	LoadConnections(pluginID string) ([]types.Connection, error)

	// ListAllConnections returns a list of all connections for all plugins.
	ListAllConnections() (map[string][]types.Connection, error)

	// GetConnection returns a connection for a plugin by ID.
	GetConnection(pluginID, connectionID string) (types.Connection, error)

	// ListPluginConnections returns a list of connections for the plugin.
	ListConnections(pluginID string) ([]types.Connection, error)

	// AddConnection adds a new connection for the plugin.
	AddConnection(pluginID string, connection types.Connection) error

	// UpdateConnection updates an existing connection for a plugin
	UpdateConnection(pluginID string, connection types.Connection) error

	// RemoveConnection removes a connection for a plugin
	RemoveConnection(pluginID, connectionID string) error
}
