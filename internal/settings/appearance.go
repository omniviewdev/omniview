package categories

import "github.com/omniviewdev/plugin-sdk/settings"

// Setting IDs and values shared by several categories.
const (
	settingTheme    = "theme"
	settingFontSize = "fontSize"
	themeDefault    = "default"
)

//nolint:gochecknoglobals // we're providing this as a package level variable
var Appearance = settings.Category{
	ID:          "appearance",
	Label:       "Appearance",
	Description: "Customize the look and feel of the application",
	Icon:        "LuPaintbrush",
	Settings: map[string]settings.Setting{
		settingTheme: {
			ID:          settingTheme,
			Type:        settings.Text,
			Label:       "Theme",
			Default:     themeDefault,
			Description: "The color theme for the application UI",
			Options: []settings.SettingOption{
				{Value: themeDefault, Label: "Default", Description: ""},
				{Value: "solarized", Label: "Solarized", Description: ""},
			},
		},
	},
}
