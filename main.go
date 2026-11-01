package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/diagnostics"
	"github.com/omniviewdev/omniview/backend/menus"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
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
	"github.com/omniviewdev/omniview/backend/pkg/plugin/tools"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/ui"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	"github.com/omniviewdev/omniview/backend/window"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/bootstrap"
	"github.com/omniviewdev/omniview/internal/devcontract"
	controlhost "github.com/omniviewdev/omniview/internal/devcontrol/host"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/hostruntime"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/omniviewdev/omniview/internal/mcprelay"
	"github.com/omniviewdev/omniview/internal/profiling"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/omniviewdev/omniview/internal/shellenv"
	"github.com/omniviewdev/omniview/internal/telemetry"
	"github.com/omniviewdev/omniview/internal/version"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdkprofiling "github.com/omniviewdev/plugin-sdk/pkg/profiling"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const (
	DefaultWebviewWidth  = 1920
	DefaultWebviewHeight = 1080
	MinWebviewWidth      = 1280
	MinWebviewHeight     = 800

	appName = "Omniview"

	// serverModePort is the port used when built with -tags server.
	serverModePort = 34115

	// Main window background colour #0D1117 (dark theme), fully opaque.
	backgroundRed   = 13
	backgroundGreen = 17
	backgroundBlue  = 23
	backgroundAlpha = 255
)

//go:embed all:dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

