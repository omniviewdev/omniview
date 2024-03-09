package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"gopkg.in/yaml.v3"

	"github.com/infraview/infraview/backend/internal/plugin/types"

	plugintypes "github.com/infraview/plugin/pkg/types"
)

// Manager manages the lifecycle and registration of plugins. It is responsible
// for registering and unregistering plugins, and communicating with the plugin
// controllers to handle the lifecycle of the plugins.
type Manager interface {
	GetPluginConfig(id string) (plugintypes.PluginConfig, error)
}

type pluginManager struct {
	logger      *zap.SugaredLogger
	pluginStore map[string]types.Plugin
	config      types.PluginManagerConfig
}

func NewManager(logger *zap.SugaredLogger, config types.PluginManagerConfig) Manager {
	return &pluginManager{
		logger:      logger,
		config:      config,
		pluginStore: make(map[string]types.Plugin),
	}
}

func (pm *pluginManager) loadPluginJSONFile(path string) (*plugintypes.PluginConfig, error) {
	var settings plugintypes.PluginConfig

	// read in the json config
	configFile, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("error loading plugin config file: %w", err)
	}

	jsonParser := json.NewDecoder(configFile)
	if err = jsonParser.Decode(&settings); err != nil {
		return nil, fmt.Errorf("error parsing plugin config file: %w", err)
	}

	return &settings, nil
}

func (pm *pluginManager) loadPluginYAMLFile(path string) (*plugintypes.PluginConfig, error) {
	var settings plugintypes.PluginConfig
	// read in the yaml config
	configFile, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("error loading plugin config file: %w", err)
	}
	yamlParser := yaml.NewDecoder(configFile)
	if err = yamlParser.Decode(&settings); err != nil {
		return nil, fmt.Errorf("error parsing plugin config file: %w", err)
	}
	return &settings, nil
}

func (pm *pluginManager) loadPluginConfigFile(id, path string) (*plugintypes.PluginConfig, error) {
	jsonConfigPath := filepath.Join(path, "config.json")
	yamlConfigPath := filepath.Join(path, "config.yaml")

	if _, err := os.Stat(jsonConfigPath); err == nil {
		return pm.loadPluginJSONFile(jsonConfigPath)
	} else if _, err = os.Stat(yamlConfigPath); err == nil {
		return pm.loadPluginYAMLFile(yamlConfigPath)
	}

	return nil, fmt.Errorf("no config file found for plugin: %s", id)
}

func (pm *pluginManager) validateLocalPlugin(id string) error {
	// first, ensure the required files are present
	path := filepath.Join(pm.config.PluginsPath(), id)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("plugin not found: %s", id)
	}

	// has plugin installed, now read in the config and validate
	config, err := pm.loadPluginConfigFile(id, path)
	if err != nil {
		return err
	}

	// check capabilities are met
	for _, p := range config.Capabilities {
		switch p {
		case types.ResourcePlugin.String():
			return pm.validateResourcePlugin(path)
		case types.ReporterPlugin.String():
			return errors.New("reporter plugins are not yet supported")
		case types.ExecutorPlugin.String():
			return errors.New("executor plugins are not yet supported")
		case types.FilesystemPlugin.String():
			return errors.New("filesystem plugins are not yet supported")
		case types.LogPlugin.String():
			return errors.New("log plugins are not yet supported")
		case types.MetricPlugin.String():
			return errors.New("metric plugins are not yet supported")
		default:
			return fmt.Errorf("error validating plugin: unknown plugin capability type '%s'", p)
		}
	}

	return nil
}

// ensures the requirements for the resource plugin type are met
// TODO - include this responsibility in the resource plugin manager
func (pm *pluginManager) validateResourcePlugin(path string) error {
	// first, ensure the required files are present. there should, at minimum be a binary
	// at <path>/bin/resource
	plugin, err := os.Stat(filepath.Join(path, "bin", "resource"))
	if os.IsNotExist(err) {
		return fmt.Errorf("resource plugin binary not found: %s", path)
	}

	// check that it's actually a compiled binary
	if plugin.Mode()&0111 == 0 {
		return fmt.Errorf("resource plugin binary is not executable: %s", path)
	}

	return nil
}

// GetPluginConfig returns the plugin configuration for the given plugin ID.
func (pm *pluginManager) GetPluginConfig(id string) (plugintypes.PluginConfig, error) {
	plugin, ok := pm.pluginStore[id]
	if !ok {
		return plugintypes.PluginConfig{}, fmt.Errorf("plugin not found: %s", id)
	}
	return plugin.Config, nil
}
