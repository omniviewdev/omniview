package plugin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/hashicorp/go-hclog"
	goplugin "github.com/hashicorp/go-plugin"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"
	grpccodes "google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	pluginexec "github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	pluginlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	pluginmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	ep "github.com/omniviewdev/plugin-sdk/pkg/exec"
	lp "github.com/omniviewdev/plugin-sdk/pkg/logs"
	mp "github.com/omniviewdev/plugin-sdk/pkg/metric"
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

	// SetDevServerChecker sets the dev server checker used to skip the old
	// rebuild pipeline for plugins managed by the DevServerManager.
	SetDevServerChecker(checker DevServerChecker)

	// SetDevServerManager sets the dev server manager used to auto-start
	// dev servers for plugins in dev mode.
	SetDevServerManager(mgr *devserver.DevServerManager)
}

// NewManager returns a new plugin manager for the IDE to use to manager installed plugins.
func NewManager(
	logger *zap.SugaredLogger,
	resourceController resource.Controller,
	settingsController settings.Controller,
	execController pluginexec.Controller,
	networkerController networker.Controller,
	logsController pluginlogs.Controller,
	metricController pluginmetric.Controller,
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
			types.LogPlugin:        logsController,
			types.MetricPlugin:     metricController,
		},
		connfullControllers: map[types.PluginType]plugintypes.ConnectedController{
			types.ResourcePlugin:   resourceController,
			types.ExecutorPlugin:   nil, // connless
			types.NetworkerPlugin:  nil, // connless
			types.ReporterPlugin:   nil, // connless
			types.SettingsPlugin:   nil, // connless
			types.FilesystemPlugin: nil, // TODO: implement
			types.LogPlugin:        nil, // managed via connlessControllers
			types.MetricPlugin:     nil, // managed via connlessControllers
		},
		watcher:          watcher,
		watchTargets:     make(map[string][]string),
		managers:         managers,
		settingsProvider: settingsProvider,
		registryClient:   registryClient,
		pidTracker:       NewPluginPIDTracker(),
	}
}

// DevServerChecker allows the plugin manager to check if a plugin is managed
// by the dev server system, without importing the devserver package.
type DevServerChecker interface {
	IsManaged(pluginID string) bool
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
	managers       map[string]plugintypes.PluginManager
	devServerCheck DevServerChecker
	devServerMgr   *devserver.DevServerManager
	pidTracker     *PluginPIDTracker
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

	// Persist any remaining PIDs (safety net for plugins that failed to stop).
	// On clean shutdown this will be empty/no-op.
	if err := pm.pidTracker.Save(); err != nil {
		pm.logger.Warnw("failed to save plugin PID file", "error", err)
	}
}

// SetDevServerChecker sets the dev server checker. Call this after both the
// plugin manager and dev server manager are created.
func (pm *pluginManager) SetDevServerChecker(checker DevServerChecker) {
	pm.devServerCheck = checker
}

// SetDevServerManager sets the dev server manager. Call this after both the
// plugin manager and dev server manager are created.
func (pm *pluginManager) SetDevServerManager(mgr *devserver.DevServerManager) {
	pm.devServerMgr = mgr
}

