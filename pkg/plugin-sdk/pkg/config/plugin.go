package config

import (
	"context"
)

type pluginConfigKey struct{}

// PluginConfig holds the plugin configuration for the IDE.
type PluginConfig struct {
	config map[string]string
}

// PluginConfigFromContext returns the plugin configuration from the context.
func PluginConfigFromContext(ctx context.Context) *PluginConfig {
	v := ctx.Value(pluginConfigKey{})
	if v == nil {
		return NewPluginConfig(nil)
	}

	config, ok := v.(*PluginConfig)
	if !ok || config == nil {
		return NewPluginConfig(nil)
	}

	return config
}

// NewPluginConfig creates a new plugin configuration.
func NewPluginConfig(config map[string]string) *PluginConfig {
	return &PluginConfig{config: config}
}

// NewEmptyPluginConfig creates a new empty plugin configuration.
func NewEmptyPluginConfig() *PluginConfig {
	return &PluginConfig{config: make(map[string]string)}
}

// Get returns the value for the given key on the config.
func (c *PluginConfig) Get(key string) string {
	return c.config[key]
}

// WithPluginConfig injects the IDE plugin configuration into context.
func WithPluginConfig(ctx context.Context, config *PluginConfig) context.Context {
	ctx = context.WithValue(ctx, pluginConfigKey{}, config)
	return ctx
}
