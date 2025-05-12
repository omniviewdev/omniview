package categories

import "github.com/omniviewdev/settings"

//nolint:gochecknoglobals // we're providing this as a package level variable
var Developer = settings.Category{
	ID:          "developer",
	Label:       "Developer Settings",
	Description: "Settings for developing or writing plugins within Omniview",
	Icon:        "LuBeaker",
	Settings: map[string]settings.Setting{
		"gopath": {
			ID:          "gopath",
			Label:       "Go Path",
			Description: "Path to the Go binary",
			Type:        settings.Text,
			Default:     "",
			FileSelection: &settings.SettingFileSelection{
				Enabled:      true,
				AllowFolders: false,
				Multiple:     false,
			},
		},
		"pnpmpath": {
			ID:          "pnpmpath",
			Label:       "PNPM Path",
			Description: "Path to the PNPM binary",
			Type:        settings.Text,
			Default:     "",
			FileSelection: &settings.SettingFileSelection{
				Enabled:      true,
				AllowFolders: false,
				Multiple:     false,
			},
		},
		"nodepath": {
			ID:          "nodepath",
			Label:       "Node Path",
			Description: "Path to the Node binary",
			Type:        settings.Text,
			Default:     "",
			FileSelection: &settings.SettingFileSelection{
				Enabled:      true,
				AllowFolders: false,
				Multiple:     false,
			},
		},
	},
}
