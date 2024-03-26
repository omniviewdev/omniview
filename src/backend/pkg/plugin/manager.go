package plugin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/fsnotify/fsnotify"
	"github.com/hashicorp/go-plugin"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	rp "github.com/omniviewdev/plugin-sdk/pkg/resource/plugin"
	sp "github.com/omniviewdev/plugin-sdk/pkg/settings"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	MaxPluginSize             = 1024 * 1024 * 1024 // 1GB
	PluginInstallStartedEvent = "plugin/install_started"
)

// Manager manages the lifecycle and registration of plugins. It is responsible
// for registering and unregistering plugins, and communicating with the plugin
// controllers to handle the lifecycle of the plugins.
type Manager interface {
	// Initialize discovers and loads all plugins that are currently installed in the plugin directory,
	// and initializes them with the appropriate controllers.
	Initialize(ctx context.Context) error

	// Run starts until the the passed in context is cancelled
	Run(ctx context.Context)

	// Shutdown stops the plugin manager and all plugins.
	Shutdown()

	// InstallInDevMode installs a plugin from the given path, and sets up a watcher to recompile and reload the plugin
	// when changes are detected. Will prompt the user for a path.
	InstallInDevMode() (*config.PluginMeta, error)

	// InstallFromPathPrompt installs a plugin from the given path, prompting the user for the location
	// with a window dialog.
	InstallFromPathPrompt() (*config.PluginMeta, error)

	// InstallPluginFromPath installs a plugin from the given path. It will validate the plugin
	// and then load it into the manager.
	InstallPluginFromPath(path string) (*config.PluginMeta, error)

	// LoadPlugin loads a plugin at the given path. It will validate the plugin
	// and then load it into the manager.
	LoadPlugin(id string, opts *LoadPluginOptions) (types.Plugin, error)

	// ReloadPlugin reloads a plugin at the given path. It will validate the plugin
	// and then load it into the manager.
	ReloadPlugin(id string) (types.Plugin, error)

	// UninstallPlugin uninstalls a plugin from the manager, and removes it from the filesystem.
	UninstallPlugin(id string) (types.Plugin, error)

	// GetPlugin returns the plugin with the given plugin ID.
	GetPlugin(id string) (types.Plugin, error)

	// ListPlugins returns a list of all plugins that are currently registered with the manager.
	ListPlugins() []types.Plugin

	// GetPluginMeta returns the plugin metadata for the given plugin ID.
	GetPluginMeta(id string) (config.PluginMeta, error)

	// ListPlugins returns a list of all plugins that are currently registered with the manager.
	ListPluginMetas() []config.PluginMeta
}

// NewManager returns a new plugin manager for the IDE to use to manager installed plugins.
func NewManager(
	logger *zap.SugaredLogger,
	resourceController resource.Controller,
	settingsController settings.Controller,
) Manager {
	l := logger.Named("PluginManager")

	// create new watcher.
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		l.Errorf("error creating new dev mode watcher: %s", err)
	}

	return &pluginManager{
		logger:  logger,
		plugins: make(map[string]types.Plugin),
		connlessControllers: map[types.PluginType]plugintypes.Controller{
			types.SettingsPlugin:   settingsController,
			types.ReporterPlugin:   nil, // TODO implement
			types.ResourcePlugin:   nil, // not connless
			types.ExecutorPlugin:   nil, // not connless
			types.FilesystemPlugin: nil, // not connless
			types.LogPlugin:        nil, // not connless
			types.MetricPlugin:     nil, // not connless
		},
		connfullControllers: map[types.PluginType]plugintypes.ConnectedController{
			types.ResourcePlugin:   resourceController,
			types.ExecutorPlugin:   nil, // TODO: implement
			types.FilesystemPlugin: nil, // TODO: implement
			types.LogPlugin:        nil, // TODO: implement
			types.MetricPlugin:     nil, // TODO: implement
			types.ReporterPlugin:   nil, // connless
			types.SettingsPlugin:   nil, // connless
		},
		watcher:      watcher,
		watchTargets: make(map[string][]string),
	}
}

// concrete implementation of the plugin manager.
type pluginManager struct {
	ctx                 context.Context
	logger              *zap.SugaredLogger
	plugins             map[string]types.Plugin
	connlessControllers map[types.PluginType]plugintypes.Controller
	connfullControllers map[types.PluginType]plugintypes.ConnectedController
	watcher             *fsnotify.Watcher
	watchTargets        map[string][]string
}

