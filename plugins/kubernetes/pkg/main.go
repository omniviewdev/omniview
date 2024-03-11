package main

import (
	"github.com/omniview/kubernetes/pkg/plugin/resource"
	"github.com/omniviewdev/plugin/pkg/resource/types"
	"github.com/omniviewdev/plugin/pkg/sdk"
	sdksettings "github.com/omniviewdev/plugin/pkg/settings"
)

type (
	ClientType                 resource.ClientSet
	InformerType               interface{}
	NamespaceDataType          resource.Data
	NamespaceSensitiveDataType resource.SensitiveData
)

func main() {
	plugin := sdk.NewPlugin(sdk.PluginOpts{
		Settings: []interface{}{
			// Define your various plugin settings here. The available settings can be found in the settings section
			// of the SDK package:
			// https://github.com/omniviewdev/plugin/pkg/settings/types.go
			// ...
			sdksettings.Multitext{
				ID:          "kubeconfigs",
				Name:        "Kubeconfigs",
				Description: "A list of available Kubeconfigs to use",
				Default:     []string{"~/.kube/config"},
			},
			sdksettings.Text{
				ID:          "shell",
				Name:        "Shell",
				Description: "The default shell to use for running commands and authenticating with Kubernetes clusters.",
				Default:     "/bin/zsh",
			},
		},
	})

	// Register your capabilities here
	// ....
	sdk.RegisterStaticResourcePlugin[resource.ClientSet, any](
		plugin,
		sdk.StaticResourcePluginOpts[resource.ClientSet, resource.Data, resource.SensitiveData]{
			ClientFactory: resource.NewKubernetesClientFactory(),
			Resourcers:    map[types.ResourceMeta]types.Resourcer[resource.ClientSet]{},
		},
	)

	// Serve the plugin
	plugin.Serve()
}
