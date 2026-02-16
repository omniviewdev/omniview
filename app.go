package main

import (
	"context"
	"os"
	"runtime"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Shutdownable is an interface that can be implemented by any struct that needs to
// perform an action at application termination.
type Shutdownable interface {
	// Shutdown is called at application termination.
	Shutdown(ctx context.Context)
}

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

// FileFilter defines a filter for dialog boxes
type FileFilter struct {
	DisplayName string `json:"displayName"` // Filter information EG: "Image Files (*.jpg, *.png)"
	Pattern     string `json:"pattern"`     // semicolon separated list of extensions, EG: "*.jpg;*.png"
}

type FileDialogOptions struct {
	DefaultDirectory           string       `json:"defaultDirectory"`
	DefaultFilename            string       `json:"defaultFilename"`
	Title                      string       `json:"title"`
	Filters                    []FileFilter `json:"filters"`
	ShowHiddenFiles            bool         `json:"showHiddenFiles"`
	CanCreateDirectories       bool         `json:"canCreateDirectories"`
	ResolvesAliases            bool         `json:"resolvesAliases"`
	TreatPackagesAsDirectories bool         `json:"treatPackagesAsDirectories"`
}

func (a *App) OpenFileSelectionDialog(opts FileDialogOptions) ([]string, error) {
	wailsopts := wailsruntime.OpenDialogOptions{
		DefaultDirectory:           opts.DefaultDirectory,
		DefaultFilename:            opts.DefaultFilename,
		Title:                      opts.Title,
		ShowHiddenFiles:            opts.ShowHiddenFiles,
		CanCreateDirectories:       opts.CanCreateDirectories,
		ResolvesAliases:            opts.ResolvesAliases,
		TreatPackagesAsDirectories: opts.TreatPackagesAsDirectories,
	}
	filters := make([]wailsruntime.FileFilter, len(opts.Filters))
	for i, filter := range opts.Filters {
		filters[i] = wailsruntime.FileFilter{
			DisplayName: filter.DisplayName,
			Pattern:     filter.Pattern,
		}
	}
	wailsopts.Filters = filters
	return wailsruntime.OpenMultipleFilesDialog(a.ctx, wailsopts)
}

// SaveFileDialog opens a native save file dialog and returns the selected path.
func (a *App) SaveFileDialog(opts FileDialogOptions) (string, error) {
	wailsopts := wailsruntime.SaveDialogOptions{
		DefaultDirectory:           opts.DefaultDirectory,
		DefaultFilename:            opts.DefaultFilename,
		Title:                      opts.Title,
		ShowHiddenFiles:            opts.ShowHiddenFiles,
		CanCreateDirectories:       opts.CanCreateDirectories,
		TreatPackagesAsDirectories: opts.TreatPackagesAsDirectories,
	}
	filters := make([]wailsruntime.FileFilter, len(opts.Filters))
	for i, filter := range opts.Filters {
		filters[i] = wailsruntime.FileFilter{
			DisplayName: filter.DisplayName,
			Pattern:     filter.Pattern,
		}
	}
	wailsopts.Filters = filters
	return wailsruntime.SaveFileDialog(a.ctx, wailsopts)
}

// WriteFileContent writes string content to the given file path.
func (a *App) WriteFileContent(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
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
