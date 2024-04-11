//nolint:gochecknoglobals,gomnd // column definitions are global
package corev1

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var ComponentStatusDef = types.ResourceDefinition{
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
			ID:        "healthy",
			Header:    "Healthy",
			Accessors: "$.conditions[?(@.type=='Healthy')].status",
			Width:     100,
			ColorMap: map[string]string{
				"True":  "success",
				"False": "danger",
			},
		},
	},
}
