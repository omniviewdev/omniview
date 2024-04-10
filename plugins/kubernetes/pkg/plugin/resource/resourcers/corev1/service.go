//nolint:gochecknoglobals,gomnd // column definitions are global
package corev1

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var ServiceDef = types.ResourceDefinition{
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
			ID:        "type",
			Header:    "Type",
			Accessors: "spec.type",
			Alignment: types.CellAlignmentLeft,
			Width:     100,
		},
		{
			ID:        "clusterIP",
			Header:    "Cluster IP",
			Accessors: "spec.clusterIP",
			Alignment: types.CellAlignmentLeft,
			Width:     150,
		},
		{
			ID:        "externalIP",
			Header:    "External IP",
			Accessors: "spec.externalIPs",
			Alignment: types.CellAlignmentLeft,
			Width:     150,
		},
		{
			ID:        "internalTrafficPolicy",
			Header:    "Internal Traffic Policy",
			Accessors: "spec.internalTrafficPolicy",
			Alignment: types.CellAlignmentLeft,
			Width:     200,
			Hidden:    true,
		},
		{
			ID:        "ipFamily",
			Header:    "IP Families",
			Accessors: "$.spec.ipFamilies[*]",
			Width:     100,
			Hidden:    true,
		},
		{
			ID:        "ipFamilyPolicy",
			Header:    "IP Family Policy",
			Accessors: "spec.ipFamilyPolicy",
			Alignment: types.CellAlignmentLeft,
			Width:     130,
			Hidden:    true,
		},
		{
			ID:        "sessionAffinity",
			Header:    "Session Affinity",
			Accessors: "spec.sessionAffinity",
			Alignment: types.CellAlignmentLeft,
			Width:     100,
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
