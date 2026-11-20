package settings

import (
	"context"
	"errors"

	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

var _ internaltypes.PluginUninstallObserver = (*controller)(nil)

// OnPluginUninstalled erases the credential-class values persisted for a plugin
// whose uninstall is durable. A value is credential-class when the plugin's last
// known schema declares its setting Sensitive or a Password, or declares no
// setting for it: unknown values fail closed, as RedactSettingValues and
// Snapshot treat them. The values of declared, non-sensitive settings stay in
// the store. A plugin that never reported a schema in this session leaves
// nothing to tell its values apart, so all of them are erased.
//
// The in-memory copies of the plugin's values go even when the store write
// fails, and the store write error is returned.
func (c *controller) OnPluginUninstalled(pluginID string) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginUninstalled")

	c.mu.RLock()
	schema := c.schemaCache[pluginID]
	c.mu.RUnlock()

	var eraseErr error
	if c.store != nil {
		eraseErr = c.store.ErasePluginSettings(pluginID, func(id string) bool {
			return settingIsSecret(schema, id)
		})
	}

	// baseline holds every merged value, credentials included.
	c.failPendingChanges(pluginID, errors.New("plugin uninstalled"))
	c.mu.Lock()
	delete(c.hydrated, pluginID)
	delete(c.clients, pluginID)
	delete(c.schemaCache, pluginID)
	delete(c.baseline, pluginID)
	c.mu.Unlock()

	return eraseErr
}
