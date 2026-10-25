package main

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/v1/resource/plugin"
	"github.com/omniviewdev/plugin-sdk/settings"
)

func main() {
	source, err := loadBenchmarkSource()
	if err != nil {
		panic(err)
	}
	controller, err := resource.BuildResourceController(context.Background(), resource.ResourcePluginConfig[benchmarkClient]{
		Connections: source,
		Patterns: map[string]resource.Resourcer[benchmarkClient]{
			"compute/instance": source,
			"container":        &benchmarkEvents{source},
			"vm":               source,
			"core::v1::Pod":    source,
		},
	})
	if err != nil {
		panic(err)
	}
	defer controller.Close()
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
	plugin.RegisterCapability("resource", &resourceplugin.GRPCPlugin{Impl: controller, SettingsProvider: plugin.SettingsProvider})
	plugin.Serve()
}
