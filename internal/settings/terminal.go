package categories

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"github.com/omniviewdev/plugin-sdk/settings"
)

// defaultTerminalFontSize is the default terminal font size in pixels.
const defaultTerminalFontSize = 12

//nolint:gochecknoglobals // we're providing this as a package level variable
var Terminal = settings.Category{
	ID:          "terminal",
	Label:       "Terminal",
	Description: "Customize the behavior of the terminal",
	Icon:        "LuSquareTerminal",
	Settings: map[string]settings.Setting{
		"defaultShell": {
			ID:          "defaultShell",
			Type:        settings.Text,
			Label:       "Default Shell",
			Default:     defaultShell(),
			Description: "The default shell to use when opening a terminal",
			Validator: func(value interface{}) error {
				val, ok := value.(string)
				if !ok {
					return settings.ErrSettingTypeMismatch
				}
				path, err := exec.LookPath(val)
				if err != nil {
					return fmt.Errorf("could not find executable: %w", err)
				}
				// make sure the shell exists on the users system
				if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
					return fmt.Errorf("could not find shell '%s'", val)
				}

				return nil
			},
		},

		settingTheme: {
			ID:          settingTheme,
			Type:        settings.Text,
			Label:       "Theme",
			Default:     themeApplication,
			Description: "The color theme for the terminal",
			Options: []settings.SettingOption{
				{Value: themeApplication, Label: "Application", Description: ""},
				{Value: "dracula", Label: "Dracula", Description: ""},
				{Value: "solarized-dark", Label: "Solarized Dark", Description: ""},
				{Value: "solarized-light", Label: "Solarized Light", Description: ""},
				{Value: "one-dark-pro", Label: "One Dark Pro", Description: ""},
				{Value: "monokai", Label: "Monokai", Description: ""},
				{Value: "nord", Label: "Nord", Description: ""},
				{Value: "gruvbox-dark", Label: "Gruvbox Dark", Description: ""},
				{Value: "tokyo-night", Label: "Tokyo Night", Description: ""},
				{Value: "catppuccin-mocha", Label: "Catppuccin Mocha", Description: ""},
				{Value: "github-dark", Label: "GitHub Dark", Description: ""},
				{Value: "github-light", Label: "GitHub Light", Description: ""},
				{Value: "material-dark", Label: "Material Dark", Description: ""},
				{Value: "cobalt2", Label: "Cobalt2", Description: ""},
				{Value: "ayu-dark", Label: "Ayu Dark", Description: ""},
				{Value: "synthwave-84", Label: "Synthwave '84", Description: ""},
				{Value: "rose-pine", Label: "Rose Pine", Description: ""},
				{Value: "kanagawa", Label: "Kanagawa", Description: ""},
				{Value: "everforest-dark", Label: "Everforest Dark", Description: ""},
				{Value: "one-light", Label: "One Light", Description: ""},
			},
		},
		settingFontSize: {
			ID:          settingFontSize,
			Type:        settings.Integer,
			Label:       "Font Size",
			Default:     defaultTerminalFontSize,
			Description: "The size of the font in the terminal",
		},
		"cursorStyle": {
			ID:          "cursorStyle",
			Type:        settings.Text,
			Label:       "Cursor Style",
			Default:     "block",
			Description: "The style of the cursor in the terminal",
			Options: []settings.SettingOption{
				{Value: "block", Label: "Block", Description: ""},
				{Value: "underline", Label: "Underline", Description: ""},
				{Value: "bar", Label: "Bar", Description: ""},
			},
		},
		"cursorBlink": {
			ID:          "cursorBlink",
			Type:        settings.Toggle,
			Label:       "Cursor Blink",
			Default:     true,
			Description: "Whether the cursor should blink in the terminal",
		},
	},
}

// MigrateTerminalValues upgrades the legacy application-theme sentinel.
func MigrateTerminalValues(values map[string]any) (map[string]any, bool) {
	migrated := make(map[string]any, len(values))
	for key, value := range values {
		migrated[key] = value
	}

	if migrated[settingTheme] == "default" {
		migrated[settingTheme] = themeApplication
		return migrated, true
	}

	return migrated, false
}

// defaultShell picks a shell that exists on this machine: the user's $SHELL,
// else the first common one found. A fixed /bin/zsh fails validation on
// systems without zsh, which rejects every save that includes the default.
func defaultShell() string {
	if runtime.GOOS == "windows" {
		return "powershell.exe"
	}
	candidates := []string{os.Getenv("SHELL"), "/bin/zsh", "/bin/bash", "/bin/sh"}
	for _, shell := range candidates {
		if shell == "" {
			continue
		}
		if _, err := exec.LookPath(shell); err == nil {
			return shell
		}
	}
	return "/bin/sh"
}
