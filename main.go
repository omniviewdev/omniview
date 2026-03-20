package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	"github.com/wailsapp/wails/v3/pkg/application"

	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/diagnostics"
	"github.com/omniviewdev/omniview/backend/menus"
	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/data"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	pluginlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	pluginmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/ui"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	"github.com/omniviewdev/omniview/backend/window"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	"github.com/omniviewdev/omniview/internal/telemetry"
	"github.com/omniviewdev/omniview/internal/version"
)

const (
	DefaultWebviewWidth  = 1920
	DefaultWebviewHeight = 1080
	MinWebviewWidth      = 1280
	MinWebviewHeight     = 800
)

//go:embed all:dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

// pluginRefAdapter adapts plugin.Manager to devserver.PluginRef.
type pluginRefAdapter struct{ mgr plugin.Manager }

func (a *pluginRefAdapter) GetDevPluginInfo(pluginID string) (bool, string, error) {
	info, err := a.mgr.GetPlugin(pluginID)
	if err != nil {
		return false, "", err
	}
	return info.DevMode, info.DevPath, nil
}

// pluginReloaderAdapter adapts plugin.Manager to devserver.PluginReloader.
type pluginReloaderAdapter struct{ mgr plugin.Manager }

func (a *pluginReloaderAdapter) ReloadPlugin(id string) error {
	_, err := a.mgr.ReloadPlugin(id)
	return err
}

// PluginManagerService exposes only the frontend-safe methods of plugin.Manager.
// Internal methods (SetDevServerChecker, SetPluginLogManager, HandlePluginCrash,
// Initialize, Run, Shutdown) are excluded to avoid binding warnings from
// interface/function-type parameters.
type PluginManagerService struct {
	mgr plugin.Manager
}

func (s *PluginManagerService) InstallInDevMode() (*config.PluginMeta, error) {
	return s.mgr.InstallInDevMode()
}
func (s *PluginManagerService) InstallFromPathPrompt() (*config.PluginMeta, error) {
	return s.mgr.InstallFromPathPrompt()
}
func (s *PluginManagerService) InstallPluginFromPath(path string) (*config.PluginMeta, error) {
	return s.mgr.InstallPluginFromPath(path)
}
func (s *PluginManagerService) InstallPluginVersion(pluginID, version string) (*config.PluginMeta, error) {
	return s.mgr.InstallPluginVersion(pluginID, version)
}
func (s *PluginManagerService) LoadPlugin(id string, opts *plugin.LoadPluginOptions) (sdktypes.PluginInfo, error) {
	return s.mgr.LoadPlugin(id, opts)
}
func (s *PluginManagerService) ReloadPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.mgr.ReloadPlugin(id)
}
func (s *PluginManagerService) RetryFailedPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.mgr.RetryFailedPlugin(id)
}
func (s *PluginManagerService) UninstallPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.mgr.UninstallPlugin(id)
}
func (s *PluginManagerService) GetPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.mgr.GetPlugin(id)
}
func (s *PluginManagerService) ListPlugins() []sdktypes.PluginInfo {
	return s.mgr.ListPlugins()
}
func (s *PluginManagerService) GetPluginMeta(id string) (config.PluginMeta, error) {
	return s.mgr.GetPluginMeta(id)
}
func (s *PluginManagerService) ListPluginMetas() []config.PluginMeta {
	return s.mgr.ListPluginMetas()
}
func (s *PluginManagerService) ListAvailablePlugins() ([]registry.AvailablePlugin, error) {
	return s.mgr.ListAvailablePlugins()
}
func (s *PluginManagerService) SearchPlugins(query, category, sort string) ([]registry.AvailablePlugin, error) {
	return s.mgr.SearchPlugins(query, category, sort)
}
func (s *PluginManagerService) GetPluginReadme(pluginID string) (string, error) {
	return s.mgr.GetPluginReadme(pluginID)
}
func (s *PluginManagerService) GetPluginVersions(pluginID string) ([]registry.VersionInfo, error) {
	return s.mgr.GetPluginVersions(pluginID)
}
func (s *PluginManagerService) GetPluginReviews(pluginID string, page int) ([]registry.Review, error) {
	return s.mgr.GetPluginReviews(pluginID, page)
}
func (s *PluginManagerService) GetPluginDownloadStats(pluginID string) (*registry.DownloadStats, error) {
	return s.mgr.GetPluginDownloadStats(pluginID)
}
func (s *PluginManagerService) GetPluginReleaseHistory(pluginID string) ([]registry.VersionInfo, error) {
	return s.mgr.GetPluginReleaseHistory(pluginID)
}

