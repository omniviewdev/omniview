//go:build ui_next

package windowmaterial

import (
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/settings"
)

func TestNativePreferenceOnlyTracksApplicableInputs(t *testing.T) {
	request := settings.AppearanceRequest{WindowMaterial: "translucent", GlassStyle: "regular", Theme: "void"}
	before := nativePreference(request)
	request.GlassStyle, request.Theme = "clear", "solarized-light"
	if nativePreference(request) != before {
		t.Fatal("glass style outside glass mode or an ordinary theme change would cause a native update")
	}
	request.WindowMaterial = "glass"
	if got := nativePreference(request); got != (preference{mode: "glass", clear: true}) {
		t.Fatalf("glass preference = %+v", got)
	}
	for _, theme := range []string{"high-contrast-dark", "high-contrast-light"} {
		request.Theme = theme
		p := nativePreference(request)
		if got := p.inPage(); p.mode != "opaque" || !got.ForcedOpaque || got.Effective != "opaque" || got.Reason != "accessibility" {
			t.Fatalf("%s: preference %+v, presentation %+v", theme, p, got)
		}
	}
}

func TestUnsupportedDesktopNeverClaimsGlassOrTransparency(t *testing.T) {
	for _, mode := range []string{"opaque", "translucent", "glass"} {
		request := settings.AppearanceRequest{WindowMaterial: mode, GlassStyle: "clear"}
		got := nativePreference(request).inPage()
		want := settings.AppearanceMaterial{Effective: "opaque", Translucent: true}
		if mode != "opaque" {
			want.Effective, want.Reason = "in-page", "unsupported"
		}
		if got != want {
			t.Fatalf("%s: got %+v, want %+v", mode, got, want)
		}
	}
}
