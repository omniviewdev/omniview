package settings

import (
	"context"
	"errors"

	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

var _ internaltypes.PluginUninstallObserver = (*controller)(nil)

// OnPluginUninstalled erases the credential-class values persisted for a plugin
// whose installation is disposed of. A value is credential-class when the
// plugin's last known schema declares its setting Sensitive or a Password, or
// declares no setting for it: unknown values fail closed, as RedactSettingValues
// and Snapshot treat them. The values of declared, non-sensitive settings stay in
// the store, and a plugin installed again under the same ID finds them.
//
// The last known schema is the one learned in this session, else the one the host
// remembered from the plugin's last start (RememberPluginSchema), which is what
// classifies the values of a plugin that did not start in this session: it was
// disabled, it failed to start, or the host restarted. A plugin with neither,
// installed before the host remembered schemas and not started since, leaves
// nothing to tell its values apart, so all of them are erased, and the log says so.
//
// The in-memory copies of the plugin's values go even when the store write
// fails, and the store write error is returned: the manager keeps the uninstall
// pending and runs the hook again, which classifies by the remembered schema
// when the session's is gone.
func (c *controller) OnPluginUninstalled(pluginID string) error {
	ctx := context.Background()
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginUninstalled")

	c.mu.RLock()
	schema := c.schemaCache[pluginID]
	c.mu.RUnlock()

	var eraseErr error
	if c.store != nil {
		var current *settingsstore.DeclaredSettings
		if schema != nil {
			current = &settingsstore.DeclaredSettings{Ordinary: ordinarySettingIDs(schema)}
		}
		var result settingsstore.EraseResult
		result, eraseErr = c.store.ErasePluginSettings(pluginID, current)
		if eraseErr == nil {
			logErase(ctx, logger, result)
		}
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

// logErase records what an erase did: counts and the schema that classified the
// values, never an ID or a value. Erasing every value because no schema is known
// is a warning: a user may lose preferences they expected to keep.
func logErase(ctx context.Context, logger logging.Logger, result settingsstore.EraseResult) {
	switch {
	case result.Basis == settingsstore.EraseBasisNone && result.Erased > 0:
		logger.Warnw(ctx, "plugin uninstalled; no known settings schema, so every stored setting value was erased",
			"basis", string(result.Basis), "erased", result.Erased)
	case result.Erased == 0 && result.Kept == 0:
		logger.Debugw(ctx, "plugin uninstalled; it had no stored setting values to erase", "unreadable", result.Unreadable)
	default:
		logger.Infow(ctx, "plugin uninstalled; credential-class setting values erased",
			"basis", string(result.Basis), "erased", result.Erased, "kept", result.Kept)
	}
}
