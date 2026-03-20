package main

import (
	"context"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// AppService is the main application service for Wails v3.
// It is registered as a Wails service and exposes methods to the frontend.
type AppService struct{}

// NewAppService creates a new AppService.
func NewAppService() *AppService {
	return &AppService{}
}

// ServiceStartup is called during application startup.
func (a *AppService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

// ServiceShutdown is called during application shutdown.
func (a *AppService) ServiceShutdown() error {
	return nil
}

// GetOperatingSystem returns the operating system type this application is running on.
func (a *AppService) GetOperatingSystem() string {
	switch runtime.GOOS {
	case "darwin":
		return "macos"
	case "windows":
		return "windows"
	default:
		return "linux"
	}
}

// FileDialogOptions defines options for file dialogs exposed to the frontend.
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

// FileFilter defines a filter for dialog boxes.
type FileFilter struct {
	DisplayName string `json:"displayName"` // Filter information EG: "Image Files (*.jpg, *.png)"
	Pattern     string `json:"pattern"`     // semicolon separated list of extensions, EG: "*.jpg;*.png"
}

// OpenFileSelectionDialog opens a native file selection dialog using the v3 Dialog API.
func (a *AppService) OpenFileSelectionDialog(opts FileDialogOptions) ([]string, error) {
	app := application.Get()
	dialog := app.Dialog.OpenFile()

	if opts.Title != "" {
		dialog.SetTitle(opts.Title)
	}
	if opts.DefaultDirectory != "" {
		dialog.SetDirectory(opts.DefaultDirectory)
	}
	dialog.CanChooseFiles(true)
	dialog.CanCreateDirectories(opts.CanCreateDirectories)
	dialog.ShowHiddenFiles(opts.ShowHiddenFiles)
	dialog.ResolvesAliases(opts.ResolvesAliases)
	dialog.TreatsFilePackagesAsDirectories(opts.TreatPackagesAsDirectories)

	for _, f := range opts.Filters {
		dialog.AddFilter(f.DisplayName, f.Pattern)
	}

	return dialog.PromptForMultipleSelection()
}

// SaveFileDialog opens a native save file dialog using the v3 Dialog API.
func (a *AppService) SaveFileDialog(opts FileDialogOptions) (string, error) {
	app := application.Get()
	dialog := app.Dialog.SaveFile()

	if opts.Title != "" {
		dialog.SetMessage(opts.Title)
	}
	if opts.DefaultDirectory != "" {
		dialog.SetDirectory(opts.DefaultDirectory)
	}
	if opts.DefaultFilename != "" {
		dialog.SetFilename(opts.DefaultFilename)
	}
	dialog.CanCreateDirectories(opts.CanCreateDirectories)
	dialog.ShowHiddenFiles(opts.ShowHiddenFiles)
	dialog.TreatsFilePackagesAsDirectories(opts.TreatPackagesAsDirectories)

	for _, f := range opts.Filters {
		dialog.AddFilter(f.DisplayName, f.Pattern)
	}

	return dialog.PromptForSingleSelection()
}

// WriteFileContent writes string content to the given file path.
func (a *AppService) WriteFileContent(path string, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}