// Run starts until the the passed in context is cancelled.
func (pm *pluginManager) Run(ctx context.Context) {
	if pm.ctx == nil {
		pm.ctx = ctx
	}

	go pm.runWatcher()
}

func (pm *pluginManager) Shutdown() {
	// stop the watcher
	pm.watcher.Close()

	// shutdown all plugins
	for _, plugin := range pm.plugins {
		pm.shutdownPlugin(&plugin)
	}
}

func (pm *pluginManager) Initialize(ctx context.Context) error {
	// bind to Wails context
	pm.ctx = ctx

	// make sure our plugin dir is all set
	if err := auditPluginDir(); err != nil {
		return err
	}

	// load any existing state
	states, err := pm.readPluginState()
	if err != nil {
		// not a big deal, just log it
		pm.logger.Error(err)
	}

	pm.logger.Debugw("Loading plugins states from disk", "states", states)

	// load all the plugins in the plugin directory
	files, err := os.ReadDir(filepath.Join(os.Getenv("HOME"), ".omniview", "plugins"))
	if err != nil {
		return fmt.Errorf("error reading plugin directory: %w", err)
	}

	// load each plugin
	for _, file := range files {
		if file.IsDir() {
			var opts *LoadPluginOptions

			for _, state := range states {
				if state.ID == file.Name() {
					opts = &LoadPluginOptions{
						ExistingState: state,
					}
				}
			}

			if _, err = pm.LoadPlugin(file.Name(), opts); err != nil {
				return fmt.Errorf("error loading plugin: %w", err)
			}
		}
	}

	// write the plugin state to disk
	if err = pm.writePluginState(); err != nil {
		// just log for now
		pm.logger.Error(err)
	}

	return nil
}

func (pm *pluginManager) InstallInDevMode() (*config.PluginMeta, error) {
	// have to pass wails context
	path, err := runtime.OpenDirectoryDialog(pm.ctx, runtime.OpenDialogOptions{})
	if err != nil {
		pm.logger.Error(err)
		return nil, err
	}
	if path == "" {
		return nil, errors.New("cancelled")
	}

	// perform initial install
	var metadata *config.PluginMeta
	metadata, err = pm.installAndWatchDevPlugin(path)
	if err != nil {
		pm.logger.Error(err)
		return nil, err
	}
	_, err = pm.LoadPlugin(metadata.ID, &LoadPluginOptions{DevMode: true, DevModePath: path})
	if err != nil {
		return nil, fmt.Errorf("error loading plugin: %w", err)
	}

	if err = pm.writePluginState(); err != nil {
		// skip for now, but should probobly do some other action
		pm.logger.Error(err)
	}

	return metadata, nil
}

// InstallFromPathPrompt installs a plugin from the given path, prompting the user for the location
// with a window dialog.
func (pm *pluginManager) InstallFromPathPrompt() (*config.PluginMeta, error) {
	// have to pass wails context
	path, err := runtime.OpenFileDialog(pm.ctx, runtime.OpenDialogOptions{})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, errors.New("cancelled")
	}
	return pm.InstallPluginFromPath(path)
}

func (pm *pluginManager) InstallPluginFromPath(path string) (*config.PluginMeta, error) {
	// make sure the plugin dir is all set
	if err := auditPluginDir(); err != nil {
		return nil, err
	}

	// plugins should be a valid tar.gz file
	if !isGzippedTarball(path) {
		return nil, fmt.Errorf("plugin is not a tar.gz file: %s", path)
	}

	if err := checkTarball(path); err != nil {
		return nil, fmt.Errorf("plugin package is corrupt: %w", err)
	}

	// all good - unpack to the plugin directory
	metadata, err := parseMetadataFromArchive(path)
	if err != nil {
		return nil, fmt.Errorf("error parsing plugin metadata: %w", err)
	}

	// signal to UI the install has started
	runtime.EventsEmit(pm.ctx, PluginInstallStartedEvent, metadata)

	// ensure the plugin directory exists
	location := getPluginLocation(metadata.ID)
	if err = os.MkdirAll(location, 0755); err != nil {
		return nil, fmt.Errorf("error creating plugin directory: %w", err)
	}

	if err = unpackPluginArchive(path, location); err != nil {
		return nil, fmt.Errorf("error unpacking plugin download: %w", err)
	}

	// all set, load it in
	_, err = pm.LoadPlugin(metadata.ID, nil)
	if err != nil {
		return nil, fmt.Errorf("error loading plugin: %w", err)
	}

	if err = pm.writePluginState(); err != nil {
		// skip for now, but should probobly do some other action
		pm.logger.Error(err)
	}

	return metadata, nil
}

