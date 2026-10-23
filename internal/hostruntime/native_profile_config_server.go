//go:build server

package hostruntime

import (
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ConfigureNativeProfile leaves native WebView storage unchanged in server mode.
func ConfigureNativeProfile(_ *application.Options, _ instance.Profile) error { return nil }

// PrepareProfileRuntime prepares transient paths without native WebView storage.
func PrepareProfileRuntime(profile instance.Profile) error {
	// Production already uses an optional empty native root. Apply the same
	// established contract to this copy, preserving the resolved profile.
	profile.WebviewRoot = ""
	return profile.PrepareRuntime()
}
