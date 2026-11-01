package categories

import "github.com/omniviewdev/plugin-sdk/settings"

// DefaultMarketplaceURL is the public marketplace API used without an explicit override.
const DefaultMarketplaceURL = "https://mkt.omniview.dev"

const defaultPprofPort = 6060

//nolint:gochecknoglobals // we're providing this as a package level variable
var Developer = settings.Category{
	ID:          "developer",
	Label:       "Developer Settings",
	Description: "Settings for developing or writing plugins within Omniview",
	Icon:        "LuBeaker",
	Settings: map[string]settings.Setting{
		"pprof_enabled": {
			ID:    "pprof_enabled",
			Label: "Enable local pprof",
			Description: "Enable unauthenticated profiling on 127.0.0.1 after restarting Omniview. " +
				"Captures can expose sensitive process data. Do not forward this endpoint.",
			Type:            settings.Toggle,
			Default:         false,
			RequiresRestart: true,
		},
		"plugin_pprof_enabled": {
			ID:    "plugin_pprof_enabled",
			Label: "Enable plugin pprof",
			Description: "Enable unauthenticated plugin profiling on 127.0.0.1 after restarting Omniview. " +
				"Captures can expose sensitive process data. Do not forward these endpoints.",
			Type:            settings.Toggle,
			Default:         false,
			RequiresRestart: true,
		},
		"pprof_port": {
			ID:              "pprof_port",
			Label:           "Host profiling port",
			Description:     "Local pprof port after restarting Omniview. Use 0 to select an available port.",
			Type:            settings.Integer,
			Default:         defaultPprofPort,
			Validator:       validatePprofPort,
			RequiresRestart: true,
		},
		"marketplace_url": {
			ID:          "marketplace_url",
			Label:       "Marketplace URL",
			Description: "Base URL for the plugin marketplace API. Change this to point to a staging or self-hosted instance.",
			Type:        settings.Text,
			Default:     DefaultMarketplaceURL,
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
			Validator:   validateGoExecutable,
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
