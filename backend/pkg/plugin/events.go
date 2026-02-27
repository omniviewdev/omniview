package plugin

import (
	"context"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
)

// Plugin event constants.
const (
	// Lifecycle state changes.
	EventStateChange = "plugin/state_change"

	// Install flow.
	EventInstallStarted  = "plugin/install_started"
	EventInstallFinished = "plugin/install_finished"
	EventInstallError    = "plugin/install_error"

	// Dev install flow.
	EventDevInstallStart    = "plugin/dev_install_start"
	EventDevInstallError    = "plugin/dev_install_error"
	EventDevInstallComplete = "plugin/dev_install_complete"

	// Plugin reload.
	EventReloadStart    = "plugin/dev_reload_start"
	EventReloadError    = "plugin/dev_reload_error"
	EventReloadComplete = "plugin/dev_reload_complete"

	// Update.
	EventUpdateStarted  = "plugin/update_started"
	EventUpdateError    = "plugin/update_error"
	EventUpdateComplete = "plugin/update_complete"

	// Initialization.
	EventInitComplete = "plugin/init_complete"

	// Crash recovery.
	EventCrashRecoveryFailed = "plugin/crash_recovery_failed"
	EventRecovered           = "plugin/recovered"

	// State persistence.
	EventStateWriteError = "plugin/state_write_error"
)

// StateChangePayload is sent with EventStateChange.
type StateChangePayload struct {
	PluginID  string              `json:"pluginID"`
	From      lifecycle.PluginPhase `json:"from"`
	To        lifecycle.PluginPhase `json:"to"`
	Reason    string              `json:"reason"`
	Timestamp time.Time           `json:"timestamp"`
}

// eventEmitFn is the function used to emit events. It defaults to
// wails/v2/pkg/runtime.EventsEmit but can be replaced in tests to avoid
// the log.Fatal that Wails issues for non-Wails contexts.
var eventEmitFn = runtime.EventsEmit

// emitEvent is a convenience wrapper around Wails event emission.
func emitEvent(ctx context.Context, event string, data ...interface{}) {
	if ctx == nil {
		return
	}
	eventEmitFn(ctx, event, data...)
}

// emitStateChange emits a state change event to the frontend.
func emitStateChange(ctx context.Context, pluginID string, t lifecycle.Transition) {
	emitEvent(ctx, EventStateChange, StateChangePayload{
		PluginID:  pluginID,
		From:      t.From,
		To:        t.To,
		Reason:    t.Reason,
		Timestamp: t.Timestamp,
	})
}
