package main

import (
	"context"
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"github.com/infraview/infraview/backend/clients"
	"github.com/infraview/infraview/backend/services"
	appsv1 "github.com/infraview/infraview/backend/services/resources/apps_v1"
	batchv1 "github.com/infraview/infraview/backend/services/resources/batch_v1"
	networkingv1 "github.com/infraview/infraview/backend/services/resources/networking_v1"
	rbacv1 "github.com/infraview/infraview/backend/services/resources/rbac_v1"
	storagev1 "github.com/infraview/infraview/backend/services/resources/storage_v1"
	"github.com/infraview/infraview/backend/services/resources/v1"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

func main() {
	nillogger := logger.NewFileLogger("/dev/null")
	log := clients.CreateLogger(true)

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
	persistentVolumeClaimService := resources.NewPersistentVolumeClaimService(log, publisher, resourceChan)
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
	app := NewApp(clusterManager)

	startup := func(ctx context.Context) {
		// Perform your setup here
		app.startup(ctx)

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

		// finally, sync the kubeconfigs
		clusterManager.SyncKubeconfig(DEFAULT_KUBECONFIG)
	}

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "KubeDE",
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
			Assets: assets,
		},
		Menu: nil,
		// start logger that sends to dev null
		Logger:           nillogger,
		LogLevel:         logger.ERROR,
		OnStartup:        startup,
		OnDomReady:       app.domReady,
		OnBeforeClose:    app.beforeClose,
		OnShutdown:       app.shutdown,
		WindowStartState: options.Normal,
		// CSSDragProperty:  "wails-draggable",
		// CSSDragValue:     "1",
		Bind: []interface{}{
			app,

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
				Title:   "KubeDE",
				Message: "",
				Icon:    icon,
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
