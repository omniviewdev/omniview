package plugin

import (
	"errors"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/store"

	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

func (pm *pluginManager) writePluginState() error {
	// write the plugin state to disk, converting them to the plugin state
	var states []types.PluginState
	for _, p := range pm.plugins {
		states = append(states, types.NewPluginState(p))
	}

	return store.WriteToGlobalStore("plugin", states)
}

func (pm *pluginManager) readPluginState() ([]*types.PluginState, error) {
	// read the plugin state from disk, converting them to plugins
	var states []*types.PluginState
	err := store.ReadFromGlobalStore("plugin", &states)
	if err != nil {
		return nil, err
	}
	return states, nil
}

func upsertPluginState(p *pkgtypes.Plugin, s types.PluginState) error {
	if p.ID != s.ID {
		return errors.New("plugin ID mismatch")
	}

	// merge the plugin state with the plugin
	p.Enabled = s.Enabled
	p.DevMode = s.DevMode
	p.DevPath = s.DevPath
	// p.Metadata = s.Metadata

	return nil
}
