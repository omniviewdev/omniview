package main

import (
	"context"
	"fmt"
	"runtime"

	"github.com/infraview/infraview/backend/services"
	"github.com/infraview/infraview/pkg/clusters"
)

const DEFAULT_KUBECONFIG = "/Users/joshuapare/.kube/config"

// App struct.
type App struct {
	ctx            context.Context
	clusterManager *services.ClusterManager
}

// NewApp creates a new App application struct.
func NewApp(cm *services.ClusterManager) *App {
	return &App{
		clusterManager: cm,
	}
}

// GetOperatingSystem returns the operating system type this application is running on.
func (a *App) GetOperatingSystem() string {
	switch runtime.GOOS {
	case "darwin":
		return "macos"
	case "windows":
		return "windows"
	default:
		return "linux"
	}
}

// startup is called at application startup.
func (a *App) startup(ctx context.Context) {
	// Perform your setup here
	a.ctx = ctx
}

// domReady is called after front-end resources have been loaded.
func (a App) domReady(ctx context.Context) {
	// Add your action here
}

// beforeClose is called when the application is about to quit,
// either by clicking the window close button or calling runtime.Quit.
// Returning true will cause the application to continue, false will continue shutdown as normal.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	return false
}

// shutdown is called at application termination.
func (a *App) shutdown(ctx context.Context) {
	// Perform your teardown here
}

// Greet returns a greeting for the given name.
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// GetClusters returns a list of clusters.
func (a *App) GetClusters() clusters.ClusterInfos {
	info, err := clusters.GetClusters(DEFAULT_KUBECONFIG)
	if err != nil {
		fmt.Println(err)
	}
	return info
}
