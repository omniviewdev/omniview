//go:build ui_next

// Package windowmaterial applies committed material preferences to existing windows.
package windowmaterial

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/settings"
)

// Keep Wails transport and caller identity out of the native-free settings
// service. A page cannot request the projection of a different window.
func setup(app *application.App, service *settings.Service, apply func(settings.AppearanceRequest), present func(string) settings.AppearanceMaterial) {
	service.SetupAppearance(apply, func(ctx context.Context) settings.AppearanceMaterial {
		if w, ok := ctx.Value(application.WindowKey).(*application.WebviewWindow); ok && w != nil {
			return present(w.Name())
		}
		return present("")
	}, func(revision uint64) {
		if app.Context().Err() == nil {
			app.Event.Emit(settings.AppearanceChangedEvent, revision)
		}
	})
}

// Only this projection can cause native work. In particular, surface percentages
// are paint settings and ordinary theme changes do not rebuild native materials.
type preference struct {
	mode         string
	clear        bool
	highContrast bool
}

func nativePreference(request settings.AppearanceRequest) preference {
	if request.Theme == "high-contrast-dark" || request.Theme == "high-contrast-light" {
		return preference{mode: "opaque", highContrast: true}
	}
	switch request.WindowMaterial {
	case "glass":
		return preference{mode: "glass", clear: request.GlassStyle == "clear"}
	case "translucent":
		return preference{mode: "translucent"}
	default:
		return preference{mode: "opaque"}
	}
}

func (p preference) inPage() settings.AppearanceMaterial {
	result := settings.AppearanceMaterial{Effective: "opaque", Translucent: true}
	if p.highContrast {
		result.ForcedOpaque, result.Reason = true, "accessibility"
	} else if p.mode == "translucent" || p.mode == "glass" {
		result.Effective, result.Reason = "in-page", "unsupported"
	}
	return result
}
