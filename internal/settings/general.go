package categories

import "github.com/omniviewdev/plugin-sdk/settings"

// Update modes for general.update_mode.
const (
	UpdateModeAutomatic = "automatic"
	UpdateModeCheckOnly = "check_only"
	UpdateModeManual    = "manual"
)

//nolint:gochecknoglobals // we're providing this as a package level variable
var General = settings.Category{
	ID:          "general",
	Label:       "General",
	Description: "General settings for the application",
	Icon:        "LuSettings2",
	Settings: map[string]settings.Setting{
		"update_mode": {
			ID:      "update_mode",
			Type:    settings.Text,
			Label:   "Update mode",
			Default: UpdateModeAutomatic,
			Description: "Automatic downloads and prepares updates in the background. " +
				"Check only tells you when an update is available. Manual checks only when you ask.",
			Options: []settings.SettingOption{
				{Value: UpdateModeAutomatic, Label: "Automatic", Description: "Check, download, and prepare updates in the background"},
				{Value: UpdateModeCheckOnly, Label: "Check only", Description: "Check in the background and tell you when an update is available"},
				{Value: UpdateModeManual, Label: "Manual", Description: "Check only when you ask"},
			},
			Validator: validateUpdateMode,
		},
		// Language setting
		"language": {
			ID:          "language",
			Type:        settings.Text,
			Label:       "Language",
			Default:     "en",
			Description: "The language to use when displaying text",
			Options: []settings.SettingOption{
				{Value: "en", Label: "English", Description: ""},
				{Value: "es", Label: "Spanish", Description: ""},
			},
		},
	},
}
