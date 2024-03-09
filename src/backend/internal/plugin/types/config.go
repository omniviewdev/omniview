package types

// PluginManagerConfig is the configuration for the core plugin system.
type PluginManagerConfig struct {
	// pluginsPath is the path on the filesystem to where plugins are stored
	pluginsPath string
}

// PluginsPath returns the path on the filesystem to where plugins are stored.
func (c *PluginManagerConfig) PluginsPath() string {
	return c.pluginsPath
}
