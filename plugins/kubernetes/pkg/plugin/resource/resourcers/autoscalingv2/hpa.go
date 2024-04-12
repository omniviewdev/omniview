//nolint:gochecknoglobals,gomnd // column definitions are global
package autoscalingv2

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var HPACols = []types.ColumnDef{
	{
		ID:        "targetRef",
		Header:    "Target Ref",
		Accessors: "$.spec.scaleTargetRef",
		Width:     200,
		ResourceLink: &types.ResourceLink{
			IDAccessor:  "name",
			KeyAccessor: "kind",
			Namespaced:  true,
			KeyMap: map[string]string{
				"ReplicaSet":            "apps::v1::ReplicaSet",
				"ReplicationController": "core::v1::ReplicationController",
				"Deployment":            "apps::v1::Deployment",
				"StatefulSet":           "apps::v1::StatefulSet",
				"DaemonSet":             "apps::v1::DaemonSet",
				"Job":                   "batch::v1::Job",
				"CronJob":               "batch::v1::CronJob",
			},
			DetailExtractors: map[string]string{
				"Name": "name",
			},
			DisplayID: true,
		},
	},
	{
		ID:        "minReplicas",
		Header:    "Min",
		Accessors: "spec.minReplicas",
		Width:     70,
	},
	{
		ID:        "maxReplicas",
		Header:    "Max",
		Accessors: "spec.maxReplicas",
		Width:     70,
	},
	{
		ID:        "currentReplicas",
		Header:    "Current",
		Accessors: "status.currentReplicas",
		Width:     80,
	},
	{
		ID:        "desiredReplicas",
		Header:    "Desired",
		Accessors: "status.desiredReplicas",
		Width:     80,
	},
	{
		ID:        "lastScaleTime",
		Header:    "Last Scale",
		Accessors: "status.lastScaleTime",
		Width:     120,
		Formatter: types.CellValueFormatterAge,
	},
}
