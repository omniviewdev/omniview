package types

// PluginSystemConfig is the configuration for the core plugin system.
type PluginSystemConfig struct {
	// pluginsPath is the path on the filesystem to where plugins are stored
	pluginsPath string
}

// PluginsPath returns the path on the filesystem to where plugins are stored.
func (c *PluginSystemConfig) PluginsPath() string {
	return c.pluginsPath
}
