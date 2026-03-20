package plugin

import (
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
)

func init() {
	application.RegisterEvent[StateChangePayload](EventStateChange)
	application.RegisterEvent[application.Void](EventInstallStarted)
	application.RegisterEvent[application.Void](EventInstallFinished)
	application.RegisterEvent[application.Void](EventInstallError)
	application.RegisterEvent[application.Void](EventDevInstallStart)
	application.RegisterEvent[application.Void](EventDevInstallError)
	application.RegisterEvent[application.Void](EventDevInstallComplete)
	application.RegisterEvent[application.Void](EventReloadStart)
	application.RegisterEvent[application.Void](EventReloadError)
	application.RegisterEvent[application.Void](EventReloadComplete)
	application.RegisterEvent[application.Void](EventUpdateStarted)
	application.RegisterEvent[application.Void](EventUpdateError)
	application.RegisterEvent[application.Void](EventUpdateComplete)
	application.RegisterEvent[application.Void](EventInitComplete)
	application.RegisterEvent[application.Void](EventCrashRecoveryFailed)
	application.RegisterEvent[application.Void](EventRecovered)
	application.RegisterEvent[application.Void](EventStateWriteError)
	application.RegisterEvent[DeprecatedProtocolPayload](EventDeprecatedProtocol)
}

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

	// Protocol version.
	EventDeprecatedProtocol = "plugin/deprecated_protocol"
)

// StateChangePayload is sent with EventStateChange.
type StateChangePayload struct {
	PluginID  string              `json:"pluginID"`
	From      lifecycle.PluginPhase `json:"from"`
	To        lifecycle.PluginPhase `json:"to"`
	Reason    string              `json:"reason"`
	Timestamp time.Time           `json:"timestamp"`
}

// DeprecatedProtocolPayload is sent with EventDeprecatedProtocol.
type DeprecatedProtocolPayload struct {
	PluginID       string `json:"pluginID"`
	Version        int    `json:"version"`
	CurrentVersion int    `json:"currentVersion"`
}

// emitStateChange emits a state change event to the frontend.
func emitStateChange(emitter resource.EventEmitter, pluginID string, t lifecycle.Transition) {
	if emitter == nil {
		return
	}
	emitter.Emit(EventStateChange, StateChangePayload{
		PluginID:  pluginID,
		From:      t.From,
		To:        t.To,
		Reason:    t.Reason,
		Timestamp: t.Timestamp,
	})
}