func (pm *pluginManager) ReloadPlugin(id string) (types.Plugin, error) {
	_, ok := pm.plugins[id]
	if !ok {
		return types.Plugin{}, fmt.Errorf("plugin with id '%s' is not currently loaded", id)
	}

	var opts *LoadPluginOptions

	// get the existing state first
	state, err := pm.readPluginState()
	if err == nil {
		// find and load it
		for _, s := range state {
			if s.ID == id {
				opts = &LoadPluginOptions{
					ExistingState: s,
				}
			}
		}
	}

	if err = pm.UnloadPlugin(id); err != nil {
		return types.Plugin{}, fmt.Errorf("error unloading plugin during reload: %w", err)
	}
	return pm.LoadPlugin(id, opts)
}

type LoadPluginOptions struct {
	DevMode       bool
	DevModePath   string
	ExistingState *plugintypes.PluginState
}

func (pm *pluginManager) LoadPlugin(id string, opts *LoadPluginOptions) (types.Plugin, error) {
	if _, ok := pm.plugins[id]; ok {
		return types.Plugin{}, fmt.Errorf("plugin with id '%s' already loaded", id)
	}

	location := getPluginLocation(id)

	// make sure it exists, and load the metadata file
	if _, err := os.Stat(location); os.IsNotExist(err) {
		return types.Plugin{}, fmt.Errorf("plugin with id '%s' not found", id)
	}

	// load the metadata in so we can start validating
	metadata, err := types.LoadPluginMetadata(location)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return types.Plugin{}, fmt.Errorf(
				"plugin with id '%s' is missing it's metadata file",
				id,
			)
		}

		return types.Plugin{}, fmt.Errorf(
			"error loading plugin metadata for plugin '%s': %w",
			id,
			err,
		)
	}

	if err = validateInstalledPlugin(metadata); err != nil {
		return types.Plugin{}, fmt.Errorf(
			"plugin with id '%s' failed validation during loading: %w",
			id,
			err,
		)
	}

	// We're a host. Start by launching the plugin process.
	pluginClient := plugin.NewClient(&plugin.ClientConfig{
		HandshakeConfig: metadata.GenerateHandshakeConfig(),
		Plugins: map[string]plugin.Plugin{
			"resource": &rp.ResourcePlugin{},
			"settings": &sp.SettingsPlugin{},
		},
		Cmd:              exec.Command(filepath.Join(location, "bin", "plugin")),
		AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
	})

	// Connect via RPC
	rpcClient, err := pluginClient.Client()
	if err != nil {
		err = fmt.Errorf("error initializing plugin: %w", err)
		pm.logger.Error(err)
		return types.Plugin{}, err
	}

	// all good, add to the map
	newPlugin := types.Plugin{
		ID:           id,
		Metadata:     metadata,
		Running:      false,
		Enabled:      true,
		Config:       *config.NewEmptyPluginConfig(),
		RPCClient:    rpcClient,
		PluginClient: pluginClient,
	}

	if opts != nil && opts.ExistingState != nil {
		if err = upsertPluginState(&newPlugin, *opts.ExistingState); err != nil {
			return types.Plugin{}, fmt.Errorf("error upserting plugin state: %w", err)
		}
	}

	if opts != nil && opts.DevMode {
		newPlugin.DevMode = true
		newPlugin.DevPath = opts.DevModePath
	}

	// add watchers if in dev mode
	if newPlugin.DevMode {
		pm.AddTarget(newPlugin.DevPath)
	}

	pm.plugins[id] = newPlugin

	// init the controllers
	if err = pm.initPlugin(&newPlugin); err != nil {
		newPlugin.LoadError = err.Error()
		pm.plugins[id] = newPlugin

		return types.Plugin{}, fmt.Errorf("error initializing plugin: %w", err)
	}

	// start the controllers
	if err = pm.startPlugin(&newPlugin, rpcClient); err != nil {
		newPlugin.LoadError = err.Error()
		pm.plugins[id] = newPlugin

		return types.Plugin{}, fmt.Errorf("error starting plugin: %w", err)
	}

	return newPlugin, nil
}

