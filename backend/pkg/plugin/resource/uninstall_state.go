package resource

import (
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

var _ plugintypes.PluginUninstallObserver = (*controller)(nil)

// OnPluginUninstalled releases the state bound to the removed store directory:
// the authority resolver and the store handle it holds. A plugin installed
// again under the same ID then starts from its new, empty store, rather than
// writing the old bindings through a handle on the deleted directory. Everything
// else this controller keeps for the plugin went when the plugin stopped, and
// the store files went with the plugin directory.
func (c *controller) OnPluginUninstalled(pluginID string) error {
	c.finite.mu.Lock()
	delete(c.finite.authorities, pluginID)
	c.finite.mu.Unlock()
	return nil
}
