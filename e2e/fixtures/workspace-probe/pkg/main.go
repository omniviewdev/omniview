package main

import (
	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/settings"
)

func main() {
	source, err := loadBenchmarkSource()
	if err != nil {
		panic(err)
	}
	controller, err := newBenchmarkController(source)
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

func newBenchmarkController(source *benchmarkSource) (*resource.Controller[benchmarkClient], error) {
	registrations := make([]resource.Registration[benchmarkClient], 0, len(benchmarkProfiles))
	for _, profile := range benchmarkProfiles {
		scenario := source.scenarios[profile]
		registration := resource.Registration[benchmarkClient]{
			Connection: profile, Type: scenario.Type, Enumerate: source.Enumerate, Get: source.Get,
			SyncPolicy: resource.SyncOnConnect,
		}
		if len(scenario.Updates) > 0 {
			registration.Watch = (&benchmarkEvents{source}).Watch
		}
		registrations = append(registrations, registration)
	}
	return resource.NewController(resource.Config[benchmarkClient]{
		Catalog: source.Catalog, Registrations: registrations,
		Lifecycle: &resource.Lifecycle[benchmarkClient]{
			LoadConnections: source.LoadConnections, CreateClient: source.CreateClient,
			DestroyClient: source.DestroyClient, CheckConnection: source.CheckConnection,
		},
	})
}
