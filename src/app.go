package main

import (
	"context"
	"runtime"
)

// App struct.
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct.
func NewApp() *App {
	return &App{}
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
func (a App) domReady(_ context.Context) {
	// Add your action here
}

// beforeClose is called when the application is about to quit,
// either by clicking the window close button or calling runtime.Quit.
// Returning true will cause the application to continue, false will continue shutdown as normal.
func (a *App) beforeClose(_ context.Context) (prevent bool) {
	return false
}

// shutdown is called at application termination.
func (a *App) shutdown(_ context.Context) {
	// Perform your teardown here
}
