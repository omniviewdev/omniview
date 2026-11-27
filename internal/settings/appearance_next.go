//go:build ui_next

package categories

import "github.com/omniviewdev/plugin-sdk/settings"

const (
	windowMaterial = "windowMaterial"
	glassStyle     = "glassStyle"
	fullOpacity    = 100
)

// Only the next shell can render and edit window materials. The current shell
// enumerates every setting the host supplies, so omit these definitions there.
func withWindowMaterials(fields map[string]settings.Setting) map[string]settings.Setting {
	fields[windowMaterial] = settings.Setting{
		ID: windowMaterial, Type: settings.Text, Label: "Material", Default: "opaque",
		Options: []settings.SettingOption{
			{Value: "opaque", Label: "Opaque", Description: ""},
			{Value: "translucent", Label: "Translucent", Description: ""},
			{Value: "glass", Label: "Liquid Glass", Description: ""},
		},
		Validator: validateAppearanceChoice("opaque", "translucent", "glass"),
	}
	fields[glassStyle] = settings.Setting{
		ID: glassStyle, Type: settings.Text, Label: "Glass style", Default: "regular",
		Options: []settings.SettingOption{
			{Value: "regular", Label: "Regular", Description: ""},
			{Value: "clear", Label: "Clear", Description: ""},
		},
		Validator: validateAppearanceChoice("regular", "clear"),
	}
	for _, surface := range [...]struct {
		id, label string
		opacity   int
	}{
		{"chromeOpacity", "Window chrome", 62},
		{"contentOpacity", "Content", 94},
		{"menuOpacity", "In-app menus", 90},
		{"sheetOpacity", "Sheets and dialogs", 96},
	} {
		fields[surface.id] = settings.Setting{
			ID: surface.id, Type: settings.Integer, Label: surface.label, Default: surface.opacity,
			Validator: validateSurfaceOpacity,
		}
	}
	return fields
}

func validateSurfaceOpacity(value any) settings.ValidationResult {
	// The SDK normalizes JSON numbers and rejects fractional or non-finite integers first.
	n, ok := value.(int)
	if !ok || n < 0 || n > fullOpacity {
		return settings.ValidationResult{Valid: false, Code: "opacity_range", Message: "Choose a percentage from 0 to 100."}
	}
	return settings.ValidationResult{Valid: true, Code: "", Message: ""}
}
