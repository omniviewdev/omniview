package types

import (
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// PluginState holds data about an installed plugin that's written to the filesystem.
// This is used to track the state of the plugin between restarts of the plugin, especially
// for working with plugins that are in development mode.
type PluginState struct {
	Metadata config.PluginMeta
	ID       string
	DevPath  string
	Enabled  bool
	DevMode  bool
}

func NewPluginState(p types.Plugin) PluginState {
	return PluginState{
		ID:       p.ID,
		Enabled:  p.Enabled,
		DevMode:  p.DevMode,
		DevPath:  p.DevPath,
		Metadata: p.Metadata,
	}
}

func (ps *PluginState) ToPlugin() types.Plugin {
	return types.Plugin{
		ID:       ps.ID,
		Metadata: ps.Metadata,
		Enabled:  ps.Enabled,
		DevMode:  ps.DevMode,
		DevPath:  ps.DevPath,
	}
}
