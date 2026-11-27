package categories

import (
	"math"
	"os"
	"slices"
	"strings"
	"unicode"

	"github.com/omniviewdev/omniview/internal/nativeapps"
	"github.com/omniviewdev/omniview/internal/shellenv"

	"github.com/omniviewdev/plugin-sdk/settings"
)

// settingShellIntegration is the id of the opt-out of the shell integration in the terminal category: on by default.
const settingShellIntegration = "shellIntegration"

// defaultTerminalFontSize is the default terminal font size in pixels.
const defaultTerminalFontSize = 12

// The producer's bounds of the terminal's appearance and behaviour (issue #697 step 1). The page reads a value it was given
// as one inside them, and a value outside them is refused at the commit, never stored.
const (
	minTerminalFontSize   = 6
	maxTerminalFontSize   = 72
	minTerminalLineHeight = 1.0
	maxTerminalLineHeight = 2.0
	// defaultTerminalLineHeight is the row the theme's mock draws: 18 px at 12 px.
	defaultTerminalLineHeight = 1.5
	maxTerminalScrollback     = 100_000
	defaultTerminalScrollback = 5_000
	// maxTerminalFontFamily is the longest font list accepted: it is a list of names, not a stylesheet.
	maxTerminalFontFamily = 256
)

// settingCursorBlinkNext is the new Terminal tool's own cursor blink. The key "cursorBlink" is the legacy UI's and its
// declared default (true) stays: the new tool's rule is that an idle terminal holds zero timers, and a blinking cursor is a
// timer for as long as the terminal has focus, so it reads this key, which is off by default.
const settingCursorBlinkNext = "blinkingCursor"

// The words the closed choices of the terminal's settings share.
const (
	settingLineHeight = "lineHeight"
	choiceAuto        = "auto"
	choiceOn          = "on"
	choiceOff         = "off"
	labelAutomatic    = "Automatic"
	labelOff          = "Off"
)

func invalidTerminalValue(code, message string) settings.ValidationResult {
	return settings.ValidationResult{Valid: false, Code: code, Message: message}
}

func validTerminalValue() settings.ValidationResult {
	return settings.ValidationResult{Valid: true, Code: "valid", Message: "Value is valid."}
}

// terminalNumber reads a JSON or Go number without truncating it: NaN and the infinities are not numbers a setting has.
func terminalNumber(value any) (float64, bool) {
	var number float64
	switch v := value.(type) {
	case int:
		number = float64(v)
	case int64:
		number = float64(v)
	case float64:
		number = v
	default:
		return 0, false
	}

	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}

// terminalWholeNumber validates a whole number from min to max.
func terminalWholeNumber(code, message string, minimum, maximum int) func(any) settings.ValidationResult {
	return func(value any) settings.ValidationResult {
		number, ok := terminalNumber(value)
		if !ok || math.Trunc(number) != number || number < float64(minimum) || number > float64(maximum) {
			return invalidTerminalValue(code, message)
		}

		return validTerminalValue()
	}
}

// terminalChoice validates one of a closed list of words.
func terminalChoice(code, message string, words ...string) func(any) settings.ValidationResult {
	return func(value any) settings.ValidationResult {
		word, ok := value.(string)
		if ok {
			for _, allowed := range words {
				if word == allowed {
					return validTerminalValue()
				}
			}
		}

		return invalidTerminalValue(code, message)
	}
}

// reservedFontWords are the words CSS reserves in a font list: unquoted they are no family (`inherit` makes the whole declaration invalid, so the page's canvas keeps the old font), and the page refuses them too.
//
// legacyDefaultWord is the theme sentinel the application once stored, and also a word CSS reserves in a font list.
const legacyDefaultWord = "default"

//nolint:gochecknoglobals // a constant table
var reservedFontWords = []string{"inherit", "initial", "unset", "revert", "revert-layer", legacyDefaultWord}

