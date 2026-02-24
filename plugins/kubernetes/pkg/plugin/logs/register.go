package logs

import (
	"github.com/omniviewdev/plugin-sdk/pkg/logs"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
)

// Register registers the log capability with the Kubernetes plugin.
func Register(plugin *sdk.Plugin) {
	logs.RegisterPlugin(plugin, logs.PluginOpts{
		Handlers: map[string]logs.Handler{
			"core::v1::Pod": {
				Plugin:        "kubernetes",
				Resource:      "core::v1::Pod",
				Handler:       PodLogHandler,
				SourceBuilder: PodSourceBuilder,
				TargetBuilder: types.ActionTargetBuilder{
					Paths: []string{
						"$.spec.containers[*]",
						"$.spec.initContainers[*]",
						"$.spec.ephemeralContainers[*]",
					},
					Selectors:     map[string]string{"container": "$.name"},
					LabelSelector: "container",
				},
			},
		},
		SourceResolvers: map[string]logs.SourceResolver{
			"apps::v1::Deployment":  DeploymentSourceResolver,
			"apps::v1::StatefulSet": StatefulSetSourceResolver,
			"apps::v1::DaemonSet":   DaemonSetSourceResolver,
			"apps::v1::ReplicaSet":  ReplicaSetSourceResolver,
			"batch::v1::Job":        JobSourceResolver,
			"batch::v1::CronJob":    CronJobSourceResolver,
		},
	})
}
