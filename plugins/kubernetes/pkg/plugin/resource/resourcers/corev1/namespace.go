//nolint:gochecknoglobals,gomnd // column definitions are global
package corev1

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var NamespaceDef = types.ResourceDefinition{
	IDAccessor:       "metadata.name",
	MemoizerAccessor: "metadata.uid,metadata.resourceVersion",
	ColumnDefs: []types.ColumnDef{
		{
			ID:        "name",
			Header:    "Name",
			Accessors: "metadata.name",
			Alignment: types.CellAlignmentLeft,
		},
		{
			ID:        "phase",
			Header:    "Phase",
			Accessors: "status.phase",
			Width:     100,
			ColorMap: map[string]string{
				"Active":      "success",
				"Terminating": "danger",
			},
		},
		{
			ID:        "age",
			Header:    "Age",
			Accessors: "metadata.creationTimestamp",
			Alignment: types.CellAlignmentLeft,
			Width:     100,
			Formatter: types.CellValueFormatterAge,
		},
	},
}