// validateTerminalFontFamily accepts a comma-separated list of font names, each a run of letters, digits, spaces, dots,
// hyphens and underscores, optionally in one pair of quotes ("Fira Code", monospace). The value reaches a font string of the
// page's canvas, so it is a list of names and nothing else: no semicolon, no function (url(...)), no brace, no backslash, no
// line break. Empty means the theme's own monospace face.
func validateTerminalFontFamily(value any) settings.ValidationResult {
	const message = "Enter font names separated by commas, such as \"JetBrains Mono\", Menlo, monospace."
	text, ok := value.(string)
	if !ok || len(text) > maxTerminalFontFamily {
		return invalidTerminalValue("font_family", message)
	}
	if strings.TrimSpace(text) == "" {
		if text == "" {
			return validTerminalValue()
		}

		return invalidTerminalValue("font_family", message)
	}

	for _, name := range strings.Split(text, ",") {
		name = strings.TrimSpace(name)
		if len(name) >= 2 && (name[0] == '"' || name[0] == '\'') && name[len(name)-1] == name[0] {
			name = name[1 : len(name)-1]
		}
		if strings.TrimSpace(name) == "" || slices.Contains(reservedFontWords, strings.ToLower(strings.TrimSpace(name))) {
			return invalidTerminalValue("font_family", message)
		}
		for _, r := range name {
			if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != ' ' && r != '.' && r != '-' && r != '_' {
				return invalidTerminalValue("font_family", message)
			}
		}
	}

	return validTerminalValue()
}

