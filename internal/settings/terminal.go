package categories

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/omniviewdev/settings"
)

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
			Default:     "/bin/zsh",
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
				if _, err := os.Stat(path); os.IsNotExist(err) {
					return fmt.Errorf("could not find shell '%s'", val)
				}

				return nil
			},
		},

		"fontSize": {
			ID:          "fontSize",
			Type:        settings.Integer,
			Label:       "Font Size",
			Default:     12, //nolint:gomnd // this is a reasonable default
			Description: "The size of the font in the terminal",
		},
		"cursorStyle": {
			ID:          "cursorStyle",
			Type:        settings.Text,
			Label:       "Cursor Style",
			Default:     "block",
			Description: "The style of the cursor in the terminal",
			Options: []settings.SettingOption{
				{Value: "block", Label: "Block"},
				{Value: "underline", Label: "Underline"},
				{Value: "bar", Label: "Bar"},
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