func (pm *pluginManager) Initialize(ctx context.Context) error {
	// bind to Wails context
	pm.ctx = ctx

	// Kill any orphaned plugin processes from a previous unclean shutdown.
	pm.pidTracker.CleanupStale(pm.logger)

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

	// Phase 1: Start all dev servers in parallel.
	// GoWatcher.Start() performs an initial `go build`, which can take 15-30s.
	// Running them concurrently cuts total startup from sum(build_times) to max(build_times).
	type devEntry struct {
		pluginID string
		devPath  string
	}
	var devPlugins []devEntry

	for _, file := range files {
		if !file.IsDir() {
			continue
		}
		for _, state := range states {
			if state.ID == file.Name() && state.DevMode && state.DevPath != "" {
				devPlugins = append(devPlugins, devEntry{
					pluginID: file.Name(),
					devPath:  state.DevPath,
				})
			}
		}
	}

	if len(devPlugins) > 0 && pm.devServerMgr != nil {
		var wg sync.WaitGroup
		for _, dp := range devPlugins {
			wg.Add(1)
			go func(pluginID, devPath string) {
				defer wg.Done()
				pm.logger.Infow("starting dev server (parallel)", "pluginID", pluginID, "devPath", devPath)
				if _, err := pm.devServerMgr.StartDevServerForPath(pluginID, devPath); err != nil {
					pm.logger.Warnw("failed to start dev server", "pluginID", pluginID, "error", err)
				}
			}(dp.pluginID, dp.devPath)
		}
		wg.Wait()
	}

	// Phase 2: Load all plugins sequentially (binaries now exist from parallel builds).
	for _, file := range files {
		if !file.IsDir() {
			continue
		}

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

	// write the plugin state to disk
	if err = pm.writePluginState(); err != nil {
		// just log for now
		pm.logger.Error(err)
	}

	return nil
}

func (pm *pluginManager) InstallInDevMode() (*config.PluginMeta, error) {
	l := pm.logger.Named("InstallInDevMode")
	l.Infow("InstallInDevMode called")

	// have to pass wails context
	path, err := runtime.OpenDirectoryDialog(pm.ctx, runtime.OpenDialogOptions{})
	if err != nil {
		l.Error(err)
		return nil, err
	}
	if path == "" {
		return nil, apperror.Cancelled()
	}

	l.Infow("installing plugin in dev mode", "path", path)

	// 1. Parse metadata from the plugin source directory.
	metadata, err := parseMetadataFromPluginPath(path)
	if err != nil {
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to parse plugin metadata")
	}
	l.Infow("parsed plugin metadata", "pluginID", metadata.ID)

	runtime.EventsEmit(pm.ctx, PluginDevInstallEventStart, metadata)

	// 2. Unload any existing plugin state so reinstall is idempotent.
	if _, exists := pm.plugins[metadata.ID]; exists {
		l.Infow("plugin already loaded, unloading first for reinstall", "pluginID", metadata.ID)
		if unloadErr := pm.UnloadPlugin(metadata.ID); unloadErr != nil {
			l.Warnw("failed to unload existing plugin (continuing anyway)", "pluginID", metadata.ID, "error", unloadErr)
		}
	}

	// 3. Copy plugin.yaml to ~/.omniview/plugins/<id>/.
	if err = transferPluginBuild(path, metadata, plugintypes.BuildOpts{
		ExcludeBackend: true,
		ExcludeUI:      true,
	}); err != nil {
		runtime.EventsEmit(pm.ctx, PluginDevInstallEventError, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to copy plugin metadata")
	}

	// 4. Ensure the bin directory exists for the GoWatcher to transfer into.
	installLocation := getPluginLocation(metadata.ID)
	if err = os.MkdirAll(filepath.Join(installLocation, "bin"), 0755); err != nil {
		runtime.EventsEmit(pm.ctx, PluginDevInstallEventError, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to create plugin bin directory")
	}

	// 5. Start the dev server (Vite + GoWatcher with initial build).
	//    GoWatcher.Start() performs an initial `go build` + transferBinary, placing the
	//    binary at ~/.omniview/plugins/<id>/bin/plugin so LoadPlugin validation passes.
	if pm.devServerMgr != nil {
		l.Infow("starting dev server (triggers initial build)", "pluginID", metadata.ID)
		if _, startErr := pm.devServerMgr.StartDevServerForPath(metadata.ID, path); startErr != nil {
			runtime.EventsEmit(pm.ctx, PluginDevInstallEventError, metadata)
			return nil, apperror.Wrap(startErr, apperror.TypePluginBuildFailed, 500, "Dev server failed to start").
				WithActions(apperror.OpenSettingsAction("developer"))
		}
		l.Infow("dev server started successfully", "pluginID", metadata.ID)
	} else {
		runtime.EventsEmit(pm.ctx, PluginDevInstallEventError, metadata)
		return nil, apperror.New(apperror.TypeSettingsMissingConfig, 422, "No dev server manager configured",
			"The dev server manager is not available. Ensure developer settings are configured.").
			WithActions(apperror.OpenSettingsAction("developer"))
	}

	// 6. Load the plugin — binary should now exist from GoWatcher initial build.
	l.Infow("loading plugin (starting binary + gRPC connect)", "pluginID", metadata.ID)
	_, err = pm.LoadPlugin(metadata.ID, &LoadPluginOptions{DevMode: true, DevModePath: path})
	if err != nil {
		runtime.EventsEmit(pm.ctx, PluginDevInstallEventError, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500, "Failed to load plugin")
	}

	runtime.EventsEmit(pm.ctx, PluginDevInstallEventComplete, metadata)

	if err = pm.writePluginState(); err != nil {
		l.Error(err)
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
		return nil, apperror.Cancelled()
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
		return nil, apperror.New(apperror.TypeValidation, 422, "Invalid plugin package",
			fmt.Sprintf("The file at '%s' is not a valid tar.gz archive.", path)).
			WithSuggestions("Ensure the file is a .tar.gz plugin package")
	}

	if err := checkTarball(path); err != nil {
		return nil, apperror.Wrap(err, apperror.TypeValidation, 422, "Corrupt plugin package").
			WithSuggestions("Re-download the plugin package and try again")
	}

	// all good - unpack to the plugin directory
	metadata, err := parseMetadataFromArchive(path)
	if err != nil {
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to parse plugin metadata")
	}

	// signal to UI the install has started
	runtime.EventsEmit(pm.ctx, PluginInstallStartedEvent, metadata)

	// ensure the plugin directory exists
	location := getPluginLocation(metadata.ID)
	if err = os.MkdirAll(location, 0755); err != nil {
		runtime.EventsEmit(pm.ctx, PluginInstallErrorEvent, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to create plugin directory")
	}

	if err = unpackPluginArchive(path, location); err != nil {
		runtime.EventsEmit(pm.ctx, PluginInstallErrorEvent, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to unpack plugin package")
	}

	// all set, load it in, uninstalling a current one if necessary
	pm.UnloadPlugin(metadata.ID)

	_, err = pm.LoadPlugin(metadata.ID, nil)
	if err != nil {
		runtime.EventsEmit(pm.ctx, PluginInstallErrorEvent, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500, "Failed to load plugin after install")
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
		return types.Plugin{}, apperror.New(apperror.TypePluginNotLoaded, 404,
			"Plugin not loaded",
			fmt.Sprintf("Plugin '%s' is not currently loaded.", id)).WithInstance(id)
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
		return types.Plugin{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
			"Failed to unload plugin during reload").WithInstance(id)
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
		return types.Plugin{}, apperror.PluginAlreadyLoaded(id)
	}

	location := getPluginLocation(id)
	log.Debugw("loading plugin from location", "location", location)

	// make sure it exists, and load the metadata file
	if _, err := os.Stat(location); os.IsNotExist(err) {
		return types.Plugin{}, apperror.PluginNotFound(id)
	}

	// load the metadata in so we can start validating
	metadata, err := types.LoadPluginMetadata(location)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return types.Plugin{}, apperror.New(apperror.TypePluginLoadFailed, 404,
				"Plugin metadata missing",
				fmt.Sprintf("Plugin '%s' is missing its metadata file (plugin.yaml).", id)).
				WithInstance(id)
		}

		return types.Plugin{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
			fmt.Sprintf("Failed to load metadata for plugin '%s'", id)).
			WithInstance(id)
	}

	// Dev mode: only validate binary exists (UI assets are served live by Vite dev server).
	// Production: full validation including UI assets.
	if opts != nil && opts.DevMode {
		if err = validateHasBinary(location); err != nil {
			return types.Plugin{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
				fmt.Sprintf("Plugin '%s' failed dev validation", id)).WithInstance(id)
		}
	} else if opts != nil && opts.ExistingState != nil && opts.ExistingState.DevMode {
		if err = validateHasBinary(location); err != nil {
			return types.Plugin{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
				fmt.Sprintf("Plugin '%s' failed dev validation", id)).WithInstance(id)
		}
	} else {
		if err = validateInstalledPlugin(metadata); err != nil {
			return types.Plugin{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
				fmt.Sprintf("Plugin '%s' failed validation during loading", id)).WithInstance(id)
		}
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

	// Add old-style watchers if in dev mode and not managed by DevServerManager.
	// DevServerManager-managed plugins use GoWatcher for rebuilds instead.
	if newPlugin.DevMode && (pm.devServerCheck == nil || !pm.devServerCheck.IsManaged(id)) {
		pm.AddTarget(newPlugin.DevPath)
	}

	pm.logger.Debugw("found metadata",
		"metadata", metadata,
		"hasBackendCapabilities", metadata.HasBackendCapabilities(),
		"hasUiCapabilities", metadata.HasUICapabilities(),
	)

	// we have backend capabilities, so we need to start the plugin
	if metadata.HasBackendCapabilities() {
		pluginClient := goplugin.NewClient(&goplugin.ClientConfig{
			HandshakeConfig: metadata.GenerateHandshakeConfig(),
			Plugins: map[string]goplugin.Plugin{
				"resource":  &rp.ResourcePlugin{},
				"exec":      &ep.Plugin{},
				"networker": &np.Plugin{},
				"log":       &lp.Plugin{},
				"metric":    &mp.Plugin{},
				"settings":  &sp.SettingsPlugin{},
			},
			GRPCDialOptions: sdk.GRPCDialOptions(),
			//nolint:gosec // this is completely software controlled
			Cmd:              exec.Command(filepath.Join(location, "bin", "plugin")),
			AllowedProtocols: []goplugin.Protocol{goplugin.ProtocolGRPC},
			Logger: hclog.New(&hclog.LoggerOptions{
				Name:   id,
				Output: os.Stdout,
				Level:  hclog.Debug,
			}),
		})

		// Connect via RPC
		rpcClient, err := pluginClient.Client()
		if err != nil {
			appErr := apperror.Wrap(err, apperror.TypePluginLoadFailed, 500, "Failed to initialize plugin RPC").WithInstance(id)
			pm.logger.Error(appErr)
			return types.Plugin{}, appErr
		}

		newPlugin.RPCClient = rpcClient
		newPlugin.PluginClient = pluginClient

		// Track the plugin process PID for orphan cleanup on next startup.
		if rc := pluginClient.ReattachConfig(); rc != nil {
			pm.pidTracker.Record(id, rc.Pid)
		}

		// init the controllers
		if err = pm.initPlugin(&newPlugin); err != nil {
			newPlugin.LoadError = err.Error()
			pm.plugins[id] = newPlugin

			return types.Plugin{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500, "Failed to initialize plugin").WithInstance(id)
		}

		// start the controllers
		if err = pm.startPlugin(&newPlugin); err != nil {
			newPlugin.LoadError = err.Error()
			pm.plugins[id] = newPlugin

			return types.Plugin{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500, "Failed to start plugin").WithInstance(id)
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
		appErr := apperror.New(apperror.TypePluginNotLoaded, 404,
			"Plugin not loaded",
			fmt.Sprintf("Plugin '%s' is not currently loaded.", id)).WithInstance(id)
		l.Error(appErr)
		return types.Plugin{}, appErr
	}

	if err := pm.UnloadPlugin(id); err != nil {
		appErr := apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
			"Failed to unload plugin during uninstall").WithInstance(id)
		l.Error(appErr)
		return types.Plugin{}, appErr
	}
	l.Debugw("unloaded plugin", "pluginID", id)

	// remove from the filesystem
	location := getPluginLocation(id)
	if err := os.RemoveAll(location); err != nil {
		appErr := apperror.Internal(err, "Failed to remove plugin from filesystem").WithInstance(id)
		l.Error(appErr)
		return types.Plugin{}, appErr
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
		appErr := apperror.PluginNotFound(id)
		l.Error(appErr)
		return types.Plugin{}, appErr
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
		appErr := apperror.PluginNotFound(id)
		l.Error(appErr)
		return config.PluginMeta{}, appErr
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

	// Init all controllers — OnPluginInit is a lightweight notification
	// with no gRPC calls, so it's safe to call for all capabilities.
	// Actual capability detection happens later in startPlugin.
	for pt, ctrl := range pm.connfullControllers {
		if ctrl == nil || pt == types.SettingsPlugin {
			continue
		}
		ctrl.OnPluginInit(plugin.Metadata)
	}
	for pt, ctrl := range pm.connlessControllers {
		if ctrl == nil || pt == types.SettingsPlugin {
			continue
		}
		ctrl.OnPluginInit(plugin.Metadata)
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

	// Discover capabilities by probing the running plugin binary via gRPC.
	// For each capability we make a lightweight unary RPC call to a known
	// method on its gRPC service. If the call returns codes.Unimplemented
	// the plugin binary does not serve that capability and we skip it.
	// Only when the probe succeeds do we call OnPluginStart for that
	// controller, which sets up streams and state.
	type capEntry struct {
		pluginType  types.PluginType
		connfull    bool
		probeMethod string // full gRPC method path for the probe
	}
	optionalCaps := []capEntry{
		{types.ResourcePlugin, true, "/com.omniview.pluginsdk.ResourcePlugin/GetResourceGroups"},
		{types.ExecutorPlugin, false, "/com.omniview.pluginsdk.ExecPlugin/GetSupportedResources"},
		{types.NetworkerPlugin, false, "/com.omniview.pluginsdk.NetworkerPlugin/GetSupportedPortForwardTargets"},
		{types.LogPlugin, false, "/com.omniview.pluginsdk.LogPlugin/GetSupportedResources"},
		{types.MetricPlugin, false, "/com.omniview.pluginsdk.MetricPlugin/GetSupportedResources"},
	}

	// Get the underlying gRPC connection for probing.
	grpcClient, ok := plugin.RPCClient.(*goplugin.GRPCClient)
	if !ok {
		return fmt.Errorf("expected *plugin.GRPCClient, got %T", plugin.RPCClient)
	}
	conn := grpcClient.Conn

	plugin.Capabilities = make([]types.PluginType, 0)
	for _, cap := range optionalCaps {
		name := cap.pluginType.String()

		var ctrl plugintypes.Controller
		if cap.connfull {
			ctrl = pm.connfullControllers[cap.pluginType]
		} else {
			ctrl = pm.connlessControllers[cap.pluginType]
		}
		if ctrl == nil {
			continue
		}

		// Probe: make a lightweight gRPC call. We don't care about the
		// response payload — we only check whether the service exists.
		probeCtx, probeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		probeErr := conn.Invoke(probeCtx, cap.probeMethod, &emptypb.Empty{}, &emptypb.Empty{})
		probeCancel()
		if grpcstatus.Code(probeErr) == grpccodes.Unimplemented {
			pm.logger.Debugw("capability not implemented in plugin binary",
				"pluginID", plugin.Metadata.ID,
				"capability", name,
			)
			continue
		}

		// Service exists (the call may fail for other reasons like nil
		// request, which is expected — but the service IS registered).
		if err := ctrl.OnPluginStart(plugin.Metadata, plugin.RPCClient); err != nil {
			pm.logger.Warnw("failed to start capability controller",
				"pluginID", plugin.Metadata.ID,
				"capability", name,
				"error", err,
			)
			continue
		}

		plugin.Capabilities = append(plugin.Capabilities, cap.pluginType)
	}

	pm.logger.Infow("detected plugin capabilities",
		"pluginID", plugin.Metadata.ID,
		"capabilities", plugin.Capabilities,
	)

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

	// Stop controllers for capabilities detected from the running binary.
	for _, cap := range plugin.Capabilities {
		var ctrl plugintypes.Controller
		switch cap {
		case types.ResourcePlugin, types.FilesystemPlugin:
			ctrl = pm.connfullControllers[cap]
		default:
			ctrl = pm.connlessControllers[cap]
		}
		if ctrl == nil {
			continue
		}
		if err := ctrl.OnPluginStop(plugin.Metadata); err != nil {
			return fmt.Errorf("error stopping %s plugin: %w", cap, err)
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
		pm.pidTracker.Remove(plugin.Metadata.ID)

		// manually shutdown the required capabilities first
		if err := pm.connlessControllers[types.SettingsPlugin].OnPluginShutdown(plugin.Metadata); err != nil {
			return fmt.Errorf("error shutting down settings plugin: %w", err)
		}
	}

	// Shutdown controllers for capabilities detected from the running binary.
	for _, cap := range plugin.Capabilities {
		var ctrl plugintypes.Controller
		switch cap {
		case types.ResourcePlugin, types.FilesystemPlugin:
			ctrl = pm.connfullControllers[cap]
		default:
			ctrl = pm.connlessControllers[cap]
		}
		if ctrl == nil {
			continue
		}
		if err := ctrl.OnPluginShutdown(plugin.Metadata); err != nil {
			return fmt.Errorf("error shutting down %s plugin: %w", cap, err)
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