func newUICapabilityControllers(
	log logging.Logger,
	settingsProvider pkgsettings.Provider,
	resourceController resource.Controller,
	resourceUIRealm *invocation.Scope,
) (exec.Controller, networker.Controller, pluginlogs.Controller, pluginmetric.Controller) {
	uiResourceService := &resource.ServiceWrapper{Ctrl: resourceController, Realm: resourceUIRealm}
	admitReference := func(ctx context.Context, operation, pluginID string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (context.Context, error) {
		return resourceController.AdmitReference(resourceUIRealm.Context(ctx), operation, pluginID, route, ref)
	}
	execController := exec.NewController(log, settingsProvider, uiResourceService)
	networkerController := networker.NewController(log, settingsProvider, uiResourceService)
	logsController := pluginlogs.NewController(log, settingsProvider, uiResourceService)
	metricController := pluginmetric.NewController(log, settingsProvider, uiResourceService)
	execController.SetReferenceAdmitter(admitReference)
	networkerController.SetReferenceAdmitter(admitReference)
	logsController.SetReferenceAdmitter(resourceController.AdmitReference)
	logsController.SetUIReferenceAdmitter(admitReference)
	metricController.SetReferenceAdmitter(admitReference)
	return execController, networkerController, logsController, metricController
}

// main resolves instance identity, initializes services and runs the host.
//
//nolint:funlen // main function is expected to be long
func main() {
	if handled, exit := hostruntime.HandleNativeProfileRemoval(os.Args[1:]); handled {
		os.Exit(exit)
	}
	// Identity and native availability must be resolved before any state,
	// migration, telemetry, or plugin side effect.
	profile, err := instance.ResolveEnvironment(version.Version, version.GitCommit)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: invalid runtime profile: %v\n", err)
		os.Exit(1)
	}
	// Finder does not inherit a terminal's login PATH. Resolve it before any
	// plugin or executable starts, while preserving host isolation authority.
	if err := shellenv.Restore(context.Background()); err != nil {
		fmt.Fprintln(os.Stderr, "warning: login environment unavailable; keeping inherited environment")
	}
	var pluginAssets, defaultAssets http.Handler
	options := application.Options{
		Name:        profile.Descriptor.DisplayName,
		Description: appName + " " + version.Version,
		Icon:        icon,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Server: application.ServerOptions{Host: "localhost", Port: serverModePort},
		Mac:    application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		Linux:  application.LinuxOptions{ProgramName: appName},
	}
	// The outer wrapper sees embedded assets and the internal Vite proxy alike.
	options.Assets.Middleware = func(next http.Handler) http.Handler {
		defaultAssets = next
		dispatch := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if pluginAssets != nil {
				pluginAssets.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
		return instance.BootMiddleware(profile.Descriptor.BootIdentity())(dispatch)
	}
	if policy := hostruntime.DevelopmentServerMiddleware(profile); policy != nil {
		options.Assets.Middleware = application.ChainMiddleware(policy, options.Assets.Middleware)
	}
	if profile.Descriptor.Kind != "development" {
		options.SingleInstance = &application.SingleInstanceOptions{
			UniqueID: "com.omniview." + profile.Descriptor.Channel,
			ExitCode: 0,
		}
	}
	if err := hostruntime.ConfigureNativeProfile(&options, profile); err != nil {
		fmt.Fprintf(os.Stderr, "fatal: native profile storage unavailable: %v\n", err)
		os.Exit(1)
	}
	// This stable guard lives outside the purgable profile. Acquire it before
	// creating/opening state so purge/seed cannot replace the held root-lock
	// inode and permit a concurrent writer through a newly created .lock.
	var releaseProfile func() error
	if profile.Descriptor.Kind == "development" {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintf(os.Stderr, "fatal: cannot locate profile guard: %v\n", err)
			os.Exit(1)
		}
		releaseProfile, err = devcontract.LockProfile(context.Background(), home, profile.Descriptor.WorkspaceID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "fatal: cannot acquire profile guard: %v\n", err)
			os.Exit(1)
		}
		// Re-read the binding while holding the same guard used by profile
		// rebinding. Never launch an old root selected before a concurrent edit.
		selected, resolveErr := instance.ResolveEnvironment(version.Version, version.GitCommit)
		if resolveErr != nil || selected.Descriptor.WorkspaceID != profile.Descriptor.WorkspaceID {
			_ = releaseProfile()
			fmt.Fprintln(os.Stderr, "fatal: workspace profile changed during startup; resolve it again before launch")
			os.Exit(1)
		}
		profile = selected
		options.Name = profile.Descriptor.DisplayName
		if err := hostruntime.ConfigureNativeProfile(&options, profile); err != nil {
			_ = releaseProfile()
			fmt.Fprintf(os.Stderr, "fatal: native profile storage unavailable: %v\n", err)
			os.Exit(1)
		}
		if err := devcontract.EnsureDefaultProfileOwnership(home, profile.Descriptor.WorkspaceID); err != nil {
			_ = releaseProfile()
			fmt.Fprintln(os.Stderr, "fatal: development profile namespace is not owned by this workspace")
			os.Exit(1)
		}
	}
	childEnvironment, err := profile.ChildEnvironment(nil, "")
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: invalid child environment: %v\n", err)
		os.Exit(1)
	}
	for _, entry := range childEnvironment {
		key, value, _ := strings.Cut(entry, "=")
		if err := os.Setenv(key, value); err != nil {
			fmt.Fprintf(os.Stderr, "fatal: cannot publish runtime environment: %v\n", err)
			os.Exit(1)
		}
	}
	stateDir, err := appstate.New(appstate.WithRoot(profile.Descriptor.StateRoot))
	if releaseProfile != nil {
		// The root flock is now held (or New failed without a live service).
		// Purge may acquire the parent guard only after this handoff and must
		// then contend on the still-held root flock before deleting anything.
		if releaseErr := releaseProfile(); releaseErr != nil && err == nil {
			_ = stateDir.Close()
			err = fmt.Errorf("release profile startup guard: %w", releaseErr)
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: failed to initialize state directory: %v\n", err)
		os.Exit(1)
	}
	defer stateDir.Close()

	// Wails decides the production-channel singleton before writable settings
	// open, even for two explicit roots in one channel. The canonical root
	// flock above remains authoritative for every profile; duplicate-root
	// launches fail early and do not promise focus/activation.
	app := application.New(options)
	if err := hostruntime.PrepareProfileRuntime(profile); err != nil {
		fmt.Fprintf(os.Stderr, "fatal: cannot prepare runtime directories: %v\n", err)
		os.Exit(1)
	}

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

	coreDefinitions := coresettings.Definitions(version.IsDevelopment())
	coreSettings, err := settingsservice.Initialize(settingsservice.Options{
		Store:      settingsStore,
		Categories: coreDefinitions,
		Migrations: map[string]settingsservice.Migration{
			coresettings.Appearance.ID: coresettings.MigrateAppearanceValues,
			coresettings.Terminal.ID:   coresettings.MigrateTerminalValues,
		},
		Logger: nil,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: cannot initialize core settings: %v\n", err)
		os.Exit(1)
	}
	for _, diagnostic := range coreSettings.Diagnostics() {
		fmt.Fprintf(os.Stderr, "settings: %s (%s.%s)\n", diagnostic.Message, diagnostic.CategoryID, diagnostic.SettingID)
	}
	settingsProvider := coreSettings.Provider()
	telemetryCfg := telemetry.DefaultConfig(version.IsDevelopment()).WithSettings(coreSettings.CategoryValues("telemetry"))

	// Bootstrap telemetry (tracing, metrics, log shipping, profiling).
	telemetrySvc := telemetry.New(
		telemetryCfg,
		version.Version,
		version.GitCommit,
		version.BuildDate,
		version.IsDevelopment(),
		logDir,
	)
	if initErr := telemetrySvc.Init(context.Background()); initErr != nil {
		fmt.Fprintf(os.Stderr, "telemetry init failed, continuing without telemetry: %v\n", initErr)
	}
	zapLogger := telemetrySvc.ZapLogger()
	if zapLogger == nil {
		zapLogger, _ = zap.NewProduction()
	}
	log := logging.New(logging.Config{
		Name:    "omniview",
		Backend: telemetry.NewZapBackend(zapLogger),
		Level:   logging.NewLevelController(logging.LevelDebug),
		Fields:  nil,
		Now:     nil,
	})

	if settingsStore == nil {
		log.Warnw(
			context.Background(),
			"settings persistence disabled; all settings will use defaults",
		)
	}

	diagnosticsClient := diagnostics.NewDiagnosticsClient(version.IsDevelopment(), logDir)

	profilingConfig, profilingSource, err := profiling.ResolveConfig(
		settingsProvider, coreSettings.RejectedSettingIDs(), os.Getenv("OMNIVIEW_PPROF_PORT"),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: invalid profiling environment: %v\n", err)
		os.Exit(1)
	}
	hostProfiling := sdkprofiling.New(profilingConfig, profilingSource)
	if startErr := hostProfiling.Start(); startErr != nil {
		log.Warnw(context.Background(), "host profiling unavailable", "error", startErr)
	}
	if status := hostProfiling.GetStatus(); status.Running {
		log.Infow(context.Background(), "host pprof listening", "url", status.URL, "source", status.Source)
	}
	defer hostProfiling.Close()

	// Create our plugin system managers
	uiManager := ui.NewComponentManager(log)

	managers := map[string]types.PluginManager{
		"ui": uiManager,
	}

	utilsClient := utils.NewClient()

	// Setup the plugin systems
	mcpAuthority := mcprelay.NewAuthority()
	resourceBoundary := invocation.NewBoundary(mcpAuthority)
	resourceUIRealm := invocation.NewScope(invocation.TrustedUI)
	resourceController := resource.NewController(log, settingsProvider, stateDir.PluginStore, resourceBoundary)
	graphService := resource.NewGraphService(resourceController.Graph(), resourceUIRealm, resourceBoundary, resourceController.ValidateReference)

	settingsController := settings.NewController(log, settingsStore)
	coreSettings.AttachPlugins(settingsController)

	execController, networkerController, logsController, metricController := newUICapabilityControllers(
		log, settingsProvider, resourceController, resourceUIRealm,
	)
	resourceController.SetConnectionChangeHook(metricController.BeginConnectionChange)
	toolsController := tools.NewController(log, resourceBoundary)

	dataController := data.NewController(log, stateDir.PluginData)

	// Initialize per-plugin log manager for capturing plugin process stderr.
	// Created here so it can be bound to Wails for UI access.
	pluginLogManager, pluginLogErr := pluginlog.NewManager(
		logDir,
		pluginlog.DefaultRotation(),
	)
	if pluginLogErr != nil {
		log.Warnw(
			context.Background(),
			"failed to initialize plugin log manager",
			"error",
			pluginLogErr,
		)
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
		toolsController,
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
	if profile.Descriptor.Kind == "development" {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintf(os.Stderr, "fatal: cannot locate workspace session registry: %v\n", err)
			os.Exit(1)
		}
		// The launcher/build integration supplies the independently verified
		// fixed revision. Empty means backend builds remain fail-closed.
		if err := devServerManager.ConfigureWorkspace(profile, filepath.Join(home, ".omniview-dev", "sessions"), os.Getenv("OMNIVIEW_EXPECTED_SDK_REVISION")); err != nil {
			fmt.Fprintf(os.Stderr, "fatal: cannot configure managed workspace: %v\n", err)
			os.Exit(1)
		}
		bridgeEndpoint, bridgeTokenFile := os.Getenv("OMNIVIEW_PROCESS_BRIDGE_ENDPOINT"), os.Getenv("OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE")
		if (bridgeEndpoint == "") != (bridgeTokenFile == "") {
			fmt.Fprintln(os.Stderr, "fatal: incomplete managed process supervisor capability")
			os.Exit(1)
		}
		if bridgeEndpoint != "" {
			source, err := profile.Workspace.RepositoryPath("omniview")
			if err != nil {
				fmt.Fprintln(os.Stderr, "fatal: cannot resolve managed host source")
				os.Exit(1)
			}
			host, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: profile.Descriptor.WorkspaceID, Generation: profile.Descriptor.Generation, Role: "host", Source: source})
			if err != nil {
				fmt.Fprintln(os.Stderr, "fatal: cannot capture managed host identity")
				os.Exit(1)
			}
			profile.Descriptor.Process = host
			if err := devServerManager.ConfigureProcessSupervisor(devsession.ProcessBridgeConfig{Endpoint: bridgeEndpoint, TokenFile: bridgeTokenFile, WorkspaceFile: profile.Workspace.ManifestPath, WorkspaceID: profile.Descriptor.WorkspaceID, Generation: profile.Descriptor.Generation, Host: host}); err != nil {
				fmt.Fprintf(os.Stderr, "fatal: cannot configure managed process supervisor: %v\n", err)
				os.Exit(1)
			}
		}
		if raw := os.Getenv("OMNIVIEW_PLUGIN_PNPM_COMMANDS"); raw != "" {
			var commands map[string]devserver.PNPMCommand
			decoder := json.NewDecoder(strings.NewReader(raw))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&commands); err != nil {
				fmt.Fprintln(os.Stderr, "fatal: invalid workspace package-manager command map")
				os.Exit(1)
			}
			if decoder.Decode(new(any)) != io.EOF {
				fmt.Fprintln(os.Stderr, "fatal: workspace package-manager command map must contain one JSON value")
				os.Exit(1)
			}
			if err := devServerManager.ConfigurePNPMCommands(commands); err != nil {
				fmt.Fprintln(os.Stderr, "fatal: cannot configure source-bound workspace package managers")
				os.Exit(1)
			}
		}
		if os.Getenv("OMNIVIEW_WORKSPACE_GRAPH_WATCH") == "1" {
			if err := devServerManager.ConfigureDependencyWatching(false); err != nil {
				fmt.Fprintf(os.Stderr, "fatal: cannot configure workspace watch ownership: %v\n", err)
				os.Exit(1)
			}
		}
	}

	// Wire the dev server checker into the plugin manager so the old watcher
	// skips plugins managed by DevServerManager.
	pluginManager.SetDevServerChecker(devServerManager)
	pluginManager.SetDevServerManager(devServerManager)

	if pluginLogManager != nil {
		pluginManager.SetPluginLogManager(pluginLogManager)
	}

	// Create the AppService
	appService := NewAppService(profile.Descriptor)

	// Create the bootstrap service that wraps startup/shutdown logic
	bootstrapSvc := &bootstrap.Service{
		Log:                  log,
		Settings:             coreSettings,
		TelemetrySvc:         telemetrySvc,
		PluginManager:        pluginManager,
		PluginRegistryClient: pluginRegistryClient,
	}

	// Set up plugin asset handler middleware
	pluginAssetHandler := NewPluginAssetHandler(log, stateDir.RootDir())
	pluginAssets = pluginAssetHandler.Middleware(defaultAssets)

	// Wrap the plugin manager interface in a concrete struct for v3 service
	// registration (NewService requires a concrete pointer type).
	pluginManagerSvc := &plugin.ServiceWrapper{Mgr: pluginManager}

	// A nil *Store must stay a nil interface: the relay then runs in memory.
	var mcpRelayStore mcprelay.ConfigStore
	if settingsStore != nil {
		mcpRelayStore = settingsStore
	}
	var windowService *window.Service
	mcpRelay := mcprelay.New(mcprelay.Options{
		Log:         log,
		Store:       mcpRelayStore,
		Tools:       toolsController,
		Connections: resourceController,
		Version:     version.Version,
		Authority:   mcpAuthority,
		Boundary:    resourceBoundary,
		Logs:        logsController,
		ShowConfirmation: func() error {
			if windowService == nil {
				return errors.New("Confirmation window is unavailable.")
			}
			return windowService.Focus(window.MainWindowName)
		},
	})

	// Register controllers before bootstrap: bootstrap loads plugins and their
	// controllers need initialized contexts. Registration remains before Run.
	// Service registration order matters: Wails calls ServiceStartup in order.
	// Controllers must be initialized (receive ctx + app) BEFORE the bootstrap
	// service, because bootstrap calls pluginManager.Initialize() which triggers
	// OnPluginStart on all controllers — they need ctx for gRPC streams.
	services := []application.Service{
		// 1. Controllers — need ctx before plugin loading
		application.NewService(&resource.ServiceWrapper{Ctrl: resourceController, Realm: resourceUIRealm}),
		application.NewService(graphService),
		application.NewService(&exec.ServiceWrapper{Ctrl: execController}),
		application.NewService(&networker.ServiceWrapper{Ctrl: networkerController}),
		application.NewService(&pluginlogs.ServiceWrapper{Ctrl: logsController}),
		application.NewService(&pluginmetric.ServiceWrapper{Ctrl: metricController}),
		application.NewService(&data.ServiceWrapper{Ctrl: dataController}),
		application.NewService(ui.NewServiceWrapper(uiManager)),
		application.NewService(utilsClient),
		application.NewService(&devserver.ServiceWrapper{Mgr: devServerManager}),
		// 2. Bootstrap — attaches live settings effects and loads plugins.
		application.NewService(bootstrapSvc),
		// 3. Frontend-facing services (no startup order dependency)
		application.NewService(appService),
		application.NewService(diagnosticsClient),
		application.NewService(telemetry.NewTelemetryBinding(telemetrySvc)),
		application.NewService(&profiling.ServiceWrapper{Service: hostProfiling}),
		application.NewService(&settingsservice.Binding{Service: coreSettings}),
		application.NewService(pluginManagerSvc),
		application.NewService(&mcprelay.ServiceWrapper{Relay: mcpRelay}),
	}

	if pluginLogManager != nil {
		services = append(
			services,
			application.NewService(&pluginlog.ServiceWrapper{Mgr: pluginLogManager}),
		)
	}

	for _, service := range services {
		app.RegisterService(service)
	}
	runtimeReady, err := controlhost.Register(
		app, profile,
		appService.GetInstanceInfo, appService.updateInstanceInfo,
		pluginManager, devServerManager, coreSettings,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "fatal: cannot register development control: %v\n", err)
		os.Exit(1)
	}

	windowTitle := appName
	if profile.Descriptor.Kind == "development" {
		windowTitle = appName + " — DEV · " + profile.Descriptor.DisplayName
	}

	// Every window shares the main window's title and appearance; the window
	// service overrides name, URL, size and position for secondary windows.
	windowTemplate := application.WebviewWindowOptions{
		Title: windowTitle,
		BackgroundColour: application.NewRGBA(
			backgroundRed,
			backgroundGreen,
			backgroundBlue,
			backgroundAlpha,
		),
		UseApplicationMenu: true,
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHidden,
			Backdrop: application.MacBackdropTranslucent,
		},
	}

	// Create the main window
	mainWindowOptions := windowTemplate
	mainWindowOptions.Name = window.MainWindowName
	mainWindowOptions.Width = DefaultWebviewWidth
	mainWindowOptions.Height = DefaultWebviewHeight
	mainWindowOptions.MinWidth = MinWebviewWidth
	mainWindowOptions.MinHeight = MinWebviewHeight
	mainWindow := app.Window.NewWithOptions(mainWindowOptions)
	if runtimeReady != nil {
		mainWindow.OnWindowEvent(events.Common.WindowRuntimeReady, func(_ *application.WindowEvent) {
			runtimeReady()
		})
	}

	// The window service keeps main hide-on-close, restores the saved
	// secondary windows and coordinates cross-window tab drags.
	windowService = window.NewService(app, mainWindow, window.ServiceOptions{
		WindowTemplate: windowTemplate,
		SessionPath:    stateDir.RootDir().ResolvePath(window.SessionFileName),
		Log:            log.Named("window"),
	})
	app.RegisterService(application.NewService(windowService))

	// Install menus only after their backend window service is ready.
	menus.SetupAppMenu(app, mainWindow, func() {
		if _, err := windowService.OpenSettings(""); err != nil {
			log.Errorw(context.Background(), "failed to open settings", "error", err)
		}
	})
	menus.SetupKeyBindings(app)
	menus.SetupContextMenus(app)

	// Run the application
	if runErr := app.Run(); runErr != nil {
		log.Fatalw(context.Background(), "wails app exited with error", "error", runErr)
	}
}
