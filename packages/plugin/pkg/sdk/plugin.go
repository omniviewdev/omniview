package sdk

import (
	"embed"

	"github.com/hashicorp/go-plugin"

	"github.com/omniviewdev/plugin/pkg/types"
)

type Plugin struct {
	// pluginMap is the map of plugins we can dispense. Each plugin entry in the map
	// is a plugin capability
	pluginMap map[string]plugin.Plugin
	// config is the configuration for the plugin implementation
	config types.PluginConfig
}

// NewPlugin creates a new plugin with the given configuration. This should be instantiated
// within your main function for your plugin and passed to the Register* functions to add
// capabilities to the plugin.
func NewPlugin(config embed.FS) *Plugin {
	// load in the plugin configuration
	pluginConfig := types.PluginConfig{}
	if err := pluginConfig.LoadFromFile(config); err != nil {
		panic(err)
	}

	return &Plugin{
		config:    pluginConfig,
		pluginMap: make(map[string]plugin.Plugin),
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
		HandshakeConfig: p.config.GenerateHandshakeConfig(),
		Plugins:         p.pluginMap,
	})
}
