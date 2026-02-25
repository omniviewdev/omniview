package main

import (
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/settings"

	"github.com/omniviewdev/aws-plugin/pkg/plugin/resource"
)

func main() {
	plugin := sdk.NewPlugin(sdk.PluginOpts{
		ID: "aws",
		Settings: []settings.Setting{
			{
				ID:          "config",
				Label:       "Configs",
				Description: "A list of available AWS configuration files to read",
				Type:        settings.Text,
				Default:     []string{"~/.aws/config"},
			},
		},
	})

	// Call your registrations here.
	resource.Register(plugin)

	// Serve the plugin
	plugin.Serve()
}
