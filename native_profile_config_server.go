//go:build server

package main

import (
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Browser/server mode neither selects nor resets a native WebView namespace.
func configureNativeProfile(_ *application.Options, _ instance.Profile) error { return nil }

func prepareProfileRuntime(profile instance.Profile) error {
	// Production already uses an optional empty native root. Apply the same
	// established contract to this copy, preserving the resolved profile.
	profile.WebviewRoot = ""
	return profile.PrepareRuntime()
}
