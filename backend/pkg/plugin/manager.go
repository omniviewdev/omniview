package plugin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	// "sync"

	"github.com/fsnotify/fsnotify"
	"github.com/hashicorp/go-hclog"
	"github.com/hashicorp/go-plugin"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	pluginexec "github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	ep "github.com/omniviewdev/plugin-sdk/pkg/exec"
	np "github.com/omniviewdev/plugin-sdk/pkg/networker"
	rp "github.com/omniviewdev/plugin-sdk/pkg/resource/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sp "github.com/omniviewdev/plugin-sdk/pkg/settings"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/settings"
)

const (
	MaxPluginSize              = 1024 * 1024 * 1024 // 1GB
	PluginUpdateStartedEvent   = "plugin/update_started"
	PluginInstallStartedEvent  = "plugin/install_started"
	PluginInstallFinishedEvent = "plugin/install_finished"
	PluginInstallErrorEvent    = "plugin/install_error"
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

	// InstallPluginVersion installs a plugin with a specified version from the plugin registry.
	// It returns an error if it does not exist.
	InstallPluginVersion(pluginID string, version string) (*config.PluginMeta, error)

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

	// ListAvailablePlugins returns a list of all plugins that are available and suppported for the
	// users IDE environment.
	ListAvailablePlugins() ([]registry.Plugin, error)

	// // ListAvailablePluginVersions returns a list of the versions available for a specified plugin
	// GetAvailablePluginIndex() []registry.PluginIndex

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
	execController pluginexec.Controller,
	networkerController networker.Controller,
	managers map[string]plugintypes.PluginManager,
	settingsProvider pkgsettings.Provider,
	registryClient *registry.RegistryClient,
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
			types.ReporterPlugin:   nil, // TODO: implement
			types.ExecutorPlugin:   execController,
			types.NetworkerPlugin:  networkerController,
			types.ResourcePlugin:   nil, // not connless
			types.FilesystemPlugin: nil, // not connless
			types.LogPlugin:        nil, // not connless
			types.MetricPlugin:     nil, // not connless
		},
		connfullControllers: map[types.PluginType]plugintypes.ConnectedController{
			types.ResourcePlugin:   resourceController,
			types.ExecutorPlugin:   nil, // connless
			types.NetworkerPlugin:  nil, // connless
			types.ReporterPlugin:   nil, // connless
			types.SettingsPlugin:   nil, // connless
			types.FilesystemPlugin: nil, // TODO: implement
			types.LogPlugin:        nil, // TODO: implement
			types.MetricPlugin:     nil, // TODO: implement
		},
		watcher:          watcher,
		watchTargets:     make(map[string][]string),
		managers:         managers,
		settingsProvider: settingsProvider,
		registryClient:   registryClient,
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
	settingsProvider    pkgsettings.Provider
	registryClient      *registry.RegistryClient
	// extendable amount of plugin managers
	managers map[string]plugintypes.PluginManager
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
	files, err := os.ReadDir(getPluginDir())
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
				// don't fail on one plugin not loading
				pm.logger.Errorf("error loading plugin: %w", err)
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

	// build out our opts, including any paths we've detected
	opts := plugintypes.BuildOpts{}
	opts.GoPath, _ = pm.settingsProvider.GetString("developer.gopath")
	opts.PnpmPath, _ = pm.settingsProvider.GetString("developer.pnpmpath")
	opts.NodePath, _ = pm.settingsProvider.GetString("developer.nodepath")

	pm.logger.Infow("installing plugin from path",
		"path", path,
		"opts", opts,
	)

	// perform initial install
	var metadata *config.PluginMeta
	metadata, err = pm.installAndWatchDevPlugin(path, opts)
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

func (pm *pluginManager) GetPluginVersions(pluginID string) registry.PluginVersions {
	return pm.registryClient.GetPluginVersions(pluginID)
}

// InstallPluginVersion installs a plugin from the registry
func (pm *pluginManager) InstallPluginVersion(
	pluginID string,
	version string,
) (*config.PluginMeta, error) {
	// signal to UI the install has started
	runtime.EventsEmit(pm.ctx, PluginUpdateStartedEvent, pluginID, version)

	// Fetch from the registry
	tmpPath, err := pm.registryClient.DownloadAndPrepare(pluginID, version)
	if err != nil {
		pm.logger.Errorw("failed to download and prepare", "error", err)
		return nil, err
	}

	pm.logger.Debug("installing plugin from downloaded tmp path", "path", tmpPath)
	return pm.InstallPluginFromPath(tmpPath)
}

