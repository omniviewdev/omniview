package config

import (
	"context"
)

type globalConfigKey struct{}

// GlobalConfig holds the global configuration for the IDE.
type GlobalConfig struct {
	config map[string]string
}

// GlobalConfigFromContext returns the global configuration from the context.
func GlobalConfigFromContext(ctx context.Context) *GlobalConfig {
	v := ctx.Value(globalConfigKey{})
	if v == nil {
		return NewGlobalConfig(nil)
	}

	config, ok := v.(*GlobalConfig)
	if config == nil || !ok {
		return NewGlobalConfig(nil)
	}

	return config
}

// NewGlobalConfig creates a new global configuration.
func NewGlobalConfig(config map[string]string) *GlobalConfig {
	return &GlobalConfig{config: config}
}

// Get returns the value for the given key on the config.
func (c *GlobalConfig) Get(key string) string {
	return c.config[key]
}

// WithGlobalConfig injects the IDE global configuration into context.
func WithGlobalConfig(ctx context.Context, config *GlobalConfig) context.Context {
	ctx = context.WithValue(ctx, globalConfigKey{}, config)
	return ctx
}
