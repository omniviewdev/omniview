package main

import (
	"github.com/omniview/kubernetes/pkg/plugin/resource"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"

	k8splugin "github.com/omniview/kubernetes/pkg/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/settings"
)

func main() {
	plugin := sdk.NewPlugin(sdk.PluginOpts{
		ID: "kubernetes",
		Settings: []interface{}{
			// Define your various plugin settings here. The available settings can be found in the settings section
			// of the SDK package:
			// https://github.com/omniviewdev/plugin-sdk/pkg/settings/types.go
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

	sdk.RegisterResourcePlugin(
		plugin,
		sdk.ResourcePluginOpts[resource.ClientSet, dynamic.Interface, dynamicinformer.DynamicSharedInformerFactory]{
			ClientFactory:      resource.NewKubernetesClientFactory(),
			Resourcers:         map[types.ResourceMeta]types.Resourcer[resource.ClientSet]{},
			LoadConnectionFunc: k8splugin.LoadConnectionsFunc,
		},
	)

	// Serve the plugin
	plugin.Serve()
}
