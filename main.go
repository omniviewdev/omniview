package main

import (
	"context"
	"embed"
	"fmt"
	"os"

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
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/bootstrap"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
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

//nolint:funlen // main function is expected to be long
func main() {
	// Initialize unified state directory.
	stateDir, err := appstate.New()
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: failed to initialize state directory: %v\n", err)
		os.Exit(1)
	}
	defer stateDir.Close()

	// Open bbolt settings store.
	logDir := stateDir.Logs().ResolvePath("")

	settingsStore, err := settingsstore.Open(stateDir.RootDir().ResolvePath("settings.db"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to open settings store: %v\n", err)
	}
	if settingsStore != nil {
		defer settingsStore.Close()
		if migrateErr := settingsstore.MigrateFromGOB(stateDir.Root(), settingsStore); migrateErr != nil {
			fmt.Fprintf(os.Stderr, "warning: settings migration had errors: %v\n", migrateErr)
		}
	}

	// Seed telemetry config from persisted bbolt settings so that telemetry
	// starts with the user's saved preferences rather than defaults.
	telemetryCfg := telemetry.DefaultConfig(version.IsDevelopment())
	if settingsStore != nil {
		if telVals, loadErr := settingsStore.LoadCategory("telemetry"); loadErr == nil && len(telVals) > 0 {
			if v, ok := telVals["enabled"].(bool); ok {
				telemetryCfg.Enabled = v
			}
			if v, ok := telVals["traces"].(bool); ok {
				telemetryCfg.Traces = v
			}
			if v, ok := telVals["metrics"].(bool); ok {
				telemetryCfg.Metrics = v
			}
			if v, ok := telVals["logs_ship"].(bool); ok {
				telemetryCfg.LogsShip = v
			}
			if v, ok := telVals["logs_ship_level"].(string); ok {
				telemetryCfg.LogsShipLevel = v
			}
			if v, ok := telVals["profiling"].(bool); ok {
				telemetryCfg.Profiling = v
			}
			if v, ok := telVals["endpoint_otlp"].(string); ok {
				telemetryCfg.OTLPEndpoint = v
			}
			if v, ok := telVals["endpoint_pyroscope"].(string); ok {
				telemetryCfg.PyroscopeEndpoint = v
			}
			if v, ok := telVals["auth_header"].(string); ok {
				telemetryCfg.AuthHeader = v
			}
			if v, ok := telVals["auth_value"].(string); ok {
				telemetryCfg.AuthValue = v
			}
		}
	}

	// Bootstrap telemetry (tracing, metrics, log shipping, profiling).
	telemetrySvc := telemetry.New(
		telemetryCfg,
		version.Version,
		version.GitCommit,
		version.BuildDate,
		version.IsDevelopment(),
		logDir,
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

	if settingsStore == nil {
		log.Warnw(context.Background(), "settings persistence disabled; all settings will use defaults")
	}

	diagnosticsClient := diagnostics.NewDiagnosticsClient(version.IsDevelopment(), logDir)

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
	resourceController := resource.NewController(log, settingsProvider, stateDir.PluginStore)

	settingsController := settings.NewController(log, settingsProvider, settingsStore)

	execController := exec.NewController(log, settingsProvider, resourceController)

	networkerController := networker.NewController(log, settingsProvider, resourceController)

	logsController := pluginlogs.NewController(log, settingsProvider, resourceController)

	metricController := pluginmetric.NewController(log, settingsProvider, resourceController)

	dataController := data.NewController(log, stateDir.PluginData)

	// Initialize per-plugin log manager for capturing plugin process stderr.
	// Created here so it can be bound to Wails for UI access.
	pluginLogManager, pluginLogErr := pluginlog.NewManager(
		logDir,
		pluginlog.DefaultRotation(),
	)
	if pluginLogErr != nil {
		log.Warnw(context.Background(), "failed to initialize plugin log manager", "error", pluginLogErr)
	}

	pluginRegistryClient := registry.NewClient("")
	pluginManager := plugin.NewManager(
		log,
		stateDir.RootDir(),
		stateDir.Plugins(),
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
		stateDir.RootDir(),
		stateDir.Plugins(),
		&plugin.PluginRefAdapter{Mgr: pluginManager},
		&plugin.PluginReloaderAdapter{Mgr: pluginManager},
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
	bootstrapSvc := &bootstrap.Service{
		Log:                  log,
		SettingsProvider:     settingsProvider,
		SettingsStore:        settingsStore,
		TelemetrySvc:         telemetrySvc,
		PluginManager:        pluginManager,
		PluginRegistryClient: pluginRegistryClient,
	}

	// Set up plugin asset handler middleware
	pluginAssetHandler := NewPluginAssetHandler(log, stateDir.RootDir())

	// Wrap the plugin manager interface in a concrete struct for v3 service
	// registration (NewService requires a concrete pointer type).
	pluginManagerSvc := &plugin.ServiceWrapper{Mgr: pluginManager}

	// Build the service list. All concrete pointer types use NewService directly.
	// BootstrapService is registered first so startup logic runs before other
	// services that might depend on initialized controllers. It has no
	// frontend-facing methods — only ServiceStartup/ServiceShutdown.
	// Service registration order matters: Wails calls ServiceStartup in order.
	// Controllers must be initialized (receive ctx + app) BEFORE the bootstrap
	// service, because bootstrap calls pluginManager.Initialize() which triggers
	// OnPluginStart on all controllers — they need ctx for gRPC streams.
	services := []application.Service{
		// 1. Controllers — need ctx before plugin loading
		application.NewService(&resource.ServiceWrapper{Ctrl: resourceController}),
		application.NewService(&settings.ServiceWrapper{Ctrl: settingsController}),
		application.NewService(&exec.ServiceWrapper{Ctrl: execController}),
		application.NewService(&networker.ServiceWrapper{Ctrl: networkerController}),
		application.NewService(&pluginlogs.ServiceWrapper{Ctrl: logsController}),
		application.NewService(&pluginmetric.ServiceWrapper{Ctrl: metricController}),
		application.NewService(&data.ServiceWrapper{Ctrl: dataController}),
		application.NewService(ui.NewServiceWrapper(uiManager)),
		application.NewService(utilsClient),
		application.NewService(&devserver.ServiceWrapper{Mgr: devServerManager}),
		// 2. Bootstrap — initializes settings, telemetry, loads plugins
		application.NewService(bootstrapSvc),
		// 3. Frontend-facing services (no startup order dependency)
		application.NewService(appService),
		application.NewService(diagnosticsClient),
		application.NewService(telemetry.NewTelemetryBinding(telemetrySvc)),
		application.NewService(&coresettings.ServiceWrapper{
			Provider: settingsProvider,
			CategoryMeta: map[string]pkgsettings.Category{
				coresettings.General.ID:    coresettings.General,
				coresettings.Appearance.ID: coresettings.Appearance,
				coresettings.Terminal.ID:   coresettings.Terminal,
				coresettings.Editor.ID:     coresettings.Editor,
				coresettings.Developer.ID:  coresettings.Developer,
				coresettings.Telemetry.ID:  coresettings.Telemetry,
			},
		}),
		application.NewService(pluginManagerSvc),
	}

	if pluginLogManager != nil {
		services = append(services, application.NewService(&pluginlog.ServiceWrapper{Mgr: pluginLogManager}))
	}

	// Create the Wails v3 application
	app := application.New(application.Options{
		Name:        "Omniview",
		Description: fmt.Sprintf("Omniview %s", version.Version),
		Icon:        icon,
		Services:    services,
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: pluginAssetHandler.Middleware,
		},
		// Server mode options — used when built with -tags server for
		// headless/CI testing (e.g. Playwright E2E).
		Server: application.ServerOptions{
			Host: "localhost",
			Port: 34115,
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
		UseApplicationMenu: true,
		Mac: application.MacWindow{
			TitleBar:   application.MacTitleBarHiddenInset,
			Appearance: application.NSAppearanceNameDarkAqua,
			Backdrop:   application.MacBackdropTranslucent,
		},
	})

	// Set up menus, keybindings, and context menus
	menus.SetupAppMenu(app, mainWindow)
	menus.SetupKeyBindings(app)
	menus.SetupContextMenus(app)

	// Set up window manager (registers hide-on-close hook, etc.)
	_ = window.NewManager(app, mainWindow)

	// Run the application
	if err := app.Run(); err != nil {
		log.Fatalw(context.Background(), "wails app exited with error", "error", err)
	}
}
