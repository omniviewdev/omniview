package categories

import "github.com/omniviewdev/plugin-sdk/settings"

//nolint:gochecknoglobals // we're providing this as a package level variable
var Appearance = settings.Category{
	ID:          "appearance",
	Label:       "Appearance",
	Description: "Customize the look and feel of the application",
	Icon:        "LuPaintbrush",
	Settings: map[string]settings.Setting{
		"theme": {
			ID:          "theme",
			Type:        settings.Text,
			Label:       "Theme",
			Default:     "default",
			Description: "The color theme for the application UI",
			Options: []settings.SettingOption{
				{Value: "default", Label: "Default"},
				{Value: "solarized", Label: "Solarized"},
			},
		},
	},
}
