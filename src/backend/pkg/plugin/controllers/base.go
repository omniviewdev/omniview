package controllers

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"github.com/hashicorp/go-hclog"
	"github.com/hashicorp/go-plugin"
	"go.uber.org/zap"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

type PluginControllerStatus int

const (
	PluginControllerStatusInitialized PluginControllerStatus = iota
	PluginControllerStatusRunning
	PluginControllerStatusStopped
)

type PluginStatusCode int

const (
	PluginStatusLoaded PluginStatusCode = iota
	PluginsStatusLoading
	PluginStatusRunning
	PluginStatusErrored
	PluginStatusStopped
)

var ErrPluginNotFound = errors.New("plugin not found")

type PluginEntry[I any] struct {
	ID       string
	Client   *plugin.Client
	Instance I
	Status   PluginStatus
}

type PluginStatus struct {
	Error  error            `json:"error,omitempty"`
	ID     string           `json:"id"`
	Status PluginStatusCode `json:"status"`
}

// PluginController is a base implementation that all plugin controllers
// must satisfy in order to be used by the plugin system.
type PluginController[HandlerI any] interface {
	Run() error
	Type() types.PluginType
	Status() PluginControllerStatus
	LoadPlugin(id string) error
	UnloadPlugin(id string) error
	ReloadPlugin(id string) error
	ReloadAllPlugins() error
	ListPluginStatus() []PluginStatus
	GetPluginStatus(id string) (PluginStatus, error)
	GetPluginInstance(id string) (HandlerI, error)
}

// BasePluginController is a base implementation that all plugin controllers can use
// to wire up the common functionality of loading, unloading, and managing plugins.
// The BasePluginController is designed to be extended by the various plugin controllers.
//
// At minimum, plugin controllers must implement the Run and HandleMessage methods to
// process messages coming from the plugin system and to start and stop the plugin controller.
type BasePluginController[HandlerI any] struct {
	Logger      *zap.SugaredLogger
	StopCh      chan struct{}
	pluginStore plugin.PluginSet
	plugins     map[string]PluginEntry[HandlerI]
	pluginsPath string
	status      PluginControllerStatus
	pluginType  types.PluginType
	sync.RWMutex
}

// Instantiates a new BasePluginController to be be extended by the various plugin controllers.
func NewBasePluginController[HandlerI any](
	logger *zap.SugaredLogger,
	pluginType types.PluginType,
	pluginPath string,
	stopCh chan struct{},
) BasePluginController[HandlerI] {
	return BasePluginController[HandlerI]{
		RWMutex:     sync.RWMutex{},
		StopCh:      stopCh,
		status:      PluginControllerStatusInitialized,
		Logger:      logger,
		pluginStore: make(plugin.PluginSet),
		plugins:     make(map[string]PluginEntry[HandlerI]),
		pluginType:  pluginType,
		pluginsPath: pluginPath,
	}
}

func (c *BasePluginController[I]) Run() error {
	if err := c.Start(); err != nil {
		return fmt.Errorf("failed to start resource plugin controller: %w", err)
	}

	<-c.StopCh
	if err := c.Shutdown(); err != nil {
		c.Logger.Errorw("Failed to shutdown resource plugin controller", "error", err)
	}
	return nil
}

// Start initializes and starts the plugin controller.
func (c *BasePluginController[I]) Start() error {
	c.Lock()
	defer c.Unlock()

	// Check if the controller is already running to prevent reinitialization.
	if c.status != PluginControllerStatusInitialized {
		return errors.New("cannot start: controller is not in an initialized state")
	}

	// Initialize plugins that need to be started with the controller.
	for id := range c.plugins {
		if err := c.loadPlugin(id); err != nil {
			c.Logger.Errorw("Failed to load plugin at start", "id", id, "error", err)
			// Optionally, continue to start the controller even if some plugins fail to load.
		}
	}

	// Change status to running.
	c.status = PluginControllerStatusRunning
	c.Logger.Info("Plugin controller started")
	return nil
}

// Shutdown stops the plugin controller and all of its plugins.
func (c *BasePluginController[I]) Shutdown() error {
	c.Lock()
	defer c.Unlock()

	// Only attempt shutdown if the controller is running.
	if c.status != PluginControllerStatusRunning {
		return errors.New("cannot shutdown: controller is not running")
	}

	// Attempt to gracefully stop all plugins.
	for id := range c.plugins {
		if err := c.unloadPlugin(id); err != nil {
			c.Logger.Errorw("Failed to unload plugin during shutdown", "id", id, "error", err)
			// Consider continuing to shutdown other plugins even if one fails.
		}
	}

	// Close message channel to signal no more messages should be sent.
	close(c.StopCh)

	// Change status to stopped.
	c.status = PluginControllerStatusStopped
	c.Logger.Info("Plugin controller shutdown complete")
	return nil
}

// Status returns the current status of the plugin controller.
func (c *BasePluginController[I]) Status() PluginControllerStatus {
	return c.status
}

// Type returns the type of the plugin controller.
func (c *BasePluginController[I]) Type() types.PluginType {
	return c.pluginType
}

