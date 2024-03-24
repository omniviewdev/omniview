package main

import (
	"github.com/omniview/kubernetes/pkg/plugin/resource"
	"github.com/omniviewdev/settings"

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
				Default:     "/bin/zsh",
			},
		},
	})

	// Register the capabilities
	resource.Register(plugin)

	// Serve the plugin
	plugin.Serve()
}
