package plugin

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	pluginexec "github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	pluginlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	pluginmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const (
	MaxPluginSize = 1024 * 1024 * 1024 // 1GB
)

// Manager manages the lifecycle and registration of plugins.
type Manager interface {
	Initialize(ctx context.Context) error
	Run(ctx context.Context)
	Shutdown()

	InstallInDevMode() (*config.PluginMeta, error)
	InstallFromPathPrompt() (*config.PluginMeta, error)
	InstallPluginFromPath(path string) (*config.PluginMeta, error)
	InstallPluginVersion(pluginID string, version string) (*config.PluginMeta, error)

	LoadPlugin(id string, opts *LoadPluginOptions) (sdktypes.PluginInfo, error)
	ReloadPlugin(id string) (sdktypes.PluginInfo, error)
	UninstallPlugin(id string) (sdktypes.PluginInfo, error)

	GetPlugin(id string) (sdktypes.PluginInfo, error)
	ListPlugins() []sdktypes.PluginInfo
	GetPluginMeta(id string) (config.PluginMeta, error)
	ListPluginMetas() []config.PluginMeta

	ListAvailablePlugins() ([]registry.AvailablePlugin, error)
	SearchPlugins(query, category, sort string) ([]registry.AvailablePlugin, error)
	GetPluginReadme(pluginID string) (string, error)
	GetPluginVersions(pluginID string) ([]registry.VersionInfo, error)
	GetPluginReviews(pluginID string, page int) ([]registry.Review, error)
	GetPluginDownloadStats(pluginID string) (*registry.DownloadStats, error)
	GetPluginReleaseHistory(pluginID string) ([]registry.VersionInfo, error)

	HandlePluginCrash(pluginID string)

	SetDevServerChecker(checker DevServerChecker)
	SetDevServerManager(mgr *devserver.DevServerManager)
}

// NewManager returns a new plugin manager.
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
	registryClient *registry.Client,
) Manager {
	return &pluginManager{
		logger:  logger,
		records: make(map[string]*plugintypes.PluginRecord),
		connlessControllers: map[sdktypes.Capability]plugintypes.Controller{
			sdktypes.CapabilitySettings:  settingsController,
			sdktypes.CapabilityExec:      execController,
			sdktypes.CapabilityNetworker: networkerController,
			sdktypes.CapabilityLog:       logsController,
			sdktypes.CapabilityMetric:    metricController,
		},
		connfullControllers: map[sdktypes.Capability]plugintypes.ConnectedController{
			sdktypes.CapabilityResource: resourceController,
		},
		managers:         managers,
		settingsProvider: settingsProvider,
		registryClient:   registryClient,
		pidTracker:       NewPluginPIDTracker(),
	}
}

// DevServerChecker allows the plugin manager to check if a plugin is managed
// by the dev server system.
type DevServerChecker interface {
	IsManaged(pluginID string) bool
}

// pluginManager is the concrete implementation.
type pluginManager struct {
	ctx                 context.Context
	logger              *zap.SugaredLogger
	records             map[string]*plugintypes.PluginRecord
	connlessControllers map[sdktypes.Capability]plugintypes.Controller
	connfullControllers map[sdktypes.Capability]plugintypes.ConnectedController
	settingsProvider    pkgsettings.Provider
	registryClient      *registry.Client
	managers            map[string]plugintypes.PluginManager
	devServerCheck      DevServerChecker
	devServerMgr        *devserver.DevServerManager
	pidTracker          *PluginPIDTracker
	healthChecker       *HealthChecker
	backendFactory      func(meta config.PluginMeta, location string) (plugintypes.PluginBackend, error)
}

// Run starts the plugin manager's background tasks.
func (pm *pluginManager) Run(ctx context.Context) {
	if pm.ctx == nil {
		pm.ctx = ctx
	}

	// Start the periodic health checker in the background.
	pm.healthChecker = NewHealthChecker(pm.logger, pm)
	go pm.healthChecker.Start(ctx)
}

