package resource

import "github.com/omniviewdev/plugin-sdk/pkg/sdk"

// Register registers the resource plugin with the plugin server.
func Register(plugin *sdk.Plugin) {
	sdk.RegisterResourcePlugin(
		plugin,
		sdk.ResourcePluginOpts[Client, DiscoveryClient, Informer]{
			ClientFactory:      NewClientFactory(),
			LoadConnectionFunc: LoadConnectionsFunc,
		},
	)
}
