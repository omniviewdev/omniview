package types

import (
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// LifecycleController is the manager-facing plugin lifecycle only. Resource
// services carry host invocation contexts independently of other capabilities.
type LifecycleController interface {
	// OnPluginInit is called after the plugin is loaded in to do any pre-startup initialization.
	OnPluginInit(pluginID string, meta config.PluginMeta)

	// OnPluginStart is called when the plugin is started.
	OnPluginStart(pluginID string, meta config.PluginMeta, backend PluginBackend) error

	// OnPluginStop is called when the plugin is stopped. Modules should perform any persisting of state here
	OnPluginStop(pluginID string, meta config.PluginMeta) error

	// OnPluginShutdown is called when the plugin is shutdown. This is the last chance to clean up any resources
	// before the IDE is closed.
	OnPluginShutdown(pluginID string, meta config.PluginMeta) error

	// OnPluginDestroy is called when the plugin is being removed from the system. This is the last chance to
	// clean up any resources associated with the plugin before it is uninstalled.
	OnPluginDestroy(pluginID string, meta config.PluginMeta) error
}

// Controller adds the current connectionless capability discovery surface.
type Controller interface {
	LifecycleController

	// ListPlugins returns a list of names of the plugins that are installed.
	ListPlugins() ([]string, error)

	// HasPlugin returns true if the plugin is registered with this controller.
	HasPlugin(pluginID string) bool
}