// HandlePluginCrash handles a plugin process crash with exponential backoff recovery.
func (pm *pluginManager) HandlePluginCrash(pluginID string) {
	pm.logger.Errorw("plugin process crashed — attempting recovery", "pluginID", pluginID)

	// Emit crash event for the frontend.
	emitEvent(pm.ctx, "plugin/crash", map[string]interface{}{
		"pluginID": pluginID,
		"error":    "plugin process exited unexpectedly",
	})

	// Transition state machine to Recovering and set Phase so the health
	// checker skips this plugin (it only checks Phase == PhaseRunning).
	if record, ok := pm.records[pluginID]; ok {
		record.Phase = lifecycle.PhaseRecovering
		if record.StateMachine != nil {
			_ = record.StateMachine.TransitionTo(lifecycle.PhaseRecovering, "crash detected")
		}
	}

	// Delegate to the health checker's backoff-based recovery if available.
	if pm.healthChecker != nil {
		pm.healthChecker.HandleCrashWithBackoff(pluginID)
		return
	}

	// Fallback: simple single retry with context-aware sleep.
	timer := time.NewTimer(1 * time.Second)
	select {
	case <-timer.C:
	case <-pm.ctx.Done():
		timer.Stop()
		return
	}
	if _, err := pm.ReloadPlugin(pluginID); err != nil {
		pm.logger.Errorw("plugin crash recovery failed", "pluginID", pluginID, "error", err)
		emitEvent(pm.ctx, EventCrashRecoveryFailed, map[string]interface{}{
			"pluginID": pluginID,
			"error":    err.Error(),
		})
		return
	}
	pm.logger.Infow("plugin recovered after crash", "pluginID", pluginID)
	emitEvent(pm.ctx, EventRecovered, map[string]interface{}{"pluginID": pluginID})
}

// registerStateObserver adds an observer to a plugin's state machine that
// emits Wails events on every state transition.
func (pm *pluginManager) registerStateObserver(sm *lifecycle.PluginStateMachine) {
	sm.AddObserver(func(pluginID string, t lifecycle.Transition) {
		emitStateChange(pm.ctx, pluginID, t)
	})
}

// Shutdown stops all plugins and persists state.
func (pm *pluginManager) Shutdown() {
	for id, record := range pm.records {
		pm.shutdownPlugin(id, record)
	}

	if err := pm.pidTracker.Save(); err != nil {
		pm.logger.Warnw("failed to save plugin PID file", "error", err)
	}
}

// SetDevServerChecker sets the dev server checker.
func (pm *pluginManager) SetDevServerChecker(checker DevServerChecker) {
	pm.devServerCheck = checker
}

// SetDevServerManager sets the dev server manager.
func (pm *pluginManager) SetDevServerManager(mgr *devserver.DevServerManager) {
	pm.devServerMgr = mgr
}

// Initialize discovers and loads all installed plugins.
func (pm *pluginManager) Initialize(ctx context.Context) error {
	pm.ctx = ctx

	// Kill any orphaned plugin processes from a previous unclean shutdown.
	pm.pidTracker.CleanupStale(pm.logger)

	if err := auditPluginDir(); err != nil {
		return err
	}

	states, err := readPluginStateJSON()
	if err != nil {
		pm.logger.Warnw("failed to read plugin state file, reconciling from filesystem", "error", err)
		reconciler := NewReconciler(pm.logger)
		result, reconErr := reconciler.ReconcileFromFilesystem(getPluginDir())
		if reconErr != nil {
			pm.logger.Errorw("filesystem reconciliation failed", "error", reconErr)
		} else {
			states = make([]plugintypes.PluginStateRecord, 0, len(result.Records))
			for _, r := range result.Records {
				states = append(states, r.ToStateRecord())
			}
			pm.logger.Infow("recovered plugin state from filesystem", "count", len(states))
		}
	}

	pm.logger.Debugw("Loading plugins states from disk", "states", states)

	files, err := os.ReadDir(getPluginDir())
	if err != nil {
		return fmt.Errorf("error reading plugin directory: %w", err)
	}

	// Reverse migration: rename <id>-dev → <id> if needed.
	pluginDir := getPluginDir()
	for _, state := range states {
		devDir := filepath.Join(pluginDir, state.ID+"-dev")
		canonDir := filepath.Join(pluginDir, state.ID)

		devExists := false
		if info, statErr := os.Stat(devDir); statErr == nil && info.IsDir() {
			devExists = true
		}
		canonExists := false
		if info, statErr := os.Stat(canonDir); statErr == nil && info.IsDir() {
			canonExists = true
		}

		if devExists && !canonExists {
			pm.logger.Infow("migrating dev plugin directory to canonical ID",
				"from", devDir, "to", canonDir)
			if renameErr := os.Rename(devDir, canonDir); renameErr != nil {
				pm.logger.Errorw("failed to rename dev plugin directory",
					"from", devDir, "to", canonDir, "error", renameErr)
			}
		}
	}

	// Build a lookup for persisted state.
	stateByID := make(map[string]plugintypes.PluginStateRecord)
	for _, s := range states {
		stateByID[s.ID] = s
	}

	// Phase 1: Load all plugins using existing binaries on disk.
	type devEntry struct {
		pluginID string
		devPath  string
	}
	var devPlugins []devEntry

	for _, file := range files {
		if !file.IsDir() {
			continue
		}

		var opts *LoadPluginOptions
		if state, ok := stateByID[file.Name()]; ok {
			opts = &LoadPluginOptions{
				ExistingState: &state,
			}
			if state.DevMode && state.DevPath != "" {
				devPlugins = append(devPlugins, devEntry{
					pluginID: state.ID,
					devPath:  state.DevPath,
				})
			}
		}

		if _, err = pm.LoadPlugin(file.Name(), opts); err != nil {
			pm.logger.Errorw("error loading plugin", "pluginID", file.Name(), "error", err)
		}
	}

	// Phase 2: Start dev servers in the background.
	if len(devPlugins) > 0 && pm.devServerMgr != nil {
		go func() {
			var wg sync.WaitGroup
			for _, dp := range devPlugins {
				wg.Add(1)
				go func(pluginID, devPath string) {
					defer wg.Done()
					pm.logger.Infow("starting dev server (background)", "pluginID", pluginID, "devPath", devPath)
					if _, startErr := pm.devServerMgr.StartDevServerForPath(pluginID, devPath); startErr != nil {
						pm.logger.Warnw("failed to start dev server", "pluginID", pluginID, "error", startErr)
					}
				}(dp.pluginID, dp.devPath)
			}
			wg.Wait()
			pm.logger.Infow("all dev servers started")
		}()
	}

	// Merge loaded plugin state with persisted state so that plugins which
	// failed to load this time (e.g. missing binary) are not lost.
	if err = pm.mergeAndWritePluginState(states); err != nil {
		pm.logger.Error(err)
	}

	runtime.EventsEmit(pm.ctx, EventInitComplete)

	return nil
}

