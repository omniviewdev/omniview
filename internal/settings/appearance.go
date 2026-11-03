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
		"density": {
			ID:          "density",
			Type:        settings.Text,
			Label:       "UI Density",
			Default:     "comfortable",
			Description: "Choose comfortable spacing or a compact layout.",
			Options: []settings.SettingOption{
				{Value: "comfortable", Label: "Comfortable"},
				{Value: "compact", Label: "Compact"},
			},
			Validator: validateAppearanceChoice("comfortable", "compact"),
		},
		"textSize": {
			ID:          "textSize",
			Type:        settings.Text,
			Label:       "UI Text Size",
			Default:     "100",
			Description: "Scale interface text independently of density. Terminal and code editor fonts stay unchanged.",
			Options: []settings.SettingOption{
				{Value: "80", Label: "80%"},
				{Value: "90", Label: "90%"},
				{Value: "100", Label: "100%"},
				{Value: "110", Label: "110%"},
				{Value: "125", Label: "125%"},
			},
			Validator: validateAppearanceChoice("80", "90", "100", "110", "125"),
		},
		"motion": {
			ID:          "motion",
			Type:        settings.Text,
			Label:       "Motion",
			Default:     "system",
			Description: "Follow the system accessibility preference or choose animation behavior.",
			Options: []settings.SettingOption{
				{Value: "system", Label: "Follow System"},
				{Value: "normal", Label: "Normal"},
				{Value: "reduced", Label: "Reduced"},
			},
			Validator: validateAppearanceChoice("system", "normal", "reduced"),
		},
	},
}

func validateAppearanceChoice(choices ...string) func(any) settings.ValidationResult {
	return func(value any) settings.ValidationResult {
		text, ok := value.(string)
		if ok {
			for _, choice := range choices {
				if text == choice {
					return settings.ValidationResult{Valid: true}
				}
			}
		}
		return settings.ValidationResult{Code: "appearance_choice", Message: "Choose one of the available appearance options."}
	}
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