func (pm *pluginManager) ListAvailablePlugins() ([]registry.Plugin, error) {
	return pm.registryClient.ListPlugins()
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

	// ensure the plugin directory exists
	location := getPluginLocation(metadata.ID)
	if err = os.MkdirAll(location, 0755); err != nil {
		// signal to UI the install has started
		runtime.EventsEmit(pm.ctx, PluginInstallErrorEvent, metadata)
		return nil, fmt.Errorf("error creating plugin directory: %w", err)
	}

	if err = unpackPluginArchive(path, location); err != nil {
		runtime.EventsEmit(pm.ctx, PluginInstallErrorEvent, metadata)
		return nil, fmt.Errorf("error unpacking plugin download: %w", err)
	}

	// all set, load it in, uninstalling a current one if necessary
	pm.UnloadPlugin(metadata.ID)

	_, err = pm.LoadPlugin(metadata.ID, nil)
	if err != nil {
		runtime.EventsEmit(pm.ctx, PluginInstallErrorEvent, metadata)
		return nil, fmt.Errorf("error loading plugin: %w", err)
	}

	if err = pm.writePluginState(); err != nil {
		// skip for now, but should probobly do some other action
		pm.logger.Error(err)
	}

	runtime.EventsEmit(pm.ctx, PluginInstallFinishedEvent, metadata)
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
	log := pm.logger.Named("LoadPlugin").With("id", id, "ops", opts)

	if _, ok := pm.plugins[id]; ok {
		return types.Plugin{}, fmt.Errorf("plugin with id '%s' already loaded", id)
	}

	location := getPluginLocation(id)
	log.Debugw("loading plugin from location", "location", location)

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

	// all good, add to the map
	newPlugin := types.Plugin{
		ID:       id,
		Metadata: metadata,
		Running:  false,
		Enabled:  true,
		Config:   *config.NewEmptyPluginConfig(),
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

	pm.logger.Debugw("found metadata",
		"metadata", metadata,
		"hasBackendCapabilities", metadata.HasBackendCapabilities(),
		"hasUiCapabilities", metadata.HasUICapabilities(),
	)

	// we have backend capabilities, so we need to start the plugin
	if metadata.HasBackendCapabilities() {
		pluginClient := plugin.NewClient(&plugin.ClientConfig{
			HandshakeConfig: metadata.GenerateHandshakeConfig(),
			Plugins: map[string]plugin.Plugin{
				"resource":  &rp.ResourcePlugin{},
				"exec":      &ep.Plugin{},
				"networker": &np.Plugin{},
				"settings":  &sp.SettingsPlugin{},
			},
			GRPCDialOptions: sdk.GRPCDialOptions(),
			//nolint:gosec // this is completely software controlled
			Cmd:              exec.Command(filepath.Join(location, "bin", "plugin")),
			AllowedProtocols: []plugin.Protocol{plugin.ProtocolGRPC},
			Logger: hclog.New(&hclog.LoggerOptions{
				Name:   id,
				Output: os.Stdout,
				Level:  hclog.Debug,
			}),
		})

		// Connect via RPC
		rpcClient, err := pluginClient.Client()
		if err != nil {
			err = fmt.Errorf("error initializing plugin: %w", err)
			pm.logger.Error(err)
			return types.Plugin{}, err
		}

		newPlugin.RPCClient = rpcClient
		newPlugin.PluginClient = pluginClient

		// init the controllers
		if err = pm.initPlugin(&newPlugin); err != nil {
			newPlugin.LoadError = err.Error()
			pm.plugins[id] = newPlugin

			return types.Plugin{}, fmt.Errorf("error initializing plugin: %w", err)
		}

		// start the controllers
		if err = pm.startPlugin(&newPlugin); err != nil {
			newPlugin.LoadError = err.Error()
			pm.plugins[id] = newPlugin

			return types.Plugin{}, fmt.Errorf("error starting plugin: %w", err)
		}
	}

	pm.plugins[id] = newPlugin

	return newPlugin, nil
}

// UninstallPlugin uninstalls a plugin from the manager, and removes it from the filesystem.
func (pm *pluginManager) UninstallPlugin(id string) (types.Plugin, error) {
	l := pm.logger.With("name", "UninstallPlugin", "pluginID", id)
	defer pm.writePluginState()

	l.Debugw("uninstalling plugin", "pluginID", id)
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
	l.Debugw("unloaded plugin", "pluginID", id)

	// remove from the filesystem
	location := getPluginLocation(id)
	if err := os.RemoveAll(location); err != nil {
		err = fmt.Errorf("error removing plugin from filesystem: %w", err)
		l.Error(err)
		return types.Plugin{}, err
	}
	l.Debugw("removed plugin", "pluginID", id)

	l.Debugw("uninstalled plugin", "pluginID", id)

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
	l := pm.logger.Named("GetPlugin").With("pluginID", id)

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
	l := pm.logger.Named("ListPlugins")
	l.Debug("listing plugins", "count", len(pm.plugins))

	var plugins []types.Plugin
	for _, plugin := range pm.plugins {
		plugins = append(plugins, plugin)
	}
	return plugins
}

// GetPluginConfig returns the plugin configuration for the given plugin ID.
func (pm *pluginManager) GetPluginMeta(id string) (config.PluginMeta, error) {
	l := pm.logger.Named("GetPluginMeta").With("pluginID", id)

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

	ctx := context.Background()

	// run the extended managers
	for name, manager := range pm.managers {
		if err := manager.OnPluginInit(ctx, plugin.Metadata); err != nil {
			// log the error
			pm.logger.Errorw(
				"error invoking init for plugin manager",
				"manager",
				name,
				plugin,
				plugin.Metadata.ID,
				"error",
				err,
			)
		}
	}

	// manually register the required capabilities first
	pm.connlessControllers[types.SettingsPlugin].OnPluginInit(plugin.Metadata)

	// go through the controllers and init them based on the capabilities
	for _, capability := range plugin.Metadata.Capabilities {
		switch capability {
		case types.ResourcePlugin.String():
			pm.connfullControllers[types.ResourcePlugin].OnPluginInit(plugin.Metadata)
		case types.ExecutorPlugin.String():
			pm.connlessControllers[types.ExecutorPlugin].OnPluginInit(plugin.Metadata)
		case types.NetworkerPlugin.String():
			pm.connlessControllers[types.NetworkerPlugin].OnPluginInit(plugin.Metadata)
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
func (pm *pluginManager) startPlugin(plugin *types.Plugin) error {
	if plugin == nil {
		return errors.New("plugin is nil")
	}

	ctx := context.Background()

	// run the extended managers
	for name, manager := range pm.managers {
		if err := manager.OnPluginStart(ctx, plugin.Metadata); err != nil {
			// log the error
			pm.logger.Errorw(
				"error invoking start for plugin manager",
				"manager",
				name,
				plugin,
				plugin.Metadata.ID,
				"error",
				err,
			)
		}
	}

	// manually start the required capabilities first

	if err := pm.connlessControllers[types.SettingsPlugin].OnPluginStart(plugin.Metadata, plugin.RPCClient); err != nil {
		return fmt.Errorf("error starting settings plugin: %w", err)
	}

	// go through the controllers and start them based on the capabilities
	for _, capability := range plugin.Metadata.Capabilities {
		switch capability {
		case types.ResourcePlugin.String():
			if err := pm.connfullControllers[types.ResourcePlugin].OnPluginStart(plugin.Metadata, plugin.RPCClient); err != nil {
				return fmt.Errorf("error starting resource plugin: %w", err)
			}
		case types.ExecutorPlugin.String():
			if err := pm.connlessControllers[types.ExecutorPlugin].OnPluginStart(plugin.Metadata, plugin.RPCClient); err != nil {
				return fmt.Errorf("error starting executor plugin: %w", err)
			}
		case types.NetworkerPlugin.String():
			if err := pm.connlessControllers[types.NetworkerPlugin].OnPluginStart(plugin.Metadata, plugin.RPCClient); err != nil {
				return fmt.Errorf("error starting networker plugin: %w", err)
			}
		case types.FilesystemPlugin.String():
			if err := pm.connfullControllers[types.FilesystemPlugin].OnPluginStart(plugin.Metadata, plugin.RPCClient); err != nil {
				return fmt.Errorf("error starting filesystem plugin: %w", err)
			}
		case types.LogPlugin.String():
			if err := pm.connfullControllers[types.LogPlugin].OnPluginStart(plugin.Metadata, plugin.RPCClient); err != nil {
				return fmt.Errorf("error starting log plugin: %w", err)
			}
		case types.MetricPlugin.String():
			if err := pm.connfullControllers[types.MetricPlugin].OnPluginStart(plugin.Metadata, plugin.RPCClient); err != nil {
				return fmt.Errorf("error starting metric plugin: %w", err)
			}
		case types.ReporterPlugin.String():
			if err := pm.connlessControllers[types.ReporterPlugin].OnPluginStart(plugin.Metadata, plugin.RPCClient); err != nil {
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

	ctx := context.Background()

	// run the extended managers
	for name, manager := range pm.managers {
		if err := manager.OnPluginStop(ctx, plugin.Metadata); err != nil {
			// log the error
			pm.logger.Errorw(
				"error invoking stop for plugin manager",
				"manager",
				name,
				plugin,
				plugin.Metadata.ID,
				"error",
				err,
			)
		}
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
			if err := pm.connlessControllers[types.ExecutorPlugin].OnPluginStop(plugin.Metadata); err != nil {
				return fmt.Errorf("error stopping executor plugin: %w", err)
			}
		case types.NetworkerPlugin.String():
			if err := pm.connlessControllers[types.NetworkerPlugin].OnPluginStop(plugin.Metadata); err != nil {
				return fmt.Errorf("error stopping networker plugin: %w", err)
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

	ctx := context.Background()

	// run the extended managers
	for name, manager := range pm.managers {
		if err := manager.OnPluginShutdown(ctx, plugin.Metadata); err != nil {
			// log the error
			pm.logger.Errorw(
				"error invoking shutdown for plugin manager",
				"manager",
				name,
				plugin,
				plugin.Metadata.ID,
				"error",
				err,
			)
		}
	}

	// stop the plugin client
	if plugin.Metadata.HasBackendCapabilities() {
		if err := plugin.RPCClient.Close(); err != nil {
			return fmt.Errorf("error stopping plugin client: %w", err)
		}
		plugin.PluginClient.Kill()

		// manually shutdown the required capabilities first
		if err := pm.connlessControllers[types.SettingsPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
			return fmt.Errorf("error shutting down settings plugin: %w", err)
		}
	}

	// go through the controllers and stop them based on the capabilities
	for _, capability := range plugin.Metadata.Capabilities {
		switch capability {
		case types.ResourcePlugin.String():
			if err := pm.connfullControllers[types.ResourcePlugin].OnPluginShutdown(plugin.Metadata); err != nil {
				return fmt.Errorf("error shutting down resource plugin: %w", err)
			}
		case types.ExecutorPlugin.String():
			if err := pm.connlessControllers[types.ExecutorPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
				return fmt.Errorf("error shutting down executor plugin: %w", err)
			}
		case types.NetworkerPlugin.String():
			if err := pm.connlessControllers[types.NetworkerPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
				return fmt.Errorf("error shutting down networker plugin: %w", err)
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
// func (pm *pluginManager) destroyPlugin(plugin *types.Plugin) error {
// 	if plugin == nil {
// 		return errors.New("plugin is nil")
// 	}
//
// 	ctx := context.Background()
// 	var managerwg sync.WaitGroup
//
// 	// all of our managers satisfy the PluginManager interface, so we can iterate over them
// 	// and call the destroy method on each one
// 	for name, manager := range pm.managers {
// 		managerwg.Add(1)
//
// 		// invoke the manager destroy in a goroutine
// 		go func(meta config.PluginMeta, manager plugintypes.PluginManager, name string) {
// 			defer managerwg.Done()
// 			if err := manager.OnPluginDestroy(ctx, meta); err != nil {
// 				// log the error
// 				pm.logger.Errorw(
// 					"error invoking manager destroy for plugin",
// 					"manager", name,
// 					plugin, meta.ID,
// 					"error", err,
// 				)
// 			}
// 		}(plugin.Metadata, manager, name)
// 	}
//
// 	managerwg.Wait()
//
// 	// manually destroy the required capabilities first
// 	if err := pm.connlessControllers[types.SettingsPlugin].OnPluginDestroy(plugin.Metadata); err != nil {
// 		return fmt.Errorf("error destroying settings plugin: %w", err)
// 	}
//
// 	// define our plugin types that should call the connfullControllers
// 	confull := []types.PluginType{
// 		types.ResourcePlugin,
// 		types.ExecutorPlugin,
// 		types.FilesystemPlugin,
// 		types.LogPlugin,
// 		types.MetricPlugin,
// 		types.ReporterPlugin,
// 	}
// 	conless := []types.PluginType{
// 		types.ExecutorPlugin,
// 	}
//
// 	for _, capability := range plugin.Metadata.Capabilities {
// 		// find the capability type
// 		var ctype types.PluginType
// 		var connfull bool
//
// 		found := false
// 		for _, t := range confull {
// 			if capability == t.String() {
// 				// found
// 				ctype = t
// 				connfull = true
// 				break
// 			}
// 		}
// 		for _, t := range conless {
// 			if capability == t.String() {
// 				// found
// 				ctype = t
// 				connfull = false
// 				break
// 			}
// 		}
//
// 		if !found {
// 			return fmt.Errorf(
// 				"error destroying plugin: unknown plugin capability type '%s'",
// 				capability,
// 			)
// 		}
//
// 		var err error
// 		if connfull {
// 			err = pm.connfullControllers[ctype].OnPluginDestroy(plugin.Metadata)
// 		} else {
// 			err = pm.connlessControllers[ctype].OnPluginDestroy(plugin.Metadata)
// 		}
//
// 		if err != nil {
// 			return fmt.Errorf("error destroying %s plugin: %w", capability, err)
// 		}
// 	}
//
// 	return nil
// }
