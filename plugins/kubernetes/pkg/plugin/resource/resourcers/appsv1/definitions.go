//nolint:gochecknoglobals,gomnd // column definitions are global
package appsv1

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var DeploymentCols = []types.ColumnDef{
	{
		ID:        "replicas",
		Header:    "Replicas",
		Accessors: "status.replicas",
		Alignment: types.CellAlignmentCenter,
		Width:     80,
	},
}

var (
	StatefulSetCols        = []types.ColumnDef{}
	DaemonSetCols          = []types.ColumnDef{}
	ReplicaSetCols         = []types.ColumnDef{}
	ControllerRevisionCols = []types.ColumnDef{}
)
