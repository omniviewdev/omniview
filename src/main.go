package main

import (
	"context"
	"embed"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	pkgsettings "github.com/omniviewdev/settings"
	"github.com/wailsapp/mimetype"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/clients"
	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	"github.com/omniviewdev/omniview/backend/services"
	appsv1 "github.com/omniviewdev/omniview/backend/services/resources/apps_v1"
	batchv1 "github.com/omniviewdev/omniview/backend/services/resources/batch_v1"
	networkingv1 "github.com/omniviewdev/omniview/backend/services/resources/networking_v1"
	rbacv1 "github.com/omniviewdev/omniview/backend/services/resources/rbac_v1"
	storagev1 "github.com/omniviewdev/omniview/backend/services/resources/storage_v1"
	"github.com/omniviewdev/omniview/backend/services/resources/v1"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/favicon.icns
var icon []byte

type FileLoader struct {
	http.Handler
	logger *zap.SugaredLogger
}

func NewFileLoader(logger *zap.SugaredLogger) *FileLoader {
	return &FileLoader{
		logger: logger,
	}
}

func isAllowed(path string) bool {
	// only allow the following patterns:
	// - /plugins/<pluginname>/(assets|dist)/*.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|html)
	// - /assets/*.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|html)

	tester := regexp.MustCompile(
		`^/plugins/[^/]+/(assets|dist)/.*\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|html)$`,
	)
	return tester.MatchString(path)
}

func forceMimeType(path string) string {
	switch {
	case strings.HasSuffix(path, ".js"):
		return "application/javascript"
	case strings.HasSuffix(path, ".css"):
		return "text/css"
	case strings.HasSuffix(path, ".png"):
		return "image/png"
	case strings.HasSuffix(path, ".jpg"), strings.HasSuffix(path, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(path, ".gif"):
		return "image/gif"
	case strings.HasSuffix(path, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(path, ".ico"):
		return "image/x-icon"
	case strings.HasSuffix(path, ".woff"):
		return "font/woff"
	case strings.HasSuffix(path, ".woff2"):
		return "font/woff2"
	case strings.HasSuffix(path, ".ttf"):
		return "font/ttf"
	case strings.HasSuffix(path, ".html"):
		return "text/html"
	default:
		return "text/plain"
	}
}

func (h *FileLoader) ServeHTTP(res http.ResponseWriter, req *http.Request) {
	var err error
	respondUnauthorized := func() {
		res.WriteHeader(http.StatusUnauthorized)
		res.Write([]byte("Unauthorized"))
	}

	requestedFilename := req.URL.Path

	// must start with /_/
	if !strings.HasPrefix(requestedFilename, "/_/") {
		respondUnauthorized()
		return
	}
	requestedFilename = strings.TrimPrefix(requestedFilename, "/_")

	h.logger.Infow("requested file", "path", requestedFilename)

	if !isAllowed(requestedFilename) {
		// unauthorized request
		// log it
		h.logger.Warnw("unauthorized request", "path", requestedFilename)
		res.WriteHeader(http.StatusUnauthorized)
		res.Write([]byte("Unauthorized"))
		return
	}

	toFetch := filepath.Join(os.Getenv("HOME"), ".omniview", requestedFilename)
	fileData, err := os.ReadFile(toFetch)
	if err != nil {
		res.WriteHeader(http.StatusBadRequest)
		if _, err = fmt.Fprintf(res, "Could not load file %s", toFetch); err != nil {
			h.logger.Errorw("error serving file", "error", err)
		}
		return
	}

	// set content type
	contentType := mimetype.Detect(fileData).String()
	h.logger.Infow("content type", "type", contentType)
	if strings.HasPrefix(contentType, "text/plain") {
		// don't like this but it's the only way to force the right mime type.
		contentType = forceMimeType(requestedFilename)
	}

	res.Header().Set("Content-Type", contentType)

	// if remoteEntry.js, do NOT cache
	if strings.HasSuffix(requestedFilename, "remoteEntry.js") {
		res.Header().Set("Cache-Control", "no-store")
	}

	if _, err = res.Write(fileData); err != nil {
		h.logger.Errorw("error serving file", "error", err)
	}
}

func main() {
	// nillogger := logger.NewFileLogger("/dev/null")
	log := clients.CreateLogger(true)

	settingsProvider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{
		Logger: log,
	})

	// Setup the plugin systems
	resourceController := resource.NewController(log)
	resourceClient := resource.NewClient(resourceController)

	settingsController := settings.NewController(log)
	settingsClient := settings.NewClient(settingsController)

	pluginManager := plugin.NewManager(
		log,
		resourceController,
		settingsController,
	)

	// LEGACY - KUBERNETES MANAGERS INLINE

	// Create our managers
	clusterManager, publisher, resourceChan := services.NewClusterManager(log)
	terminalManager := services.NewTerminalManager(log)

	// Create our resource services, which all independently subscribe to changes
	// and update their state when the context changes.
	configMapService := resources.NewConfigMapService(log, publisher, resourceChan)
	endpointService := resources.NewEndpointsService(log, publisher, resourceChan)
	// eventService := resources.NewEventsService(log, publisher)
	namespaceService := resources.NewNamespaceService(log, publisher, resourceChan)
	nodeService := resources.NewNodeService(log, publisher, resourceChan)
	persistentVolumeService := resources.NewPersistentVolumeService(log, publisher, resourceChan)
	persistentVolumeClaimService := resources.NewPersistentVolumeClaimService(
		log,
		publisher,
		resourceChan,
	)
	podService := resources.NewPodService(log, publisher, resourceChan)
	secretService := resources.NewSecretService(log, publisher, resourceChan)
	serviceService := resources.NewServiceService(log, publisher, resourceChan)
	serviceAccountService := resources.NewServiceAccountService(log, publisher, resourceChan)

	daemonSetService := appsv1.NewDaemonSetService(log, publisher, resourceChan)
	deploymentService := appsv1.NewDeploymentService(log, publisher, resourceChan)
	replicaSetService := appsv1.NewReplicaSetService(log, publisher, resourceChan)
	statefulSetService := appsv1.NewStatefulSetService(log, publisher, resourceChan)

	jobService := batchv1.NewJobService(log, publisher, resourceChan)
	cronJobService := batchv1.NewCronJobService(log, publisher, resourceChan)

	ingressService := networkingv1.NewIngressService(log, publisher, resourceChan)
	ingressClassService := networkingv1.NewIngressClassService(log, publisher, resourceChan)
	networkPolicyService := networkingv1.NewNetworkPolicyService(log, publisher, resourceChan)

	clusterRoleService := rbacv1.NewClusterRoleService(log, publisher, resourceChan)
	clusterRoleBindingService := rbacv1.NewClusterRoleBindingService(log, publisher, resourceChan)
	roleService := rbacv1.NewRoleService(log, publisher, resourceChan)
	roleBindingService := rbacv1.NewRoleBindingService(log, publisher, resourceChan)

	csiDriverService := storagev1.NewCSIDriverService(log, publisher, resourceChan)
	csiNodeService := storagev1.NewCSINodeService(log, publisher, resourceChan)
	storageClassService := storagev1.NewStorageClassService(log, publisher, resourceChan)
	volumeAttachmentService := storagev1.NewVolumeAttachmentService(log, publisher, resourceChan)

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
		); err != nil {
			log.Errorw("error while initializing settings system", "error", err)
		}

		resourceController.Run(ctx)

		// Initialize the plugin system
		if err := pluginManager.Initialize(ctx); err != nil {
			log.Errorw("error while initializing plugin system", "error", err)
		}
		pluginManager.Run(ctx)

		// Run the overarching managers
		clusterManager.Run(ctx)
		terminalManager.Run(ctx)

		// core resource services
		configMapService.Run(ctx)
		endpointService.Run(ctx)
		namespaceService.Run(ctx)
		nodeService.Run(ctx)
		persistentVolumeService.Run(ctx)
		persistentVolumeClaimService.Run(ctx)
		podService.Run(ctx)
		secretService.Run(ctx)
		serviceService.Run(ctx)
		serviceAccountService.Run(ctx)

		// apps resource services
		daemonSetService.Run(ctx)
		deploymentService.Run(ctx)
		replicaSetService.Run(ctx)
		statefulSetService.Run(ctx)

		// batch resource services
		jobService.Run(ctx)
		cronJobService.Run(ctx)

		// networking resource services
		ingressService.Run(ctx)
		ingressClassService.Run(ctx)
		networkPolicyService.Run(ctx)

		// rbac resource service
		clusterRoleService.Run(ctx)
		clusterRoleBindingService.Run(ctx)
		roleService.Run(ctx)
		roleBindingService.Run(ctx)

		// storage resource service
		csiDriverService.Run(ctx)
		csiNodeService.Run(ctx)
		storageClassService.Run(ctx)
		volumeAttachmentService.Run(ctx)
	}

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "Omniview",
		Width:     1920,
		Height:    1080,
		MinWidth:  1280,
		MinHeight: 800,
		// MaxWidth:  1280,
		// MaxHeight:         800,
		DisableResize:     false,
		Fullscreen:        false,
		Frameless:         false,
		StartHidden:       false,
		HideWindowOnClose: false,
		BackgroundColour:  &options.RGBA{R: 255, G: 255, B: 255, A: 255},
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: NewFileLoader(log),
		},
		Menu: nil,
		// start logger that sends to dev null
		LogLevel:      logger.DEBUG,
		OnStartup:     startup,
		OnDomReady:    app.domReady,
		OnBeforeClose: app.beforeClose,
		OnShutdown: func(ctx context.Context) {
			pluginManager.Shutdown()
		},
		WindowStartState: options.Normal,
		// CSSDragProperty:  "wails-draggable",
		// CSSDragValue:     "1",
		Bind: []interface{}{
			app,

			// core engines/providers
			settingsProvider,

			// plugin system
			pluginManager,
			resourceClient,
			settingsClient,

			// managers
			clusterManager,
			terminalManager,

			// core resource services
			configMapService,
			endpointService,
			namespaceService,
			nodeService,
			persistentVolumeService,
			persistentVolumeClaimService,
			podService,
			secretService,
			serviceService,
			serviceAccountService,

			// apps resource services
			daemonSetService,
			deploymentService,
			replicaSetService,
			statefulSetService,

			// batch resource services
			jobService,
			cronJobService,

			// networking resource services
			ingressService,
			ingressClassService,
			networkPolicyService,

			// rbac resource services
			clusterRoleService,
			clusterRoleBindingService,
			roleService,
			roleBindingService,

			// storage resource service
			csiDriverService,
			csiNodeService,
			storageClassService,
			volumeAttachmentService,
		},
		EnumBind: []interface{}{
			pkgsettings.AllSettingTypes,
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
				Title:   "Omniview",
				Message: "",
				Icon:    icon,
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
