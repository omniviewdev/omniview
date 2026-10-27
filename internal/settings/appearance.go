package categories

import (
	"regexp"

	"github.com/omniviewdev/plugin-sdk/settings"
)

// Setting IDs and values shared by several categories.
const (
	settingTheme     = "theme"
	settingFontSize  = "fontSize"
	themeApplication = "application"
)

var themeIDPattern = regexp.MustCompile(`^[A-Za-z0-9._~%:/-]+$`)

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
			Default:     "void",
			Description: "The color theme for the application UI",
			Validator:   validateThemeID,
		},
	},
}

func validateThemeID(value any) settings.ValidationResult {
	id, ok := value.(string)
	if !ok {
		return settings.ValidationResult{Code: "theme_type", Message: "Choose a theme using a text ID."}
	}
	if id == "" || len(id) > 256 || !themeIDPattern.MatchString(id) {
		return settings.ValidationResult{Code: "theme_id", Message: "Use a theme ID of 1–256 characters containing only letters, numbers, or . _ ~ % : / -."}
	}
	return settings.ValidationResult{Valid: true, Code: "theme_id", Message: "Theme ID is valid."}
}

// MigrateAppearanceValues upgrades known legacy theme IDs without changing
// extension-provided or otherwise unknown IDs.
func MigrateAppearanceValues(values map[string]any) (map[string]any, bool) {
	migrated := make(map[string]any, len(values))
	for key, value := range values {
		migrated[key] = value
	}

	switch migrated[settingTheme] {
	case "default":
		migrated[settingTheme] = "void"
		return migrated, true
	case "solarized":
		migrated[settingTheme] = "solarized-dark"
		return migrated, true
	default:
		return migrated, false
	}
}
