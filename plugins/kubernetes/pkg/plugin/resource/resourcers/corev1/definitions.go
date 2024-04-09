//nolint:gochecknoglobals,gomnd // column definitions are global
package corev1

import "github.com/omniviewdev/plugin-sdk/pkg/resource/types"

var NodeDef = types.ResourceDefinition{
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
			ID:        "architecture",
			Header:    "Architecture",
			Accessors: "status.nodeInfo.architecture",
			Alignment: types.CellAlignmentLeft,
			Width:     120,
		},
		{
			ID:        "os",
			Header:    "OS",
			Accessors: "status.nodeInfo.operatingSystem",
			Alignment: types.CellAlignmentLeft,
			Hidden:    true,
			Width:     80,
		},
		{
			ID:        "kernelVersion",
			Header:    "Kernel Version",
			Accessors: "status.nodeInfo.kernelVersion",
			Alignment: types.CellAlignmentLeft,
			Hidden:    true,
		},
		{
			ID:        "osImage",
			Header:    "OS Image",
			Accessors: "status.nodeInfo.osImage",
			Alignment: types.CellAlignmentLeft,
		},
		{
			ID:        "containerRuntime",
			Header:    "Container Runtime",
			Accessors: "status.nodeInfo.containerRuntimeVersion",
			Alignment: types.CellAlignmentLeft,
			Hidden:    true,
		},
		{
			ID:        "kubeletVersion",
			Header:    "Kubelet Version",
			Accessors: "status.nodeInfo.kubeletVersion",
			Alignment: types.CellAlignmentLeft,
		},
		{
			ID:        "cpuCapacity",
			Header:    "CPU",
			Accessors: "status.capacity.cpu",
			Alignment: types.CellAlignmentLeft,
			Hidden:    true,
			Width:     80,
		},
		{
			ID:        "memoryCapacity",
			Header:    "Memory",
			Accessors: "status.capacity.memory",
			Alignment: types.CellAlignmentLeft,
			Formatter: types.CellValueFormatterBytes,
			Hidden:    true,
			Width:     120,
		},
		{
			ID:        "podsCapacity",
			Header:    "Pods",
			Accessors: "status.capacity.pods",
			Alignment: types.CellAlignmentLeft,
			Hidden:    true,
			Width:     80,
		},
		{
			ID:        "ephemeralStorageCapacity",
			Header:    "Ephemeral Storage",
			Accessors: "status.capacity.ephemeral-storage",
			Alignment: types.CellAlignmentLeft,
			Formatter: types.CellValueFormatterBytes,
			Hidden:    true,
			Width:     120,
		},
		{
			ID:        "age",
			Header:    "Age",
			Accessors: "metadata.creationTimestamp",
			Alignment: types.CellAlignmentLeft,
			Width:     120,
			Formatter: types.CellValueFormatterAge,
		},
	},
}