// UninstallPlugin uninstalls a plugin from the manager, and removes it from the filesystem.
func (pm *pluginManager) UninstallPlugin(id string) (types.Plugin, error) {
	l := pm.logger.With("name", "UninstallPlugin", "pluginID", id)
	defer pm.writePluginState()

	plugin, ok := pm.plugins[id]
	if !ok {
		err := fmt.Errorf("plugin with id '%s' is not currently loaded", id)
		l.Error(err)
		return types.Plugin{}, err
	}

	if err := pm.UnloadPlugin(id); err != nil {
		err = fmt.Errorf("error unloading plugin during uninstall: %w", err)
		l.Error(err)
		return types.Plugin{}, err
	}

	// remove from the filesystem
	location := getPluginLocation(id)
	if err := os.RemoveAll(location); err != nil {
		err = fmt.Errorf("error removing plugin from filesystem: %w", err)
		l.Error(err)
		return types.Plugin{}, err
	}
	return plugin, nil
}

// UnloadPlugin unloads a plugin from the manager, stopping it if it is currently running.
func (pm *pluginManager) UnloadPlugin(id string) error {
	plugin, ok := pm.plugins[id]
	if !ok {
		return fmt.Errorf("plugin with id '%s' is not currently loaded", id)
	}

	if plugin.IsRunning() {
		// stop the plugin
		if err := pm.stopPlugin(&plugin); err != nil {
			return fmt.Errorf("error shutting down plugin: %w", err)
		}
	}

	if err := pm.shutdownPlugin(&plugin); err != nil {
		return fmt.Errorf("error shutting down plugin: %w", err)
	}

	// remove from the map
	delete(pm.plugins, id)
	return nil
}

// GetPlugin returns the plugin with the given plugin ID.
func (pm *pluginManager) GetPlugin(id string) (types.Plugin, error) {
	l := pm.logger.With("name", "GetPlugin", "pluginID", id)

	plugin, ok := pm.plugins[id]
	if !ok {
		err := fmt.Errorf("plugin not found: %s", id)
		l.Error(err)
		return types.Plugin{}, err
	}
	return plugin, nil
}

// ListPlugins returns a list of all plugins that are currently registered with the manager.
func (pm *pluginManager) ListPlugins() []types.Plugin {
	var plugins []types.Plugin
	for _, plugin := range pm.plugins {
		plugins = append(plugins, plugin)
	}
	return plugins
}

// GetPluginConfig returns the plugin configuration for the given plugin ID.
func (pm *pluginManager) GetPluginMeta(id string) (config.PluginMeta, error) {
	l := pm.logger.With("name", "GetPluginMeta", "pluginID", id)

	plugin, ok := pm.plugins[id]
	if !ok {
		err := fmt.Errorf("plugin not found: %s", id)
		l.Error(err)
		return config.PluginMeta{}, err
	}
	return plugin.Metadata, nil
}

// ListPluginMetas returns a list of all plugins that are currently registered with the manager.
func (pm *pluginManager) ListPluginMetas() []config.PluginMeta {
	var metas []config.PluginMeta
	for _, plugin := range pm.plugins {
		metas = append(metas, plugin.Metadata)
	}
	return metas
}

// ================================== private methods ================================== //

// TODO - redo all of these to extract the common logic. This is a bit of a mess.

// initPlugin initializes the plugin and calls all the plugin controller init handlers.
func (pm *pluginManager) initPlugin(plugin *types.Plugin) error {
	if plugin == nil {
		return errors.New("plugin is nil")
	}

	// manually register the required capabilities first
	pm.connlessControllers[types.SettingsPlugin].OnPluginInit(plugin.Metadata)

	// go through the controllers and init them based on the capabilities
	for _, capability := range plugin.Metadata.Capabilities {
		switch capability {
		case types.ResourcePlugin.String():
			pm.connfullControllers[types.ResourcePlugin].OnPluginInit(plugin.Metadata)
		case types.ExecutorPlugin.String():
			pm.connfullControllers[types.ExecutorPlugin].OnPluginInit(plugin.Metadata)
		case types.FilesystemPlugin.String():
			pm.connfullControllers[types.FilesystemPlugin].OnPluginInit(plugin.Metadata)
		case types.LogPlugin.String():
			pm.connfullControllers[types.LogPlugin].OnPluginInit(plugin.Metadata)
		case types.MetricPlugin.String():
			pm.connfullControllers[types.MetricPlugin].OnPluginInit(plugin.Metadata)
		case types.ReporterPlugin.String():
			pm.connlessControllers[types.ReporterPlugin].OnPluginInit(plugin.Metadata)
		}
	}

	return nil
}