// GetPlugin returns the plugin with the given ID.
func (pm *pluginManager) GetPlugin(id string) (sdktypes.PluginInfo, error) {
	record, ok := pm.records[id]
	if !ok {
		return sdktypes.PluginInfo{}, fmt.Errorf("plugin '%s' not found", id)
	}
	return record.ToInfo(), nil
}

// ListPlugins returns all loaded plugins.
func (pm *pluginManager) ListPlugins() []sdktypes.PluginInfo {
	plugins := make([]sdktypes.PluginInfo, 0, len(pm.records))
	for _, record := range pm.records {
		plugins = append(plugins, record.ToInfo())
	}
	return plugins
}

// GetPluginMeta returns the metadata for a plugin.
func (pm *pluginManager) GetPluginMeta(id string) (config.PluginMeta, error) {
	record, ok := pm.records[id]
	if !ok {
		return config.PluginMeta{}, fmt.Errorf("plugin '%s' not found", id)
	}
	return record.Metadata, nil
}

// ListPluginMetas returns metadata for all loaded plugins.
func (pm *pluginManager) ListPluginMetas() []config.PluginMeta {
	var metas []config.PluginMeta
	for _, record := range pm.records {
		metas = append(metas, record.Metadata)
	}
	return metas
}

// GetPluginVersions fetches version info for a marketplace plugin.
func (pm *pluginManager) GetPluginVersions(pluginID string) ([]registry.VersionInfo, error) {
	return pm.registryClient.GetPluginVersions(context.Background(), pluginID)
}

// syncRegistryURL checks if the marketplace URL setting has changed.
func (pm *pluginManager) syncRegistryURL() {
	url, err := pm.settingsProvider.GetString("developer.marketplace_url")
	if err != nil {
		return
	}
	pm.registryClient.SetBaseURL(url)
}

// ListAvailablePlugins returns all available marketplace plugins.
func (pm *pluginManager) ListAvailablePlugins() ([]registry.AvailablePlugin, error) {
	pm.syncRegistryURL()
	return pm.registryClient.ListPlugins(context.Background())
}

// SearchPlugins searches the marketplace with filters.
func (pm *pluginManager) SearchPlugins(query, category, sort string) ([]registry.AvailablePlugin, error) {
	pm.syncRegistryURL()
	return pm.registryClient.SearchPlugins(context.Background(), query, category, sort)
}

// GetPluginReadme fetches the README for a marketplace plugin.
func (pm *pluginManager) GetPluginReadme(pluginID string) (string, error) {
	pm.syncRegistryURL()
	return pm.registryClient.GetPluginReadme(context.Background(), pluginID)
}

// GetPluginReviews fetches reviews for a marketplace plugin.
func (pm *pluginManager) GetPluginReviews(pluginID string, page int) ([]registry.Review, error) {
	pm.syncRegistryURL()
	return pm.registryClient.GetPluginReviews(context.Background(), pluginID, page)
}

// GetPluginDownloadStats fetches download statistics for a marketplace plugin.
func (pm *pluginManager) GetPluginDownloadStats(pluginID string) (*registry.DownloadStats, error) {
	pm.syncRegistryURL()
	return pm.registryClient.GetPluginDownloadStats(context.Background(), pluginID)
}

// GetPluginReleaseHistory fetches version history for a marketplace plugin.
func (pm *pluginManager) GetPluginReleaseHistory(pluginID string) ([]registry.VersionInfo, error) {
	pm.syncRegistryURL()
	return pm.registryClient.GetPluginVersions(context.Background(), pluginID)
}
