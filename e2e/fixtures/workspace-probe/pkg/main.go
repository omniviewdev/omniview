package main

import (
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/settings"
)

func main() {
	plugin := sdk.NewPlugin(sdk.PluginOpts{
		ID: "workspace-probe",
		Settings: []settings.Setting{
			{
				ID:          "probe_counter",
				Label:       "Probe counter",
				Description: "Non-sensitive integer persisted by the host for this workspace profile.",
				Type:        settings.Integer,
				Default:     0,
				Sensitive:   false,
			},
		},
	})
	plugin.Serve()
}