//nolint:gochecknoglobals // we're providing this as a package level variable
var Terminal = settings.Category{
	ID:          "terminal",
	Label:       "Terminal",
	Description: "Customize the behavior of the terminal",
	Icon:        "LuSquareTerminal",
	Settings: map[string]settings.Setting{
		"nativeApplication": {
			ID:          "nativeApplication",
			Type:        settings.Text,
			Label:       "Native Terminal Application",
			Default:     "terminal",
			Description: "macOS application for a fresh external resource shell. Built-in terminals are unchanged.",
			Validator: func(value interface{}) settings.ValidationResult {
				app, ok := value.(string)
				if !ok {
					return settings.ValidationResult{Code: "native_application", Message: "Choose an installed supported application."}
				}
				if _, supported := nativeapps.BundleID(app); !supported {
					return settings.ValidationResult{Code: "native_application", Message: "Choose an installed supported application."}
				}
				return settings.ValidationResult{Valid: true}
			},
		},
		"defaultShell": {
			ID:          "defaultShell",
			Type:        settings.Text,
			Label:       "Default Shell",
			Default:     defaultShell(),
			Description: "The default shell to use when opening a terminal",
			Validator: func(value interface{}) settings.ValidationResult {
				val, ok := value.(string)
				if !ok {
					return settings.ValidationResult{Code: "shell_type", Message: "Enter a shell executable name or path."}
				}
				path, err := shellenv.Check(val)
				if err != nil {
					return settings.ValidationResult{Code: "shell_executable", Message: "Choose an executable shell installed on this system."}
				}
				// make sure the shell exists on the users system
				if _, statErr := os.Stat(path); os.IsNotExist(statErr) {
					return settings.ValidationResult{Code: "shell_missing", Message: "The selected shell no longer exists. Choose an installed shell."}
				}

				return settings.ValidationResult{Valid: true, Code: "shell_executable", Message: "Shell executable is available."}
			},
		},

		settingShellIntegration: {
			ID:          settingShellIntegration,
			Type:        settings.Toggle,
			Label:       "Shell Integration",
			Default:     true,
			Description: "Let the shell tell the terminal where each command starts and ends, and in which directory. Applies to terminals opened after the change; the shell's startup files are never edited.",
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
			Description: "The size of the font in the terminal, in pixels, from 6 to 72.",
			Validator:   terminalWholeNumber("font_size", "Enter a whole number of pixels from 6 to 72.", minTerminalFontSize, maxTerminalFontSize),
		},
		"fontFamily": {
			ID:          "fontFamily",
			Type:        settings.Text,
			Label:       "Font Family",
			Default:     "",
			Description: "Font names for the terminal, separated by commas, tried in order before the theme's monospace face. Empty uses the theme's face. Applies to the new Terminal tool.",
			Validator:   validateTerminalFontFamily,
		},
		settingLineHeight: {
			ID:          settingLineHeight,
			Type:        settings.Float,
			Label:       "Line Height",
			Default:     defaultTerminalLineHeight,
			Description: "The height of a row as a multiple of the font size, from 1 to 2. A row is never shorter than the font's own line height. Applies to the new Terminal tool.",
			Validator: func(value any) settings.ValidationResult {
				number, ok := terminalNumber(value)
				if !ok || number < minTerminalLineHeight || number > maxTerminalLineHeight {
					return invalidTerminalValue("line_height", "Enter a number from 1 to 2.")
				}

				return validTerminalValue()
			},
		},
		"scrollback": {
			ID:          "scrollback",
			Type:        settings.Integer,
			Label:       "Scrollback",
			Default:     defaultTerminalScrollback,
			Description: "Lines the terminal keeps above the screen, from 0 to 100000. A larger value uses more memory for each terminal. Applies to the new Terminal tool.",
			Validator:   terminalWholeNumber("scrollback", "Enter a whole number of lines from 0 to 100000.", 0, maxTerminalScrollback),
		},
		"cursorStyle": {
			ID:          "cursorStyle",
			Type:        settings.Text,
			Label:       "Cursor Style",
			Default:     "block",
			Description: "The style of the cursor in the terminal",
			Validator:   terminalChoice("cursor_style", "Choose block, underline or bar.", "block", "underline", "bar"),
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
		settingCursorBlinkNext: {
			ID:          settingCursorBlinkNext,
			Type:        settings.Toggle,
			Label:       "Blinking Cursor (new terminal)",
			Default:     false,
			Description: "Whether the cursor blinks in the new terminal. A blinking cursor keeps a timer running while the terminal has the focus, so it is off unless you turn it on. Applies to the new Terminal tool.",
		},
		"macOptionIsMeta": {
			ID:          "macOptionIsMeta",
			Type:        settings.Text,
			Label:       "Option as Meta",
			Default:     choiceAuto,
			Description: "Whether the Option key acts as Meta (Alt+B moves back a word) instead of typing a character. Automatic turns it on for the US and US International layouts. Applies to the new Terminal tool.",
			Validator:   terminalChoice("option_as_meta", "Choose auto, on or off.", choiceAuto, choiceOn, choiceOff),
			Options: []settings.SettingOption{
				{Value: choiceAuto, Label: labelAutomatic, Description: ""},
				{Value: choiceOn, Label: "On", Description: ""},
				{Value: choiceOff, Label: labelOff, Description: ""},
			},
		},
		"bell": {
			ID:          "bell",
			Type:        settings.Text,
			Label:       "Bell",
			Default:     "visual",
			Description: "What the terminal does when a program rings the bell. The terminal never makes a sound. Applies to the new Terminal tool.",
			Validator:   terminalChoice("bell", "Choose off or visual.", "off", "visual"),
			Options: []settings.SettingOption{
				{Value: choiceOff, Label: labelOff, Description: ""},
				{Value: "visual", Label: "Visual", Description: ""},
			},
		},
		"gpuAcceleration": {
			ID:          "gpuAcceleration",
			Type:        settings.Text,
			Label:       "GPU Acceleration",
			Default:     choiceAuto,
			Description: "Whether the terminal draws with the GPU. Automatic uses it while the terminal is shown and falls back to the slower renderer if it fails. Applies to the new Terminal tool.",
			Validator:   terminalChoice("gpu_acceleration", "Choose auto, on or off.", choiceAuto, choiceOn, choiceOff),
			Options: []settings.SettingOption{
				{Value: choiceAuto, Label: labelAutomatic, Description: ""},
				{Value: choiceOn, Label: "On", Description: ""},
				{Value: choiceOff, Label: labelOff, Description: ""},
			},
		},
		"copyOnSelect": {
			ID:          "copyOnSelect",
			Type:        settings.Toggle,
			Label:       "Copy on Select",
			Default:     false,
			Description: "Copy the selected text to the clipboard when you finish selecting it with the mouse. Applies to the new Terminal tool.",
		},
		"multiLinePasteWarning": {
			ID:          "multiLinePasteWarning",
			Type:        settings.Text,
			Label:       "Multi-line Paste Warning",
			Default:     choiceAuto,
			Description: "Ask before pasting text of more than one line. Automatic asks only when the program has not asked for bracketed paste. Applies to the new Terminal tool.",
			Validator:   terminalChoice("multi_line_paste", "Choose auto, always or never.", "auto", "always", "never"),
			Options: []settings.SettingOption{
				{Value: choiceAuto, Label: labelAutomatic, Description: ""},
				{Value: "always", Label: "Always ask", Description: ""},
				{Value: "never", Label: "Never ask", Description: ""},
			},
		},
	},
}

// MigrateTerminalValues upgrades the legacy application-theme sentinel.
func MigrateTerminalValues(values map[string]any) (map[string]any, bool) {
	migrated := make(map[string]any, len(values))
	for key, value := range values {
		migrated[key] = value
	}

	if migrated[settingTheme] == legacyDefaultWord {
		migrated[settingTheme] = themeApplication
		return migrated, true
	}

	return migrated, false
}

// defaultShell also consults the account database before package-init defaults
// are registered, so Finder launches do not bake in an arbitrary fallback.
func defaultShell() string {
	return shellenv.Default()
}
