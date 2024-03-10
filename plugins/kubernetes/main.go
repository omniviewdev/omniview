package main

import (
	"embed"

	"github.com/omniview/kubernetes/resource"
	"github.com/omniviewdev/plugin/pkg/resource/types"
	"github.com/omniviewdev/plugin/pkg/sdk"
)

//go:embed plugin.yaml
var config embed.FS

func main() {
	// Initialize the plugin with the configuration
	plugin := sdk.NewPlugin(config)

	// Register your capabilities here
	// ....
	sdk.RegisterStaticResourcePlugin(
		plugin,
		sdk.StaticResourcePluginOpts[resource.ClientSet, resource.Data, resource.SensitiveData]{
			ClientFactory: resource.NewKubernetesClientFactory(),
			Resourcers:    map[types.ResourceMeta]types.Resourcer[resource.ClientSet]{},
		},
	)

	// Serve the plugin
	plugin.Serve()
}