// startPlugin starts the plugin and calls all the plugin controller start handlers.
func (pm *pluginManager) startPlugin(plugin *types.Plugin, client plugin.ClientProtocol) error {
	if plugin == nil {
		return errors.New("plugin is nil")
	}

	// manually start the required capabilities first

	if err := pm.connlessControllers[types.SettingsPlugin].OnPluginStart(plugin.Metadata, client); err != nil {
		return fmt.Errorf("error starting settings plugin: %w", err)
	}

	// go through the controllers and start them based on the capabilities
	for _, capability := range plugin.Metadata.Capabilities {
		switch capability {
		case types.ResourcePlugin.String():
			if err := pm.connfullControllers[types.ResourcePlugin].OnPluginStart(plugin.Metadata, client); err != nil {
				return fmt.Errorf("error starting resource plugin: %w", err)
			}
		case types.ExecutorPlugin.String():
			if err := pm.connfullControllers[types.ExecutorPlugin].OnPluginStart(plugin.Metadata, client); err != nil {
				return fmt.Errorf("error starting executor plugin: %w", err)
			}
		case types.FilesystemPlugin.String():
			if err := pm.connfullControllers[types.FilesystemPlugin].OnPluginStart(plugin.Metadata, client); err != nil {
				return fmt.Errorf("error starting filesystem plugin: %w", err)
			}
		case types.LogPlugin.String():
			if err := pm.connfullControllers[types.LogPlugin].OnPluginStart(plugin.Metadata, client); err != nil {
				return fmt.Errorf("error starting log plugin: %w", err)
			}
		case types.MetricPlugin.String():
			if err := pm.connfullControllers[types.MetricPlugin].OnPluginStart(plugin.Metadata, client); err != nil {
				return fmt.Errorf("error starting metric plugin: %w", err)
			}
		case types.ReporterPlugin.String():
			if err := pm.connlessControllers[types.ReporterPlugin].OnPluginStart(plugin.Metadata, client); err != nil {
				return fmt.Errorf("error starting reporter plugin: %w", err)
			}
		}
	}

	return nil
}

// Stop the plugin and call all the plugin controller stop handlers.
func (pm *pluginManager) stopPlugin(plugin *types.Plugin) error {
	if plugin == nil {
		return errors.New("plugin is nil")
	}

	// manually stop the required capabilities first

	if err := pm.connlessControllers[types.SettingsPlugin].OnPluginStop(plugin.Metadata); err != nil {
		return fmt.Errorf("error stopping settings plugin: %w", err)
	}

	// go through the controllers and stop them based on the capabilities
	for _, capability := range plugin.Metadata.Capabilities {
		switch capability {
		case types.ResourcePlugin.String():
			if err := pm.connfullControllers[types.ResourcePlugin].OnPluginStop(plugin.Metadata); err != nil {
				return fmt.Errorf("error stopping resource plugin: %w", err)
			}
		case types.ExecutorPlugin.String():
			if err := pm.connfullControllers[types.ExecutorPlugin].OnPluginStop(plugin.Metadata); err != nil {
				return fmt.Errorf("error stopping executor plugin: %w", err)
			}
		case types.FilesystemPlugin.String():
			if err := pm.connfullControllers[types.FilesystemPlugin].OnPluginStop(plugin.Metadata); err != nil {
				return fmt.Errorf("error stopping filesystem plugin: %w", err)
			}
		case types.LogPlugin.String():
			if err := pm.connfullControllers[types.LogPlugin].OnPluginStop(plugin.Metadata); err != nil {
				return fmt.Errorf("error stopping log plugin: %w", err)
			}
		case types.MetricPlugin.String():
			if err := pm.connfullControllers[types.MetricPlugin].OnPluginStop(plugin.Metadata); err != nil {
				return fmt.Errorf("error stopping metric plugin: %w", err)
			}
		case types.ReporterPlugin.String():
			if err := pm.connlessControllers[types.ReporterPlugin].OnPluginStop(plugin.Metadata); err != nil {
				return fmt.Errorf("error stopping reporter plugin: %w", err)
			}
		}
	}

	return nil
}

