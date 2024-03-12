package sdk

import (
	"os"

	"github.com/hashicorp/go-plugin"

	"github.com/omniviewdev/plugin/pkg/config"
	pkgsettings "github.com/omniviewdev/plugin/pkg/settings"
)

const DefaultPluginMetaPath = "plugin.yaml"

// PluginOpts is the options for creating a new plugin.
type PluginOpts struct {
	// Settings is a list of settings to be used by the plugin
	Settings []interface{}

	// Debug is the debug mode for the plugin
	Debug bool
}

type Plugin struct {
	// settingsProvider is the settings provider for the plugin.
	settingsProvider pkgsettings.Provider

	// pluginMap is the map of plugins we can dispense. Each plugin entry in the map
	// is a plugin capability.
	pluginMap map[string]plugin.Plugin

	// meta holds metadata for the plugin, found inside of the plugin.yaml
	// file in the same directory as the plugin.
	meta config.PluginMeta
}

// NewPlugin creates a new plugin with the given configuration. This should be instantiated
// within your main function for your plugin and passed to the Register* functions to add
// capabilities to the plugin.
func NewPlugin(opts PluginOpts) *Plugin {
	// create io reader from the file
	file, err := os.Open(DefaultPluginMetaPath)
	if err != nil {
		if os.IsNotExist(err) {
			panic("plugin.yaml not found")
		}
		panic(err)
	}

	// load in the plugin configuration
	meta := config.PluginMeta{}
	if err = meta.Load(file); err != nil {
		panic(err)
	}

	return &Plugin{
		meta:             meta,
		pluginMap:        make(map[string]plugin.Plugin),
		settingsProvider: pkgsettings.NewSettingsProvider(opts.Settings),
	}
}

// registerCapability registers a plugin capability with the plugin system.
func (p *Plugin) registerCapability(capability string, registration plugin.Plugin) {
	if p == nil {
		panic("plugin cannot be nil when registering capability")
	}
	if capability == "" {
		panic("capability cannot be empty when registering capability")
	}
	// just to be safe, not really necessary
	if p.pluginMap == nil {
		p.pluginMap = make(map[string]plugin.Plugin)
	}

	p.pluginMap[capability] = registration
}

// Serve begins serving the plugin over the given RPC server. This should be called
// after all capabilities have been registered.
func (p *Plugin) Serve() {
	plugin.Serve(&plugin.ServeConfig{
		HandshakeConfig: p.meta.GenerateHandshakeConfig(),
		Plugins:         p.pluginMap,
	})
}
