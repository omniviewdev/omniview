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
	//
	// Nothing in the host calls this hook. Its contract is to run before the uninstall, which can still be rolled
	// back, and the settings and resource implementations delete more than credential-class state. An uninstall
	// calls PluginUninstallObserver instead, once it is durable.
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

// PluginUninstallObserver is implemented by controllers that keep state for a plugin outside its installation
// directory. The manager calls OnPluginUninstalled once per attempt, after the installation is disposed of for good:
// the installation directory and its staging are removed and the inventory is persisted. The uninstall's recovery
// marker is still in place, and is removed only once every observer has succeeded. It never runs for an uninstall
// that was rolled back, which can still happen before disposal begins.
//
// An implementation erases the credential-class state it holds for the plugin and releases state bound to the
// removed directory. It must not delete other state: an uninstall removes what the plugin directory holds and
// credential-class state, nothing else. A returned error keeps the uninstall incomplete: the plugin stays listed as
// failed, its ID cannot be installed again, and the host calls the hook again at its next start, before any plugin loads, and whenever the plugin is uninstalled again.
// The hook is therefore idempotent. The manager logs and shows only the class of an error, never its text, and an
// implementation keeps values out of its errors all the same.
type PluginUninstallObserver interface {
	OnPluginUninstalled(pluginID string) error
}
