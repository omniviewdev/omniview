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

// PluginManagerService wraps the plugin.Manager interface so it can be
// registered as a Wails v3 service (which requires a concrete pointer type).
// Embedding the interface promotes all its methods to the wrapper struct.
type PluginManagerService struct {
	plugin.Manager
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
	log                 logging.Logger
	settingsProvider    pkgsettings.Provider
	telemetrySvc        *telemetry.Service
	resourceController  resource.Controller
	execController      exec.Controller
	logsController      pluginlogs.Controller
	metricController    pluginmetric.Controller
	networkerController networker.Controller
	devServerManager    *devserver.DevServerManager
	pluginManager       plugin.Manager
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

	b.resourceController.Run(ctx)
	b.execController.Run(ctx)
	b.logsController.Run(ctx)
	b.metricController.Run(ctx)
	b.networkerController.Run(ctx)

	// Initialize dev server manager first so it has a context before
	// pluginManager.Initialize() auto-starts dev servers.
	b.devServerManager.Initialize(ctx)

	// Initialize the plugin system
	if err := b.pluginManager.Initialize(ctx); err != nil {
		b.log.Errorw(ctx, "error while initializing plugin system", "error", err)
	}
	b.pluginManager.Run(ctx)

	return nil
}

func (b *BootstrapService) ServiceShutdown() error {
	b.devServerManager.Shutdown()
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
	uiClient := ui.NewClient(uiManager)

	managers := map[string]types.PluginManager{
		"ui": uiManager,
	}

	utilsClient := utils.NewClient()

	// Setup the plugin systems
	resourceController := resource.NewController(log, settingsProvider)
	resourceClient := resource.NewClient(resourceController)

	settingsController := settings.NewController(log, settingsProvider)
	settingsClient := settings.NewClient(settingsController)

	execController := exec.NewController(log, settingsProvider, resourceController)
	execClient := exec.NewClient(execController)

	networkerController := networker.NewController(log, settingsProvider, resourceController)
	networkerClient := networker.NewClient(networkerController)

	logsController := pluginlogs.NewController(log, settingsProvider, resourceController)
	logsClient := pluginlogs.NewClient(logsController)

	metricController := pluginmetric.NewController(log, settingsProvider, resourceController)
	metricClient := pluginmetric.NewClient(metricController)

	dataController := data.NewController(log)
	dataClient := data.NewClient(dataController)

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
		resourceController:   resourceController,
		execController:       execController,
		logsController:       logsController,
		metricController:     metricController,
		networkerController:  networkerController,
		devServerManager:     devServerManager,
		pluginManager:        pluginManager,
		pluginRegistryClient: pluginRegistryClient,
	}

	// Set up plugin asset handler middleware
	pluginAssetHandler := NewPluginAssetHandler(log)

	// Wrap the plugin manager interface in a concrete struct for v3 service
	// registration (NewService requires a concrete pointer type).
	pluginManagerSvc := &PluginManagerService{Manager: pluginManager}

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
		application.NewService(devServerManager),
		application.NewService(resourceClient),
		application.NewService(settingsClient),
		application.NewService(execClient),
		application.NewService(networkerClient),
		application.NewService(logsClient),
		application.NewService(metricClient),
		application.NewService(dataClient),
		application.NewService(uiClient),
		application.NewService(utilsClient),
	}

	if pluginLogManager != nil {
		services = append(services, application.NewService(pluginLogManager))
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
