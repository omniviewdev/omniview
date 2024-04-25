package categories

import "github.com/omniviewdev/settings"

//nolint:gochecknoglobals // we're providing this as a package level variable
var General = settings.Category{
	ID:          "general",
	Label:       "General",
	Description: "General settings for the application",
	Icon:        "LuSettings2",
	Settings: map[string]settings.Setting{
		// Language setting
		"language": {
			ID:          "language",
			Type:        settings.Text,
			Label:       "Language",
			Default:     "en",
			Description: "The language to use when displaying text",
			Options: []settings.SettingOption{
				{Value: "en", Label: "English"},
				{Value: "es", Label: "Spanish"},
			},
		},
	},
}
