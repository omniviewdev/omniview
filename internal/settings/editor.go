package categories

import "github.com/omniviewdev/settings"

//nolint:gochecknoglobals // we're providing this as a package level variable
var Editor = settings.Category{
	ID:          "editor",
	Label:       "Editor",
	Description: "Change settings within the code editor",
	Icon:        "LuCode",
	Settings: map[string]settings.Setting{
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
		"fontSize": {
			ID:          "fontSize",
			Type:        settings.Integer,
			Label:       "Font Size",
			Default:     11,
			Description: "The size of the font in the editor.",
		},
		"fontWeight": {
			ID:          "fontWeight",
			Type:        settings.Text,
			Label:       "Font Weight",
			Default:     11,
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
				{Value: "on", Label: "On"},
				{Value: "off", Label: "Off"},
				{Value: "relative", Label: "Relative"},
				{Value: "interval", Label: "Interval"},
			},
			Label:       "Line Numbers",
			Default:     "on",
			Description: "Control the rendering of line numbers. Defaults to 'on'.",
		},
		"lineNumbersMinChars": {
			ID:          "lineNumbersMinChars",
			Type:        settings.Integer,
			Label:       "Line Number Width",
			Default:     5,
			Description: "Control the width of line numbers, by reserving horizontal space for rendering at least an amount of digits. Defaults to 5.",
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
				{Value: "mouseover", Label: "Mouseover"},
				{Value: "always", Label: "Always"},
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
				{Value: "right", Label: "Right"},
				{Value: "left", Label: "Left"},
			},
			Description: "Control the side of the minimap in editor. Defaults to 'right'",
		},
		"minimapSize": {
			ID:      "minimapSize",
			Type:    settings.Text,
			Label:   "Minimap Size",
			Default: "actual",
			Options: []settings.SettingOption{
				{Value: "actual", Label: "Actual"},
				{Value: "proportional", Label: "Proportional"},
				{Value: "fill", Label: "Fill"},
				{Value: "fit", Label: "Fit"},
			},
			Description: "Control the minimap rendering mode. Defaults to 'actual'.",
		},
	},
}
