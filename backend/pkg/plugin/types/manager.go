package types

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// PluginManager must fulfil handling the event that happen during the plugin lifecycle.
type PluginManager interface {
	// OnPluginInit is called after the plugin is loaded in to do any pre-startup initialization.
	OnPluginInit(ctx context.Context, pluginID string, meta config.PluginMeta) error

	// OnPluginStart is called when the plugin is started.
	OnPluginStart(ctx context.Context, pluginID string, meta config.PluginMeta) error

	// OnPluginStop is called when the plugin is stopped. Modules should perform any persisting of state here
	OnPluginStop(ctx context.Context, pluginID string, meta config.PluginMeta) error

	// OnPluginShutdown is called when the plugin is shutdown. This is the last chance to clean up any resources
	// before the IDE is closed.
	OnPluginShutdown(ctx context.Context, pluginID string, meta config.PluginMeta) error

	// OnPluginDestroy is called when the plugin is being removed from the system. This is the last chance to
	// clean up any resources associated with the plugin before it is uninstalled.
	OnPluginDestroy(ctx context.Context, pluginID string, meta config.PluginMeta) error
}

// BuildOpts specifies how a plugin should be built.
type BuildOpts struct {
	// ExcludeBackend tells the builder to not build the plugin binary. This is useful
	// when we only have changes to UI components.
	ExcludeBackend bool

	// ExcludeUI tells the builder to not rebuild the plugin UI. This is useful
	// when we only have changes to the plugin binary.
	ExcludeUI bool

	// GoPath defines a predefined path to the Go binary
	GoPath string

	// PnpmPath defines a predefined path to the PNPM binary
	PnpmPath string

	// NodePath defines a predefined path to the Node binary
	NodePath string
}
