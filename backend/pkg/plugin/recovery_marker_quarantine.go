package plugin

import (
	"fmt"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

// quarantineBadRecoveryMarker moves a recovery marker that cannot be read or
// validated next to its original name, so one bad marker does not stop every
// plugin from loading. The marker is kept in place, with its mode, because it
// is evidence. id names the plugin it claimed to belong to; that plugin stays
// held back this run and shows the notice as its load error. An error means the
// marker could not be moved and the caller must keep failing startup.
func (pm *pluginManager) quarantineBadRecoveryMarker(markerName, id string, cause error) error {
	quarantine, err := pm.stateRoot.Quarantine(markerName)
	if err != nil {
		return fmt.Errorf("quarantine recovery marker %s: %w", markerName, err)
	}
	pm.logger.Errorw(pm.ctx, "plugin recovery marker unreadable; moved aside, plugin held back this session",
		"marker", markerName, "quarantine", quarantine, "pluginId", id,
		"errorClass", telemetryutil.ErrorClass(cause), "errorType", fmt.Sprintf("%T", cause))

	if id == "" {
		return nil
	}
	states, readErr := pm.readPluginStateJSON()
	if readErr != nil {
		return nil
	}
	for _, state := range states {
		if state.ID != id {
			continue
		}
		pm.recordsMu.Lock()
		defer pm.recordsMu.Unlock()
		if pm.records[id] != nil {
			return nil
		}
		record := plugintypes.NewPluginRecord(id, state.Metadata, lifecycle.PhaseFailed)
		record.Enabled, record.DevMode, record.DevPath = state.Enabled, state.DevMode, state.DevPath
		record.ErrorCount, record.InstalledAt = state.ErrorCount, state.InstalledAt
		record.ReleaseChannel = state.ReleaseChannel
		record.LastError = fmt.Sprintf("recovery marker %s could not be read and was moved aside to %s; the plugin is not loaded this session",
			pm.stateRoot.ResolvePath(markerName), pm.stateRoot.ResolvePath(quarantine))
		pm.records[id] = record
		return nil
	}
	return nil
}
