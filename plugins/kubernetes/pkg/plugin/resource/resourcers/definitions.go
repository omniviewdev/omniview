//nolint:gochecknoglobals,gomnd // column definitions are global
package resourcers

import (
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers/appsv1"
	"github.com/omniview/kubernetes/pkg/plugin/resource/resourcers/corev1"
	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
)

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
			Alignment: types.CellAlignmentCenter,
			Width:     120,
			Formatter: types.CellValueFormatterAge,
		},
	},
}

var ResourceDefs = map[string]types.ResourceDefinition{
	"apps::v1::Deployment":         appsv1.DeploymentDef,
	"apps::v1::StatefulSet":        appsv1.StatefulSetDef,
	"apps::v1::ReplicaSet":         appsv1.ReplicaSetDef,
	"apps::v1::DaemonSet":          appsv1.DaemonSetDef,
	"apps::v1::ControllerRevision": appsv1.ControllerRevisionDef,
	"core::v1::Node":               corev1.NodeDef,
}