// PluginLogService exposes only frontend-safe methods of pluginlog.Manager.
// Excludes OnEmit (EmitFunc type), Stream (io.Writer), Close, LogDir.
type PluginLogService struct {
	mgr *pluginlog.Manager
}

func (s *PluginLogService) GetLogs(pluginID string, count int) []pluginlog.LogEntry {
	return s.mgr.GetLogs(pluginID, count)
}
func (s *PluginLogService) ListStreams() []string {
	return s.mgr.ListStreams()
}
func (s *PluginLogService) SearchLogs(pluginID, pattern string) ([]pluginlog.LogEntry, error) {
	return s.mgr.SearchLogs(pluginID, pattern)
}
func (s *PluginLogService) Subscribe(pluginID string) int {
	return s.mgr.Subscribe(pluginID)
}
func (s *PluginLogService) Unsubscribe(pluginID string) int {
	return s.mgr.Unsubscribe(pluginID)
}

// DevServerService exposes only frontend-safe methods of devserver.DevServerManager.
// The DevServerManager implements ServiceStartup/ServiceShutdown directly,
// but registering it raw causes service/model shadowing. This wrapper separates
// the service identity from the model type.
type DevServerService struct {
	mgr *devserver.DevServerManager
}

func (s *DevServerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return s.mgr.ServiceStartup(ctx, options)
}
func (s *DevServerService) ServiceShutdown() error {
	return s.mgr.ServiceShutdown()
}
func (s *DevServerService) StartDevServer(pluginID string) (devserver.DevServerState, error) {
	return s.mgr.StartDevServer(pluginID)
}
func (s *DevServerService) StartDevServerForPath(pluginID, devPath string) (devserver.DevServerState, error) {
	return s.mgr.StartDevServerForPath(pluginID, devPath)
}
func (s *DevServerService) StopDevServer(pluginID string) error {
	return s.mgr.StopDevServer(pluginID)
}
func (s *DevServerService) RestartDevServer(pluginID string) (devserver.DevServerState, error) {
	return s.mgr.RestartDevServer(pluginID)
}
func (s *DevServerService) RebuildPlugin(pluginID string) error {
	return s.mgr.RebuildPlugin(pluginID)
}
func (s *DevServerService) GetDevServerState(pluginID string) devserver.DevServerState {
	return s.mgr.GetDevServerState(pluginID)
}
func (s *DevServerService) ListDevServerStates() []devserver.DevServerState {
	return s.mgr.ListDevServerStates()
}
func (s *DevServerService) GetDevServerLogs(pluginID string, count int) []devserver.LogEntry {
	return s.mgr.GetDevServerLogs(pluginID, count)
}
func (s *DevServerService) IsManaged(pluginID string) bool {
	return s.mgr.IsManaged(pluginID)
}
func (s *DevServerService) GetExternalPluginInfo(pluginID string) *devserver.DevInfoFile {
	return s.mgr.GetExternalPluginInfo(pluginID)
}

// ResourceControllerService wraps the resource.Controller interface so it can
// be registered as a Wails v3 service (which requires a concrete pointer type).
// Embedding the interface promotes all its methods to the wrapper struct.
type ResourceControllerService struct {
	resource.Controller
}

func (s *ResourceControllerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.Controller.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}

func (s *ResourceControllerService) ServiceShutdown() error {
	if ss, ok := s.Controller.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}

// SettingsControllerService wraps the settings.Controller interface.
type SettingsControllerService struct {
	settings.Controller
}

// ExecControllerService wraps the exec.Controller interface.
type ExecControllerService struct {
	exec.Controller
}

