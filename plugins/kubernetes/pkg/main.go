package main

import (
	k8splugin "github.com/omniview/kubernetes/pkg/plugin"
	"github.com/omniview/kubernetes/pkg/plugin/resource"
	"github.com/omniviewdev/settings"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
)

func main() {
	plugin := sdk.NewPlugin(sdk.PluginOpts{
		ID: "kubernetes",
		Settings: []settings.Setting{
			{
				ID:          "kubeconfigs",
				Label:       "Kubeconfigs",
				Description: "A list of available Kubeconfigs to use",
				Type:        settings.Text,
				Default:     []string{"~/.kube/config"},
			},
			{
				ID:          "shell",
				Label:       "Shell",
				Description: "The default shell to use for running commands and authenticating with Kubernetes clusters.",
				Type:        settings.Text,
				Default:     "/bin/bash",
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
