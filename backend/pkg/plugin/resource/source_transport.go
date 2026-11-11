package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

// SetFatalTransportCallback reports a retired backend to its lifecycle owner.
func (c *controller) SetFatalTransportCallback(callback func(string, plugintypes.PluginBackend, func(func()) bool)) {
	c.pluginsMu.Lock()
	c.onFatalTransport = callback
	c.pluginsMu.Unlock()
}

// retireFatalSourceTransport retires only the provider that owned the failed
// transport. Call it without a session lock and outside the receive goroutine:
// source invalidation can wait for that goroutine to exit.
func (c *controller) retireFatalSourceTransport(pluginID string, expected *pluginState, cause error) bool {
	if expected == nil {
		return false
	}
	c.lifecycleMu.Lock()
	c.pluginsMu.Lock()
	if c.plugins[pluginID] != expected || expected.provider == nil {
		c.pluginsMu.Unlock()
		c.lifecycleMu.Unlock()
		return false
	}
	provider := expected.provider
	backend, callback := expected.backend, c.onFatalTransport
	expected.provider = nil
	c.schemas.DropPlugin(pluginID)
	c.pluginsMu.Unlock()

	expected.cancel()
	c.retireMetadata(pluginID, expected)
	c.actions.stopPlugin(pluginID)
	c.sources.invalidate(pluginID, "")
	c.clearAutoConnectAttempts(pluginID)
	c.lifecycleMu.Unlock()

	c.logger.Errorw(
		context.Background(),
		"fatal source transport retired; provider unavailable",
		"pluginID",
		pluginID,
		"errorClass",
		telemetryutil.ErrorClass(cause),
	)
	if callback != nil && backend != nil {
		callback(pluginID, backend, func(commit func()) bool {
			c.lifecycleMu.Lock()
			defer c.lifecycleMu.Unlock()
			c.pluginsMu.RLock()
			owned := c.plugins[pluginID] == expected && expected.provider == nil
			c.pluginsMu.RUnlock()
			if !owned {
				return false
			}
			commit()
			return true
		})
	}
	if err := expected.closeSource(provider); err != nil {
		c.logger.Warnw(
			context.Background(),
			"fatal resource source teardown failed",
			"pluginID",
			pluginID,
			"errorClass",
			telemetryutil.ErrorClass(err),
		)
	}
	c.notifyInventory()
	return true
}