// LogsControllerService wraps the pluginlogs.Controller interface.
type LogsControllerService struct {
	pluginlogs.Controller
}

// MetricControllerService wraps the pluginmetric.Controller interface.
type MetricControllerService struct {
	pluginmetric.Controller
}

// NetworkerControllerService wraps the networker.Controller interface.
type NetworkerControllerService struct {
	networker.Controller
}

// DataControllerService wraps the data.Controller interface.
type DataControllerService struct {
	data.Controller
}

// SettingsProviderService wraps the settings.Provider interface so it can be
// registered as a Wails v3 service.
type SettingsProviderService struct {
	pkgsettings.Provider
}

// BootstrapService wraps the startup/shutdown logic that was previously in the
// Wails v2 OnStartup/OnShutdown closures. It implements ServiceStartup and
// ServiceShutdown so the Wails v3 runtime calls it automatically.
type BootstrapService struct {
	log                  logging.Logger
	settingsProvider     pkgsettings.Provider
	telemetrySvc         *telemetry.Service
	pluginManager        plugin.Manager
	pluginRegistryClient *registry.Client
}

func (b *BootstrapService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	// Initialize the settings
	if err := b.settingsProvider.Initialize(
		ctx,
		coresettings.General,
		coresettings.Appearance,
		coresettings.Terminal,
		coresettings.Editor,
		coresettings.Developer,
		coresettings.Telemetry,
	); err != nil {
		b.log.Errorw(ctx, "error while initializing settings system", "error", err)
	}

	// Wire telemetry settings hot-toggle: when any setting in the
	// "telemetry" category changes, rebuild TelemetryConfig and apply.
	telemetryFromSettings := func(vals map[string]any) telemetry.TelemetryConfig {
		cfg := b.telemetrySvc.Config()
		if v, ok := vals["enabled"].(bool); ok {
			cfg.Enabled = v
		}
		if v, ok := vals["traces"].(bool); ok {
			cfg.Traces = v
		}
		if v, ok := vals["metrics"].(bool); ok {
			cfg.Metrics = v
		}
		if v, ok := vals["logs_ship"].(bool); ok {
			cfg.LogsShip = v
		}
		if v, ok := vals["logs_ship_level"].(string); ok {
			cfg.LogsShipLevel = v
		}
		if v, ok := vals["profiling"].(bool); ok {
			cfg.Profiling = v
		}
		if v, ok := vals["endpoint_otlp"].(string); ok {
			cfg.OTLPEndpoint = v
		}
		if v, ok := vals["endpoint_pyroscope"].(string); ok {
			cfg.PyroscopeEndpoint = v
		}
		if v, ok := vals["auth_header"].(string); ok {
			cfg.AuthHeader = v
		}
		if v, ok := vals["auth_value"].(string); ok {
			cfg.AuthValue = v
		}
		return cfg
	}

	b.settingsProvider.RegisterChangeHandler("telemetry", func(vals map[string]any) {
		cfg := telemetryFromSettings(vals)
		if err := b.telemetrySvc.ApplyConfig(ctx, cfg); err != nil {
			b.log.Errorw(ctx, "failed to apply telemetry config change", "error", err)
		} else {
			b.log.Infow(ctx, "telemetry config updated from settings")
		}
	})

	// Apply the persisted telemetry settings immediately so telemetry
	// activates on startup (the change handler only fires on changes).
	if vals, err := b.settingsProvider.GetCategoryValues("telemetry"); err == nil {
		cfg := telemetryFromSettings(vals)
		if err := b.telemetrySvc.ApplyConfig(ctx, cfg); err != nil {
			b.log.Errorw(ctx, "failed to apply initial telemetry config", "error", err)
		} else {
			b.log.Infow(ctx, "telemetry initialized from persisted settings", "enabled", cfg.Enabled)
		}
	}

	// Apply user-configured marketplace URL to the registry client.
	if marketplaceURL, err := b.settingsProvider.GetString("developer.marketplace_url"); err == nil && marketplaceURL != "" {
		b.pluginRegistryClient.SetBaseURL(marketplaceURL)
		safeHost := marketplaceURL
		if u, parseErr := url.Parse(marketplaceURL); parseErr == nil {
			safeHost = u.Host
		}
		b.log.Infow(ctx, "using custom marketplace URL", "host", safeHost)
	}

	// Controllers now implement ServiceStartup/ServiceShutdown and are
	// registered as Wails v3 services, so Wails calls their lifecycle
	// methods automatically.

	// Initialize the plugin system
	if err := b.pluginManager.Initialize(ctx); err != nil {
		b.log.Errorw(ctx, "error while initializing plugin system", "error", err)
	}
	b.pluginManager.Run(ctx)

	return nil
}

