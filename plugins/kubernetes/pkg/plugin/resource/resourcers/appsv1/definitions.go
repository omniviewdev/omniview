//nolint:gochecknoglobals,gomnd // column definitions are global
package appsv1

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var DeploymentCols = []types.ColumnDef{
	{
		ID:        "availableReplicas",
		Header:    "Available",
		Accessors: "status.availableReplicas",
		Alignment: types.CellAlignmentLeft,
		Width:     100,
	},
	{
		ID:        "replicas",
		Header:    "Replicas",
		Accessors: "status.replicas",
		Alignment: types.CellAlignmentLeft,
		Width:     80,
	},
	{
		ID:        "readyReplicas",
		Header:    "Ready",
		Accessors: "status.readyReplicas",
		Alignment: types.CellAlignmentLeft,
		Width:     100,
	},
	{
		ID:        "updatedReplicas",
		Header:    "Updated",
		Accessors: "status.updatedReplicas",
		Alignment: types.CellAlignmentLeft,
		Width:     100,
	},
	{
		ID:        "revisionHistoryLimit",
		Header:    "Revision History Limit",
		Accessors: "spec.revisionHistoryLimit",
		Alignment: types.CellAlignmentLeft,
		Width:     120,
	},
	{
		ID:        "strategy",
		Header:    "Strategy",
		Accessors: "spec.strategy.type",
		Alignment: types.CellAlignmentLeft,
		Width:     100,
	},
	{
		ID:        "minReadySeconds",
		Header:    "Min Ready Seconds",
		Accessors: "spec.minReadySeconds",
		Alignment: types.CellAlignmentLeft,
		Width:     100,
	},
}

var (
	StatefulSetCols        = []types.ColumnDef{}
	DaemonSetCols          = []types.ColumnDef{}
	ReplicaSetCols         = []types.ColumnDef{}
	ControllerRevisionCols = []types.ColumnDef{}
)
