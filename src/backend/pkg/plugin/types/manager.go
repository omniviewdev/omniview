package types

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// PluginManager must fulfil handling the event that happen during the plugin lifecycle.
type PluginManager interface {
	// OnPluginInit is called after the plugin is loaded in to do any pre-startup initialization.
	OnPluginInit(context.Context, config.PluginMeta) error

	// OnPluginStart is called when the plugin is started.
	OnPluginStart(context.Context, config.PluginMeta) error

	// OnPluginStop is called when the plugin is stopped. Modules should perform any persisting of state here
	OnPluginStop(context.Context, config.PluginMeta) error

	// OnPluginShutdown is called when the plugin is shutdown. This is the last chance to clean up any resources
	// before the IDE is closed.
	OnPluginShutdown(context.Context, config.PluginMeta) error

	// OnPluginDestroy is called when the plugin is being removed from the system. This is the last chance to
	// clean up any resources associated with the plugin before it is uninstalled.
	OnPluginDestroy(context.Context, config.PluginMeta) error
}
