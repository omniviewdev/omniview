package config

import (
	"context"
)

type pluginConfigKey struct{}

// PluginConfig holds the plugin configuration for the IDE
type PluginConfig struct {
	config map[string]string
}

// PluginConfigFromContext returns the plugin configuration from the context
func PluginConfigFromContext(ctx context.Context) *PluginConfig {
	v := ctx.Value(pluginConfigKey{})
	if v == nil {
		return NewPluginConfig(nil)
	}

	config := v.(*PluginConfig)
	if config == nil {
		return NewPluginConfig(nil)
	}

	return config
}

// NewPluginConfig creates a new plugin configuration
func NewPluginConfig(config map[string]string) *PluginConfig {
	return &PluginConfig{config: config}
}