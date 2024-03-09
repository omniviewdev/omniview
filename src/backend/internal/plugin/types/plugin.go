package types

import (
	plugintypes "github.com/infraview/plugin/pkg/types"
)

type PluginType int

const (
	ExecutorPlugin PluginType = iota
	FilesystemPlugin
	LogPlugin
	MetricPlugin
	ReporterPlugin
	ResourcePlugin
)

func (pt PluginType) String() string {
	switch pt {
	case ExecutorPlugin:
		return "executor"
	case FilesystemPlugin:
		return "filesystem"
	case LogPlugin:
		return "log"
	case MetricPlugin:
		return "metric"
	case ReporterPlugin:
		return "reporter"
	case ResourcePlugin:
		return "resource"
	default:
		return "unknown"
	}
}

func (pt PluginType) MarshalText() ([]byte, error) {
	return []byte(pt.String()), nil
}

// Plugin represents a plugin that is installed and managed by the plugin manager.
type Plugin struct {
	ID           string
	Config       plugintypes.PluginConfig
	Capabilities []PluginType
}
