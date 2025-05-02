package main

import (
	"flag"

	"github.com/omniview/kubernetes/pkg/plugin/exec"
	"github.com/omniview/kubernetes/pkg/plugin/networker"
	"github.com/omniview/kubernetes/pkg/plugin/resource"
	"github.com/omniviewdev/settings"

	"github.com/omniviewdev/plugin-sdk/pkg/sdk"

	_ "k8s.io/client-go/plugin/pkg/client/auth/azure"
	_ "k8s.io/client-go/plugin/pkg/client/auth/exec"
	_ "k8s.io/client-go/plugin/pkg/client/auth/gcp"
	_ "k8s.io/client-go/plugin/pkg/client/auth/oidc"

	"k8s.io/klog/v2"
)

func init() {
	// 1) Initialize klog’s flags
	klog.InitFlags(nil)

	// 2) Send logs to stderr (so you see them in your console)
	flag.Set("logtostderr", "true")

	// 3) Set the verbosity level (6 gives you List/Watch errors, retries, etc)
	flag.Set("v", "6")

	// 4) Parse all flags (this must come *after* setting the flag defaults)
	flag.Parse()
}

func main() {
	defer klog.Flush()

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