func (b *BootstrapService) ServiceShutdown() error {
	// DevServerManager and controllers have their own ServiceShutdown
	// called by Wails v3 automatically.
	b.pluginManager.Shutdown()
	_ = b.telemetrySvc.Shutdown(context.Background())
	return nil
}

//nolint:funlen // main function is expected to be long
func main() {
	// Bootstrap telemetry (tracing, metrics, log shipping, profiling).
	telemetryCfg := telemetry.DefaultConfig(version.IsDevelopment())
	telemetrySvc := telemetry.New(
		telemetryCfg,
		version.Version,
		version.GitCommit,
		version.BuildDate,
		version.IsDevelopment(),
	)
	if err := telemetrySvc.Init(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "telemetry init failed, continuing without telemetry: %v\n", err)
	}
	zapLogger := telemetrySvc.ZapLogger()
	if zapLogger == nil {
		zapLogger, _ = zap.NewProduction()
	}
	log := logging.New(logging.Config{
		Name:    "omniview",
		Backend: telemetry.NewZapBackend(zapLogger),
		Level:   logging.NewLevelController(logging.LevelDebug),
	})

	diagnosticsClient := diagnostics.NewDiagnosticsClient(version.IsDevelopment())

	settingsProvider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{
		Logger: zapLogger.Sugar(),
	})

	// Create our plugin system managers
	uiManager := ui.NewComponentManager(log)

	managers := map[string]types.PluginManager{
		"ui": uiManager,
	}

	utilsClient := utils.NewClient()

	// Setup the plugin systems
	resourceController := resource.NewController(log, settingsProvider)

	settingsController := settings.NewController(log, settingsProvider)

	execController := exec.NewController(log, settingsProvider, resourceController)

	networkerController := networker.NewController(log, settingsProvider, resourceController)

	logsController := pluginlogs.NewController(log, settingsProvider, resourceController)

	metricController := pluginmetric.NewController(log, settingsProvider, resourceController)

	dataController := data.NewController(log)

	// Initialize per-plugin log manager for capturing plugin process stderr.
	// Created here so it can be bound to Wails for UI access.
	home, _ := os.UserHomeDir()
	pluginLogManager, pluginLogErr := pluginlog.NewManager(
		filepath.Join(home, ".omniview", "logs"),
		pluginlog.DefaultRotation(),
	)
	if pluginLogErr != nil {
		log.Warnw(context.Background(), "failed to initialize plugin log manager", "error", pluginLogErr)
	}

	pluginRegistryClient := registry.NewClient("")
	pluginManager := plugin.NewManager(
		log,
		resourceController,
		settingsController,
		execController,
		networkerController,
		logsController,
		metricController,
		managers,
		settingsProvider,
		pluginRegistryClient,
		func() plugin.TelemetryEnvConfig {
			cfg := telemetrySvc.Config()
			return plugin.TelemetryEnvConfig{
				Enabled:           cfg.Enabled,
				OTLPEndpoint:      cfg.OTLPEndpoint,
				Profiling:         cfg.Profiling,
				PyroscopeEndpoint: cfg.PyroscopeEndpoint,
			}
		},
	)

	// Wire crash recovery: when a plugin crash is detected by the resource
	// controller's event listeners, the manager will attempt to reload it.
	resourceController.SetCrashCallback(pluginManager.HandlePluginCrash)

	devServerManager := devserver.NewDevServerManager(
		log,
		&pluginRefAdapter{mgr: pluginManager},
		&pluginReloaderAdapter{mgr: pluginManager},
		settingsProvider,
	)

	// Wire the dev server checker into the plugin manager so the old watcher
	// skips plugins managed by DevServerManager.
	pluginManager.SetDevServerChecker(devServerManager)
	pluginManager.SetDevServerManager(devServerManager)

	if pluginLogManager != nil {
		pluginManager.SetPluginLogManager(pluginLogManager)
	}

	// Create the AppService
	appService := NewAppService()

	// Create the bootstrap service that wraps startup/shutdown logic
	bootstrapService := &BootstrapService{
		log:                  log,
		settingsProvider:     settingsProvider,
		telemetrySvc:         telemetrySvc,
		pluginManager:        pluginManager,
		pluginRegistryClient: pluginRegistryClient,
	}

	// Set up plugin asset handler middleware
	pluginAssetHandler := NewPluginAssetHandler(log)

	// Wrap the plugin manager interface in a concrete struct for v3 service
	// registration (NewService requires a concrete pointer type).
	pluginManagerSvc := &PluginManagerService{mgr: pluginManager}

	// Build the service list. All concrete pointer types use NewService directly.
	// The BootstrapService must come first so startup logic runs before other
	// services that might depend on initialized controllers.
	services := []application.Service{
		application.NewService(bootstrapService),
		application.NewService(appService),
		application.NewService(diagnosticsClient),
		application.NewService(telemetry.NewTelemetryBinding(telemetrySvc)),
		application.NewService(&SettingsProviderService{Provider: settingsProvider}),
		application.NewService(pluginManagerSvc),
		application.NewService(&DevServerService{mgr: devServerManager}),
		application.NewService(&ResourceControllerService{Controller: resourceController}),
		application.NewService(&SettingsControllerService{Controller: settingsController}),
		application.NewService(&ExecControllerService{Controller: execController}),
		application.NewService(&NetworkerControllerService{Controller: networkerController}),
		application.NewService(&LogsControllerService{Controller: logsController}),
		application.NewService(&MetricControllerService{Controller: metricController}),
		application.NewService(&DataControllerService{Controller: dataController}),
		application.NewService(ui.NewServiceWrapper(uiManager)),
		application.NewService(utilsClient),
	}

	if pluginLogManager != nil {
		services = append(services, application.NewService(&PluginLogService{mgr: pluginLogManager}))
	}

	// Strip the "dist" prefix from the embedded FS so assets are served at /.
	distFS, fsErr := fs.Sub(assets, "dist")
	if fsErr != nil {
		log.Fatalw(context.Background(), "failed to create sub filesystem for embedded assets", "error", fsErr)
	}

	// Create the Wails v3 application
	app := application.New(application.Options{
		Name:        "Omniview",
		Description: fmt.Sprintf("Omniview %s", version.Version),
		Icon:        icon,
		Services:    services,
		Assets: application.AssetOptions{
			Handler:    http.FileServerFS(distFS),
			Middleware: pluginAssetHandler.Middleware,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			ProgramName: "Omniview",
		},
	})

	// Create the main window
	mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "Omniview",
		Width:     DefaultWebviewWidth,
		Height:    DefaultWebviewHeight,
		MinWidth:  MinWebviewWidth,
		MinHeight: MinWebviewHeight,
		//nolint:gomnd // #0D1117 dark theme background
		BackgroundColour: application.NewRGBA(13, 17, 23, 255),
		Mac: application.MacWindow{
			TitleBar:   application.MacTitleBarHiddenInset,
			Appearance: application.NSAppearanceNameDarkAqua,
			Backdrop:   application.MacBackdropTranslucent,
		},
	})

	// Set up menus
	menus.SetupAppMenu(app, mainWindow)

	// Set up window manager (registers hide-on-close hook, etc.)
	_ = window.NewManager(app, mainWindow)

	// Run the application
	if err := app.Run(); err != nil {
		log.Fatalw(context.Background(), "wails app exited with error", "error", err)
	}
}
