package categories

import "github.com/omniviewdev/plugin-sdk/settings"

//nolint:gochecknoglobals // we're providing this as a package level variable
var Developer = settings.Category{
	ID:          "developer",
	Label:       "Developer Settings",
	Description: "Settings for developing or writing plugins within Omniview",
	Icon:        "LuBeaker",
	Settings: map[string]settings.Setting{
		"marketplace_url": {
			ID:          "marketplace_url",
			Label:       "Marketplace URL",
			Description: "Base URL for the plugin marketplace API. Change this to point to a staging or self-hosted instance.",
			Type:        settings.Text,
			Default:     "https://api.omniview.dev",
		},
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
