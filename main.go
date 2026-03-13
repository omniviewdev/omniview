package main

import (
	"context"
	"embed"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"

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
	"github.com/omniviewdev/omniview/backend/pkg/trivy"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	"github.com/omniviewdev/omniview/internal/telemetry"
	"github.com/omniviewdev/omniview/internal/version"

	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
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
	trivyClient := trivy.NewManager(log)

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

	// Create an instance of the app structure
	app := NewApp()
	startup := func(ctx context.Context) {
		// Perform your setup here
		app.startup(ctx)

		// Initialize the settings
		if err := settingsProvider.Initialize(
			ctx,
			coresettings.General,
			coresettings.Appearance,
			coresettings.Terminal,
			coresettings.Editor,
			coresettings.Developer,
			coresettings.Telemetry,
		); err != nil {
			log.Errorw(ctx, "error while initializing settings system", "error", err)
		}

		// Wire telemetry settings hot-toggle: when any setting in the
		// "telemetry" category changes, rebuild TelemetryConfig and apply.
		telemetryFromSettings := func(vals map[string]any) telemetry.TelemetryConfig {
			cfg := telemetrySvc.Config()
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

		settingsProvider.RegisterChangeHandler("telemetry", func(vals map[string]any) {
			cfg := telemetryFromSettings(vals)
			if err := telemetrySvc.ApplyConfig(ctx, cfg); err != nil {
				log.Errorw(ctx, "failed to apply telemetry config change", "error", err)
			} else {
				log.Infow(ctx, "telemetry config updated from settings")
			}
		})

		// Apply the persisted telemetry settings immediately so telemetry
		// activates on startup (the change handler only fires on changes).
		if vals, err := settingsProvider.GetCategoryValues("telemetry"); err == nil {
			cfg := telemetryFromSettings(vals)
			if err := telemetrySvc.ApplyConfig(ctx, cfg); err != nil {
				log.Errorw(ctx, "failed to apply initial telemetry config", "error", err)
			} else {
				log.Infow(ctx, "telemetry initialized from persisted settings", "enabled", cfg.Enabled)
			}
		}

		// Apply user-configured marketplace URL to the registry client.
		if marketplaceURL, err := settingsProvider.GetString("developer.marketplace_url"); err == nil && marketplaceURL != "" {
			pluginRegistryClient.SetBaseURL(marketplaceURL)
			safeHost := marketplaceURL
			if u, parseErr := url.Parse(marketplaceURL); parseErr == nil {
				safeHost = u.Host
			}
			log.Infow(ctx, "using custom marketplace URL", "host", safeHost)
		}

		resourceController.Run(ctx)
		execController.Run(ctx)
		logsController.Run(ctx)
		metricController.Run(ctx)
		networkerController.Run(ctx)

		// Initialize dev server manager first so it has a context before
		// pluginManager.Initialize() auto-starts dev servers.
		devServerManager.Initialize(ctx)

		// Initialize the plugin system
		if err := pluginManager.Initialize(ctx); err != nil {
			log.Errorw(ctx, "error while initializing plugin system", "error", err)
		}
		pluginManager.Run(ctx)
		runtime.MenuSetApplicationMenu(ctx, menus.GetMenus(ctx))
	}

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "Omniview",
		Width:     DefaultWebviewWidth,
		Height:    DefaultWebviewHeight,
		MinWidth:  MinWebviewWidth,
		MinHeight: MinWebviewHeight,
		// MaxWidth:  1280,
		// MaxHeight:         800,
		DisableResize:     false,
		Fullscreen:        false,
		Frameless:         false,
		StartHidden:       false,
		HideWindowOnClose: false,
		//nolint:gomnd // #0D1117 dark theme background
		BackgroundColour: &options.RGBA{R: 13, G: 17, B: 23, A: 255},
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: NewFileLoader(log),
		},
		LogLevel:      logger.DEBUG,
		OnStartup:     startup,
		OnDomReady:    app.domReady,
		OnBeforeClose: app.beforeClose,
		OnShutdown: func(ctx context.Context) {
			devServerManager.Shutdown()
			pluginManager.Shutdown()
			_ = telemetrySvc.Shutdown(ctx)
		},
		WindowStartState: options.Normal,
		Bind: []any{
			app,
			diagnosticsClient,
			telemetry.NewTelemetryBinding(telemetrySvc),

			// core engines/providers
			settingsProvider,
			trivyClient,

			// plugin system
			pluginManager,
			pluginLogManager,
			devServerManager,
			resourceClient,
			settingsClient,
			execClient,
			networkerClient,
			logsClient,
			metricClient,
			dataClient,
			uiClient,
			utilsClient,
		},
		EnumBind: []any{
			pkgsettings.AllSettingTypes,
			trivy.AllCommands,
			trivy.AllScanners,
			sdktypes.AllConnectionStatusCodes,
			sdkresource.AllWatchStates,
			sdkresource.AllSyncPolicies,
		},
		// Windows platform specific options
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
			// DisableFramelessWindowDecorations: false,
			WebviewUserDataPath: "",
			ZoomFactor:          1.0,
		},
		// Mac platform specific options
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			Appearance:           mac.NSAppearanceNameDarkAqua,
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
			About: &mac.AboutInfo{
				Title: fmt.Sprintf("Omniview %s", version.Version),
				//nolint:lll // about info is naturally long
				Message: "The modern, lightweight, pluggable cross-platform IDE for DevOps engineers.\n\nCopyright © 2025",
				Icon:    icon,
			},
		},
		Linux: &linux.Options{
			ProgramName:         "Omniview",
			Icon:                icon,
			WebviewGpuPolicy:    linux.WebviewGpuPolicyOnDemand,
			WindowIsTranslucent: true,
		},
	})
	if err != nil {
		log.Fatalw(context.Background(), "wails app exited with error", "error", err)
	}
}
