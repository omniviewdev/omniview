//go:build !server

package main

import (
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Native wails:// requests are not requests to an HTTP listener.
func developmentServerMiddleware(_ instance.Profile) application.Middleware {
	return nil
}