// define the private nonlocking instance of loadPlugin so it can be called from other methods
// that already have the lock.
func (c *BasePluginController[I]) loadPlugin(id string) error {
	// first check it's not already loaded
	if _, ok := c.plugins[id]; ok {
		return fmt.Errorf("plugin already loaded: %s", id)
	}

	// get the binary path for the plugin
	executable := filepath.Join(c.pluginsPath, id, "bin", c.pluginType.String())
	if _, err := os.Stat(executable); os.IsNotExist(err) {
		return fmt.Errorf("plugin binary not found: %s", id)
	}

	// We're a host! Start by launching the plugin process.
	client := plugin.NewClient(&plugin.ClientConfig{
		HandshakeConfig: plugin.HandshakeConfig{
			MagicCookieKey:   id,
			MagicCookieValue: "hello",
		},
		Plugins: c.pluginStore,
		Cmd:     exec.Command(executable),
		Logger: hclog.New(&hclog.LoggerOptions{
			Name:  id,
			Level: hclog.LevelFromString("DEBUG"),
		}),
	})

	// Connect via RPC
	rpcClient, err := client.Client()
	if err != nil {
		client.Kill()
		return fmt.Errorf("failed to initialize %s plugin %s: %w", c.pluginType, id, err)
	}

	// Request the plugin
	raw, err := rpcClient.Dispense(id)
	if err != nil {
		client.Kill()
		return fmt.Errorf("failed to initialize %s plugin %s: %w", c.pluginType, id, err)
	}

	// ensure it satisfies the interface and add it to the plugin store so the router can route to it
	instance, ok := raw.(I)
	if !ok {
		client.Kill()
		return fmt.Errorf(
			"failed to initialize %s plugin %s: plugin does not satisfy plugin interface",
			c.pluginType,
			id,
		)
	}

	entry := PluginEntry[I]{
		ID:       id,
		Client:   client,
		Instance: instance,
		Status: PluginStatus{
			ID:     id,
			Status: PluginStatusLoaded,
			Error:  nil,
		},
	}

	c.plugins[id] = entry
	return nil
}

// LoadPlugin loads a plugin from the given path and starts it. This will
// start the plugin process and add it to the plugin store so the router
// can route to it.
func (c *BasePluginController[I]) LoadPlugin(id string) error {
	// lock the plugin store
	c.Lock()
	defer c.Unlock()

	return c.loadPlugin(id)
}

// private nonlocking instance of UnloadPlugin so it can be called from other methods
// that already have the lock.
func (c *BasePluginController[I]) unloadPlugin(id string) error {
	// find the plugin
	plugin, ok := c.plugins[id]
	if !ok {
		return ErrPluginNotFound
	}
	// gracefully stop the plugin
	plugin.Client.Kill()
	// remove it from the map
	delete(c.plugins, id)
	return nil
}

// UnloadPlugin unloads a plugin from the given path.
func (c *BasePluginController[I]) UnloadPlugin(id string) error {
	// lock the plugin store
	c.Lock()
	defer c.Unlock()

	return c.unloadPlugin(id)
}

// ReloadPlugin reloads a plugin from the given path.
// TODO - add a fallback to the old plugin if the new plugin fails to load
func (c *BasePluginController[I]) ReloadPlugin(id string) error {
	// lock the plugin store
	c.Lock()
	defer c.Unlock()
	// unload the plugin
	if err := c.unloadPlugin(id); err != nil {
		return err
	}
	// load the plugin
	if err := c.loadPlugin(id); err != nil {
		return err
	}
	return nil
}

// ReloadAllPlugins reloads all plugins.
func (c *BasePluginController[I]) ReloadAllPlugins() error {
	// lock the plugin store
	c.Lock()
	defer c.Unlock()
	// unload all plugins
	for id := range c.plugins {
		if err := c.unloadPlugin(id); err != nil {
			return err
		}
	}
	// load all plugins
	for id := range c.plugins {
		if err := c.loadPlugin(id); err != nil {
			return err
		}
	}
	return nil
}

// ListPluginStatuses returns the statuses of all plugins.
func (c *BasePluginController[I]) ListPluginStatus() []PluginStatus {
	statuses := make([]PluginStatus, 0, len(c.plugins))
	for id, entry := range c.plugins {
		status := entry.Status
		status.ID = id
		statuses = append(statuses, status)
	}
	return statuses
}

// GetPluginStatus returns the status of the plugin with the given ID.
func (c *BasePluginController[I]) GetPluginStatus(id string) (PluginStatus, error) {
	plugin, ok := c.plugins[id]
	if !ok {
		return PluginStatus{}, ErrPluginNotFound
	}
	status := plugin.Status
	status.ID = id
	return status, nil
}

// GetPluginInstance returns the handler for the plugin with the given ID.
func (c *BasePluginController[I]) GetPluginInstance(id string) (I, error) {
	plugin, ok := c.plugins[id]
	if !ok {
		var nilHandler I
		return nilHandler, ErrPluginNotFound
	}
	return plugin.Instance, nil
}
