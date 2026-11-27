//go:build !ui_next

// Package windowmaterial integrates the built UI's window material with Wails.
package windowmaterial

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/settings"
)

// Configure leaves the current UI's Wails options and settings lifecycle untouched.
func Configure(*application.App, *settings.Service, *application.WebviewWindowOptions) {}
