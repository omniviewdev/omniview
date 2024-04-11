//nolint:gochecknoglobals,gomnd // column definitions are global
package corev1

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var PVDef = types.ResourceDefinition{
	IDAccessor:        "metadata.name",
	NamespaceAccessor: "metadata.namespace",
	MemoizerAccessor:  "metadata.uid,metadata.resourceVersion",
	ColumnDefs: []types.ColumnDef{
		{
			ID:        "name",
			Header:    "Name",
			Accessors: "metadata.name",
		},
		{
			ID:        "claimRef",
			Header:    "ClaimRef",
			Accessors: "$.spec.claimRef",
			Component: string(types.CellComponentResourceLink),
			Width:     280,
			ResourceLink: &types.ResourceLink{
				IDAccessor:        "name",
				KeyAccessor:       "kind",
				Namespaced:        true,
				NamespaceAccessor: "namespace",
				KeyMap: map[string]string{
					"PersistentVolumeClaim": "core::v1::PersistentVolumeClaim",
				},
				DetailExtractors: map[string]string{
					"Name": "name",
				},
				DisplayID: true,
			},
		},
		{
			ID:        "reclaimPolicy",
			Header:    "Reclaim Policy",
			Accessors: "spec.persistentVolumeReclaimPolicy",
			Width:     130,
		},
		{
			ID:        "csiDriver",
			Header:    "CSI Driver",
			Accessors: "spec.csi.driver",
			Width:     150,
			Hidden:    true,
		},
		{
			ID:        "fsType",
			Header:    "FS Type",
			Accessors: "spec.csi.fsType",
			Width:     100,
			Hidden:    true,
		},
		{
			ID:        "volumeHandle",
			Header:    "Volume Handle",
			Accessors: "spec.csi.volumeHandle",
			Width:     180,
			Hidden:    true,
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
			Accessors: "spec.capacity.storage",
			Alignment: types.CellAlignmentLeft,
			Width:     100,
		},
		{
			ID:        "accessModes",
			Header:    "Access Modes",
			Accessors: "$.spec.accessModes[*]",
			Alignment: types.CellAlignmentLeft,
			Width:     150,
			Hidden:    true,
		},
		{
			ID:        "volumeMode",
			Header:    "Volume Mode",
			Accessors: "spec.volumeMode",
			Alignment: types.CellAlignmentLeft,
			Width:     120,
			Hidden:    true,
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
