package internal

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"

	"github.com/hashicorp/go-hclog"
	"github.com/hashicorp/go-plugin"
	types "github.com/infraview/plugin/pkg"
	resourcetypes "github.com/infraview/plugin/pkg/resource/types"
)

// pluginMap is the map of plugins we can dispense.
var resourcePluginMap = map[string]plugin.Plugin{}

// handshakeConfigs are used to just do a basic handshake between
// a plugin and host. If the handshake fails, a user friendly error is shown.
// This prevents users from executing bad plugins or executing a plugin
// directory. It is a UX feature, not a security feature.
func newHandshakeConfig(pluginConfig types.PluginConfig) plugin.HandshakeConfig {
	return plugin.HandshakeConfig{
		MagicCookieKey:   pluginConfig.ID,
		MagicCookieValue: "hello",
	}
}

// create a new logger for this plugin.
func newLogger(pluginConfig types.PluginConfig) hclog.Logger {
	return hclog.New(&hclog.LoggerOptions{
		Name:  pluginConfig.ID,
		Level: hclog.LevelFromString("DEBUG"),
	})
}

// RegisterResourcePlugin a resource plugin to the IDE.
func RegisterResourcePlugin(
	config types.PluginConfig,
	plugin resourcetypes.ResourceProvider,
) error {
	if _, ok := resourcePluginMap[config.ID]; ok {
		return fmt.Errorf("plugin already registered: %s", config.ID)
	}

	// add it to the plugin map
	resourcePluginMap[config.ID] = &resourcetypes.ResourcePlugin{Impl: plugin}
	return nil
}

// RunResourcePlugin runs the plugin server. This should be run on a goroutine.
func RunResourcePlugin(
	_ context.Context,
	pluginConfig types.PluginConfig,
	pluginSystemConfig types.PluginSystemConfig,
) error {
	// We're a host! Start by launching the plugin process.
	client := plugin.NewClient(&plugin.ClientConfig{
		HandshakeConfig: newHandshakeConfig(pluginConfig),
		Plugins:         resourcePluginMap,
		Cmd:             exec.Command(filepath.Join(pluginSystemConfig.PluginsPath(), pluginConfig.ID)), // #nosec G204
		Logger:          newLogger(pluginConfig),
		// TODO - enable and check that it works once we get this running.
		// AutoMTLS:        true,
	})
	defer client.Kill()

	// Connect via RPC
	rpcClient, err := client.Client()
	if err != nil {
		return fmt.Errorf("failed to initialize resource plugin %s: %w", pluginConfig.ID, err)
	}

	// Request the plugin
	raw, err := rpcClient.Dispense(pluginConfig.ID)
	if err != nil {
		return fmt.Errorf("failed to initialize resource plugin %s: %w", pluginConfig.ID, err)
	}

	// insure it satisfies the interface, and start routing to the plugin
	_, ok := raw.(resourcetypes.ResourceProvider)
	if !ok {
		return fmt.Errorf("failed to initialize resource plugin %s: shared interface violation", pluginConfig.ID)
	}

	return nil
}
