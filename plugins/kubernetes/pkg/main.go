package main

import (
	"github.com/omniview/kubernetes/pkg/plugin/exec"
	"github.com/omniview/kubernetes/pkg/plugin/networker"
	"github.com/omniview/kubernetes/pkg/plugin/resource"
	"github.com/omniviewdev/settings"

	"github.com/omniviewdev/plugin-sdk/pkg/sdk"

	_ "k8s.io/client-go/plugin/pkg/client/auth/azure"
	_ "k8s.io/client-go/plugin/pkg/client/auth/exec"
	_ "k8s.io/client-go/plugin/pkg/client/auth/gcp"
	_ "k8s.io/client-go/plugin/pkg/client/auth/oidc"
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
				FileSelection: &settings.SettingFileSelection{
					Enabled:      true,
					AllowFolders: false,
					Multiple:     true,
					DefaultPath:  "~/.kube",
				},
			},
			{
				ID:          "shell",
				Label:       "Shell",
				Description: "The default shell to use for running commands and authenticating with Kubernetes clusters.",
				Type:        settings.Text,
				Default:     "/bin/zsh",
			},
			{
				ID:          "layout",
				Label:       "Layout",
				Description: "The layout to use for the main sidebar",
				Type:        settings.Text,
				Default:     "default",
				Options: []settings.SettingOption{
					{
						Label:       "Default",
						Description: "The default layout",
						Value:       "default",
					},
					{
						Label:       "Compact",
						Description: "A more compact layout",
						Value:       "compact",
					},
				},
			},
		},
	})

	// Register the capabilities
	resource.Register(plugin)
	exec.Register(plugin)
	networker.Register(plugin)

	// Serve the plugin
	plugin.Serve()
}
