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
		"registry_public_key": {
			ID:    "registry_public_key",
			Label: "Marketplace Signing Key",
			Description: "Hex-encoded Ed25519 public key used to verify plugin artifacts. Leave empty to use " +
				"the built-in key; set it when the marketplace URL points to a staging or self-hosted instance " +
				"that signs with its own key.",
			Type:    settings.Text,
			Default: "",
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
				Extensions:   nil,
				Relative:     false,
				DefaultPath:  "",
			},
		},
		"pnpmpath": {
			ID:          "pnpmpath",
			Label:       "PNPM Path",
			Description: "PNPM binary for standalone plugin development. Named workspaces require their owned launcher; select native pnpm with OMNIVIEW_PNPM_EXECUTABLE when starting the workspace instead.",
			Type:        settings.Text,
			Default:     "",
			FileSelection: &settings.SettingFileSelection{
				Enabled:      true,
				AllowFolders: false,
				Multiple:     false,
				Extensions:   nil,
				Relative:     false,
				DefaultPath:  "",
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
				Extensions:   nil,
				Relative:     false,
				DefaultPath:  "",
			},
		},
	},
}
