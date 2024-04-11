//nolint:gochecknoglobals,gomnd // column definitions are global
package resourcers

import (
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers/appsv1"
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers/corev1"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
)

func GenerateResourceDef(columndefs []types.ColumnDef, namespaced bool) types.ResourceDefinition {
	cols := make([]types.ColumnDef, 0, len(columndefs)+3)
	cols = append(cols,
		types.ColumnDef{
			ID:        "name",
			Header:    "Name",
			Accessors: "metadata.name",
			Alignment: types.CellAlignmentLeft,
		},
	)

	if namespaced {
		cols = append(cols,
			types.ColumnDef{
				ID:        "namespace",
				Header:    "Namespace",
				Accessors: "metadata.namespace",
				Alignment: types.CellAlignmentLeft,
				Width:     150,
			},
		)
	}

	cols = append(cols, columndefs...)
	cols = append(
		cols,
		types.ColumnDef{
			ID:        "age",
			Header:    "Age",
			Accessors: "metadata.creationTimestamp",
			Alignment: types.CellAlignmentLeft,
			Width:     120,
			Formatter: types.CellValueFormatterAge,
		},
	)

	def := types.ResourceDefinition{
		IDAccessor:       "metadata.name",
		MemoizerAccessor: "metadata.uid,metadata.resourceVersion",
		ColumnDefs:       cols,
	}

	if namespaced {
		def.NamespaceAccessor = "metadata.namespace"
	}

	return def
}

var DefaultResourceDef = types.ResourceDefinition{
	IDAccessor:        "metadata.name",
	NamespaceAccessor: "metadata.namespace",
	MemoizerAccessor:  "metadata.uid,metadata.resourceVersion",
	ColumnDefs: []types.ColumnDef{
		{
			ID:        "name",
			Header:    "Name",
			Accessors: "metadata.name",
			Alignment: types.CellAlignmentLeft,
		},
		{
			ID:        "namespace",
			Header:    "Namespace",
			Accessors: "metadata.namespace",
			Alignment: types.CellAlignmentLeft,
			Width:     150,
		},
		{
			ID:        "age",
			Header:    "Age",
			Accessors: "metadata.creationTimestamp",
			Alignment: types.CellAlignmentLeft,
			Width:     80,
			Formatter: types.CellValueFormatterAge,
		},
	},
}

var ResourceDefs = map[string]types.ResourceDefinition{
	"apps::v1::Deployment":            GenerateResourceDef(appsv1.DeploymentCols, true),
	"apps::v1::StatefulSet":           GenerateResourceDef(appsv1.StatefulSetCols, true),
	"apps::v1::ReplicaSet":            GenerateResourceDef(appsv1.ReplicaSetCols, true),
	"apps::v1::DaemonSet":             GenerateResourceDef(appsv1.DaemonSetCols, true),
	"apps::v1::ControllerRevision":    GenerateResourceDef(appsv1.ControllerRevisionCols, true),
	"core::v1::Node":                  corev1.NodeDef,
	"core::v1::Pod":                   corev1.PodDef,
	"core::v1::Service":               corev1.ServiceDef,
	"core::v1::PersistentVolumeClaim": corev1.PVCDef,
}
