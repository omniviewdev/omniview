//nolint:gochecknoglobals,gomnd // column definitions are global
package appsv1

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var DeploymentCols = []types.ColumnDef{
	{
		ID:        "availableReplicas",
		Header:    "Available",
		Accessors: "status.availableReplicas",
		Width:     80,
	},
	{
		ID:        "replicas",
		Header:    "Replicas",
		Accessors: "status.replicas",
		Width:     80,
	},
	{
		ID:        "readyReplicas",
		Header:    "Ready",
		Accessors: "status.readyReplicas",
		Width:     80,
	},
	{
		ID:        "updatedReplicas",
		Header:    "Updated",
		Accessors: "status.updatedReplicas",
		Width:     80,
		Hidden:    true,
	},
	{
		ID:        "revisionHistoryLimit",
		Header:    "Revision History Limit",
		Accessors: "spec.revisionHistoryLimit",
		Width:     120,
		Hidden:    true,
	},
	{
		ID:        "strategy",
		Header:    "Strategy",
		Accessors: "spec.strategy.type",
		Width:     120,
	},
	{
		ID:        "minReadySeconds",
		Header:    "Min Ready Seconds",
		Accessors: "spec.minReadySeconds",
		Width:     100,
		Hidden:    true,
	},
}

var (
	StatefulSetCols = []types.ColumnDef{
		{
			ID:        "podManagementPolicy",
			Header:    "Pod Management Policy",
			Accessors: "spec.podManagementPolicy",
			Width:     200,
		},
		{
			ID:        "availableReplicas",
			Header:    "Available",
			Accessors: "status.availableReplicas",
			Width:     80,
		},
		{
			ID:        "replicas",
			Header:    "Replicas",
			Accessors: "status.replicas",
			Width:     80,
		},
		{
			ID:        "readyReplicas",
			Header:    "Ready",
			Accessors: "status.readyReplicas",
			Width:     80,
		},
		{
			ID:        "updatedReplicas",
			Header:    "Updated",
			Accessors: "status.updatedReplicas",
			Width:     80,
			Hidden:    true,
		},
		{
			ID:        "revisionHistoryLimit",
			Header:    "Revision History Limit",
			Accessors: "spec.revisionHistoryLimit",
			Width:     120,
			Hidden:    true,
		},
		{
			ID:        "strategy",
			Header:    "Update Strategy",
			Accessors: "spec.updateStrategy.type",
			Width:     150,
		},
		{
			ID:        "minReadySeconds",
			Header:    "Min Ready Seconds",
			Accessors: "spec.minReadySeconds",
			Width:     100,
			Hidden:    true,
		},
		{
			ID:        "collisionCount",
			Header:    "Collision Count",
			Accessors: "status.collisionCount",
			Width:     120,
			Hidden:    true,
		},
	}
	DaemonSetCols = []types.ColumnDef{
		{
			ID:        "desiredNumberScheduled",
			Header:    "Desired",
			Accessors: "status.desiredNumberScheduled",
			Width:     100,
			Hidden:    true,
		},
		{
			ID:        "numberAvailable",
			Header:    "Available",
			Accessors: "status.numberAvailable",
			Width:     100,
		},
		{
			ID:        "numberReady",
			Header:    "Ready",
			Accessors: "status.numberReady",
			Width:     100,
			Hidden:    true,
		},
		{
			ID:        "currentNumberScheduled",
			Header:    "Current",
			Accessors: "status.currentNumberScheduled",
			Width:     100,
		},
		{
			ID:        "numberMisscheduled",
			Header:    "Misscheduled",
			Accessors: "status.numberMischeduled",
			Width:     100,
			Hidden:    true,
		},
		{
			ID:        "strategy",
			Header:    "Strategy",
			Accessors: "spec.updateStrategy.type",
			Width:     120,
		},
	}
	ReplicaSetCols = []types.ColumnDef{
		{
			ID:        "availableReplicas",
			Header:    "Available",
			Accessors: "status.availableReplicas",
			Width:     80,
		},
		{
			ID:        "replicas",
			Header:    "Replicas",
			Accessors: "status.replicas",
			Width:     80,
		},
		{
			ID:        "readyReplicas",
			Header:    "Ready",
			Accessors: "status.readyReplicas",
			Width:     80,
		},
		{
			ID:        "fullyLabeledReplicas",
			Header:    "Fully Labeled Replicas",
			Accessors: "status.fullyLabeledReplicas",
			Width:     200,
			Hidden:    true,
		},
		{
			ID:        "controlledBy",
			Header:    "Controlled By",
			Accessors: "$.metadata.ownerReferences[0]",
			Width:     150,
			ResourceLink: &types.ResourceLink{
				IDAccessor:  "name",
				KeyAccessor: "kind",
				Namespaced:  true,
				KeyMap: map[string]string{
					"Deployment": "apps::v1::Deployment",
				},
				DetailExtractors: map[string]string{
					"Name": "name",
				},
			},
		},
	}
	ControllerRevisionCols = []types.ColumnDef{
		{
			ID:        "revision",
			Header:    "Revision",
			Accessors: "revision",
			Width:     80,
		},
		{
			ID:        "ownerReferences",
			Header:    "Owner Reference",
			Accessors: "$.metadata.ownerReferences[0]",
			Width:     150,
			ResourceLink: &types.ResourceLink{
				IDAccessor:  "name",
				KeyAccessor: "kind",
				Namespaced:  true,
				KeyMap: map[string]string{
					"ReplicaSet":            "apps::v1::ReplicaSet",
					"ReplicationController": "core::v1::ReplicationController",
					"StatefulSet":           "apps::v1::StatefulSet",
					"Deployment":            "apps::v1::Deployment",
					"DaemonSet":             "apps::v1::DaemonSet",
					"Job":                   "batch::v1::Job",
					"CronJob":               "batch::v1::CronJob",
				},
				DetailExtractors: map[string]string{
					"Name": "name",
				},
			},
		},
	}
)
