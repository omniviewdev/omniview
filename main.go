package main

import (
	"context"
	"embed"
	"fmt"

	pkgsettings "github.com/omniviewdev/settings"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/omniviewdev/omniview/backend/clients"
	"github.com/omniviewdev/omniview/backend/diagnostics"
	"github.com/omniviewdev/omniview/backend/menus"
	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/ui"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	"github.com/omniviewdev/omniview/backend/pkg/trivy"
	coresettings "github.com/omniviewdev/omniview/internal/settings"

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

var (
	Version     = "0.0.0"
	Development = true
)

//nolint:funlen // main function is expected to be long
func main() {
	// nillogger := logger.NewFileLogger("/dev/null")
	log := clients.CreateLogger(Development)
	diagnosticsClient := diagnostics.NewDiagnosticsClient(Development)

	settingsProvider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{
		Logger: log,
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

	execController := exec.NewController(log, settingsProvider, resourceClient)
	execClient := exec.NewClient(execController)

	networkerController := networker.NewController(log, settingsProvider, resourceClient)
	networkerClient := networker.NewClient(networkerController)

	pluginRegistryClient := registry.NewRegistryClient()
	pluginManager := plugin.NewManager(
		log,
		resourceController,
		settingsController,
		execController,
		networkerController,
		managers,
		settingsProvider,
		pluginRegistryClient,
	)

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
		); err != nil {
			log.Errorw("error while initializing settings system", "error", err)
		}

		resourceController.Run(ctx)
		execController.Run(ctx)

		// Initialize the plugin system
		if err := pluginManager.Initialize(ctx); err != nil {
			log.Errorw("error while initializing plugin system", "error", err)
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
		//nolint:gomnd // signifies all black
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 255},
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: NewFileLoader(log),
		},
		LogLevel:      logger.DEBUG,
		OnStartup:     startup,
		OnDomReady:    app.domReady,
		OnBeforeClose: app.beforeClose,
		OnShutdown: func(_ context.Context) {
			pluginManager.Shutdown()
		},
		WindowStartState: options.Normal,
		Bind: []any{
			app,
			diagnosticsClient,

			// core engines/providers
			settingsProvider,
			trivyClient,

			// plugin system
			pluginManager,
			resourceClient,
			settingsClient,
			execClient,
			networkerClient,
			uiClient,
			utilsClient,
		},
		EnumBind: []any{
			pkgsettings.AllSettingTypes,
			trivy.AllCommands,
			trivy.AllScanners,
			sdktypes.AllConnectionStatusCodes,
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
				Title: fmt.Sprintf("Omniview %s", Version),
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
		log.Fatal(err)
	}
}
