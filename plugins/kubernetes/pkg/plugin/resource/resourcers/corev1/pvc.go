//nolint:gochecknoglobals,gomnd // column definitions are global
package corev1

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var PVCDef = types.ResourceDefinition{
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
			Width:     180,
		},
		{
			ID:        "storageClassName",
			Header:    "StorageClass",
			Accessors: "spec.storageClassName",
			Alignment: types.CellAlignmentLeft,
			Width:     120,
		},
		{
			ID:        "status",
			Header:    "Status",
			Accessors: "status.phase",
			Alignment: types.CellAlignmentLeft,
			Width:     100,
			ColorMap: map[string]string{
				"Bound":   "success",
				"Pending": "warning",
				"Lost":    "danger",
			},
		},
		{
			ID:        "capacity",
			Header:    "Capacity",
			Accessors: "status.capacity.storage",
			Alignment: types.CellAlignmentLeft,
			Width:     100,
		},
		{
			ID:        "accessModes",
			Header:    "Access Modes",
			Accessors: "$.spec.accessModes[*]",
			Alignment: types.CellAlignmentLeft,
			Width:     150,
		},
		{
			ID:        "volumeMode",
			Header:    "Volume Mode",
			Accessors: "spec.volumeMode",
			Alignment: types.CellAlignmentLeft,
			Width:     120,
		},
		{
			ID:        "volumeName",
			Header:    "Volume Name",
			Accessors: "spec.volumeName",
			Alignment: types.CellAlignmentLeft,
			Width:     300,
			Hidden:    true,
		},
		{
			ID:        "storageRequest",
			Header:    "Storage Request",
			Accessors: "spec.resources.requests.storage",
			Alignment: types.CellAlignmentLeft,
			Width:     150,
			Hidden:    true,
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
