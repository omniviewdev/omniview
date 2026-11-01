package categories

import "github.com/omniviewdev/plugin-sdk/settings"

// Editor setting defaults.
const (
	defaultEditorFontSize      = 11
	defaultEditorFontWeight    = "normal"
	defaultLineNumbersMinChars = 5
)

//nolint:gochecknoglobals // we're providing this as a package level variable
var Editor = settings.Category{
	ID:          "editor",
	Label:       "Editor",
	Description: "Change settings within the code editor",
	Icon:        "LuCode",
	Settings: map[string]settings.Setting{
		settingTheme: {
			ID:          settingTheme,
			Type:        settings.Text,
			Label:       "Theme",
			Default:     themeApplication,
			Description: "The color theme for the editor",
			Options: []settings.SettingOption{
				{Value: themeApplication, Label: "Application", Description: ""},
				{Value: "brilliance-black", Label: "Brilliance Black", Description: ""},
				{Value: "github-dark", Label: "GitHub Dark", Description: ""},
			},
		},
		"folding": {
			ID:          "folding",
			Type:        settings.Toggle,
			Label:       "Folding",
			Default:     true,
			Description: "Enable code folding. Defaults to true.",
		},
		"foldingHighlight": {
			ID:          "foldingHighlight",
			Type:        settings.Toggle,
			Label:       "Folding Highlight",
			Default:     true,
			Description: "Enable highlight for folded regions. Defaults to true.",
		},
		settingFontSize: {
			ID:          settingFontSize,
			Type:        settings.Integer,
			Label:       "Font Size",
			Default:     defaultEditorFontSize,
			Description: "The size of the font in the editor.",
		},
		"fontWeight": {
			ID:          "fontWeight",
			Type:        settings.Text,
			Label:       "Font Weight",
			Default:     defaultEditorFontWeight,
			Description: "The font weight.",
		},
		"formatOnPaste": {
			ID:          "formatOnPaste",
			Type:        settings.Toggle,
			Label:       "Format On Paste",
			Default:     false,
			Description: "Enable format on paste. Defaults to false.",
		},
		"formatOnType": {
			ID:          "formatOnType",
			Type:        settings.Toggle,
			Label:       "Format On Type",
			Default:     false,
			Description: "Enable format on type. Defaults to false.",
		},
		"lineHeight": {
			ID:          "lineHeight",
			Type:        settings.Integer,
			Label:       "Line Height",
			Default:     1,
			Description: "The line height.",
		},
		"lineNumbers": {
			ID:   "lineNumbers",
			Type: settings.Text,
			Options: []settings.SettingOption{
				{Value: "on", Label: "On", Description: ""},
				{Value: "off", Label: "Off", Description: ""},
				{Value: "relative", Label: "Relative", Description: ""},
				{Value: "interval", Label: "Interval", Description: ""},
			},
			Label:       "Line Numbers",
			Default:     "on",
			Description: "Control the rendering of line numbers. Defaults to 'on'.",
		},
		"lineNumbersMinChars": {
			ID:      "lineNumbersMinChars",
			Type:    settings.Integer,
			Label:   "Line Number Width",
			Default: defaultLineNumbersMinChars,
			Description: "Control the width of line numbers, by reserving horizontal space for rendering " +
				"at least an amount of digits. Defaults to 5.",
		},
		"minimapEnabled": {
			ID:          "minimapEnabled",
			Type:        settings.Toggle,
			Label:       "Minimap Enabled",
			Default:     true,
			Description: "Enable the rendering of the minimap. Defaults to 'true'",
		},
		"minimapScale": {
			ID:          "minimapScale",
			Type:        settings.Integer,
			Label:       "Minimap Scale",
			Default:     1,
			Description: "Relative size of the font in the minimap. Defaults to 1.",
		},
		"minimapShowSlider": {
			ID:    "minimapShowSlider",
			Type:  settings.Text,
			Label: "Minimap Slider",
			Options: []settings.SettingOption{
				{Value: "mouseover", Label: "Mouseover", Description: ""},
				{Value: "always", Label: "Always", Description: ""},
			},
			Default:     "mouseover",
			Description: "Control the rendering of the minimap slider. Defaults to 'mouseover'.",
		},
		"minimapSide": {
			ID:      "minimapSide",
			Type:    settings.Text,
			Label:   "Minimap Side",
			Default: "right",
			Options: []settings.SettingOption{
				{Value: "right", Label: "Right", Description: ""},
				{Value: "left", Label: "Left", Description: ""},
			},
			Description: "Control the side of the minimap in editor. Defaults to 'right'",
		},
		"minimapSize": {
			ID:      "minimapSize",
			Type:    settings.Text,
			Label:   "Minimap Size",
			Default: "actual",
			Options: []settings.SettingOption{
				{Value: "actual", Label: "Actual", Description: ""},
				{Value: "proportional", Label: "Proportional", Description: ""},
				{Value: "fill", Label: "Fill", Description: ""},
				{Value: "fit", Label: "Fit", Description: ""},
			},
			Description: "Control the minimap rendering mode. Defaults to 'actual'.",
		},
	},
}