// Shutdown the plugin and call all the plugin controller shutdown handlers.
func (pm *pluginManager) shutdownPlugin(plugin *types.Plugin) error {
	if plugin == nil {
		return errors.New("plugin is nil")
	}

	// stop the plugin client
	if err := plugin.RPCClient.Close(); err != nil {
		return fmt.Errorf("error stopping plugin client: %w", err)
	}

	plugin.PluginClient.Kill()

	// manually shutdown the required capabilities first

	if err := pm.connlessControllers[types.SettingsPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
		return fmt.Errorf("error shutting down settings plugin: %w", err)
	}

	// go through the controllers and stop them based on the capabilities
	for _, capability := range plugin.Metadata.Capabilities {
		switch capability {
		case types.ResourcePlugin.String():
			if err := pm.connfullControllers[types.ResourcePlugin].OnPluginShutdown(plugin.Metadata); err != nil {
				return fmt.Errorf("error shutting down resource plugin: %w", err)
			}
		case types.ExecutorPlugin.String():
			if err := pm.connfullControllers[types.ExecutorPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
				return fmt.Errorf("error shutting down executor plugin: %w", err)
			}
		case types.FilesystemPlugin.String():
			if err := pm.connfullControllers[types.FilesystemPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
				return fmt.Errorf("error shutting down filesystem plugin: %w", err)
			}
		case types.LogPlugin.String():
			if err := pm.connfullControllers[types.LogPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
				return fmt.Errorf("error shutting down log plugin: %w", err)
			}
		case types.MetricPlugin.String():
			if err := pm.connfullControllers[types.MetricPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
				return fmt.Errorf("error shutting down metric plugin: %w", err)
			}
		case types.ReporterPlugin.String():
			if err := pm.connfullControllers[types.ReporterPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
				return fmt.Errorf("error shutting down reporter plugin: %w", err)
			}
		}
	}
	return nil
}

// Destroy the plugin and call all the plugin controller destroy handlers.
func (pm *pluginManager) destroyPlugin(plugin *types.Plugin) error {
	if plugin == nil {
		return errors.New("plugin is nil")
	}

	// manually destroy the required capabilities first
	if err := pm.connlessControllers[types.SettingsPlugin].OnPluginDestroy(plugin.Metadata); err != nil {
		return fmt.Errorf("error destroying settings plugin: %w", err)
	}

	// go through the controllers and stop them based on the capabilities
	for _, capability := range plugin.Metadata.Capabilities {
		switch capability {
		case types.ResourcePlugin.String():
			if err := pm.connfullControllers[types.ResourcePlugin].OnPluginDestroy(plugin.Metadata); err != nil {
				return fmt.Errorf("error destroying resource plugin: %w", err)
			}
		case types.ExecutorPlugin.String():
			if err := pm.connfullControllers[types.ExecutorPlugin].OnPluginDestroy(plugin.Metadata); err != nil {
				return fmt.Errorf("error destroying executor plugin: %w", err)
			}
		case types.FilesystemPlugin.String():
			if err := pm.connfullControllers[types.FilesystemPlugin].OnPluginDestroy(plugin.Metadata); err != nil {
				return fmt.Errorf("error destroying filesystem plugin: %w", err)
			}
		case types.LogPlugin.String():
			if err := pm.connfullControllers[types.LogPlugin].OnPluginDestroy(plugin.Metadata); err != nil {
				return fmt.Errorf("error destroying log plugin: %w", err)
			}
		case types.MetricPlugin.String():
			if err := pm.connfullControllers[types.MetricPlugin].OnPluginDestroy(plugin.Metadata); err != nil {
				return fmt.Errorf("error destroying metric plugin: %w", err)
			}
		case types.ReporterPlugin.String():
			if err := pm.connfullControllers[types.ReporterPlugin].OnPluginDestroy(plugin.Metadata); err != nil {
				return fmt.Errorf("error destroying reporter plugin: %w", err)
			}
		}
	}
	return nil
}
