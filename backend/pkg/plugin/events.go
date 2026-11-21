package plugin

import (
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

func init() {
	application.RegisterEvent[StateChangePayload](EventStateChange)
	application.RegisterEvent[UnloadedPayload](EventUnloaded)
	application.RegisterEvent[*config.PluginMeta](EventInstallStarted)
	application.RegisterEvent[*config.PluginMeta](EventInstallFinished)
	application.RegisterEvent[*config.PluginMeta](EventInstallError)
	application.RegisterEvent[*config.PluginMeta](EventDevInstallStart)
	application.RegisterEvent[*config.PluginMeta](EventDevInstallError)
	application.RegisterEvent[*config.PluginMeta](EventDevInstallComplete)
	application.RegisterEvent[*config.PluginMeta](EventReloadStart)
	application.RegisterEvent[[]any](EventReloadError) // (meta *config.PluginMeta, err string)
	application.RegisterEvent[*config.PluginMeta](EventReloadComplete)
	application.RegisterEvent[UpdatePayload](EventUpdateStarted)
	application.RegisterEvent[UpdateErrorPayload](EventUpdateError)
	application.RegisterEvent[UpdatePayload](EventUpdateComplete)
	application.RegisterEvent[application.Void](EventInitComplete)
	application.RegisterEvent[application.Void](EventInventoryChanged)
	application.RegisterEvent[PluginErrorPayload](EventCrash)
	application.RegisterEvent[PluginErrorPayload](EventCrashRecoveryFailed)
	application.RegisterEvent[PluginErrorPayload](EventRecovered)
	application.RegisterEvent[StateWriteErrorPayload](EventStateWriteError)
	application.RegisterEvent[DeprecatedProtocolPayload](EventDeprecatedProtocol)
	application.RegisterEvent[pluginlog.LogEntry](EventProcessLog)
}

// Plugin event constants.
const (
	// Lifecycle state changes.
	EventStateChange = "plugin/state_change"

	// A plugin that was serving the window stopped: its process crashed, it is being reloaded, it was uninstalled or it was turned off. The window drops the interface it drew from the plugin
	// and learns that the plugin runs again from EventStateChange (To == Running). The payload is the plugin's id and one of four codes (UnloadCause), never text.
	EventUnloaded = "plugin/unloaded"

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

	// Durable installed-inventory changes.
	EventInventoryChanged = "plugin/inventory_changed"

	// Crash recovery.
	EventCrash               = "plugin/crash"
	EventCrashRecoveryFailed = "plugin/crash_recovery_failed"
	EventRecovered           = "plugin/recovered"

	// State persistence.
	EventStateWriteError = "plugin/state_write_error"

	// Protocol version.
	EventDeprecatedProtocol = "plugin/deprecated_protocol"

	// Process logging.
	EventProcessLog = "plugin/process/log"
)

// StateChangePayload is sent with EventStateChange.
type StateChangePayload struct {
	PluginID  string                `json:"pluginID"`
	From      lifecycle.PluginPhase `json:"from"`
	To        lifecycle.PluginPhase `json:"to"`
	Reason    string                `json:"reason"`
	Timestamp time.Time             `json:"timestamp"`
}

// UnloadCause says why a plugin stopped serving the window. It is one of the four words below and nothing else: the window words each for the person itself, so no text of the plugin, of
// its process or of an error ever travels with the event (docs/development-plugin-lifecycle.md, "What the window is told when a plugin stops").
type UnloadCause string

const (
	// UnloadCrashed: the plugin's process ended or stopped answering, and the host is recovering it. Told for every crash, not for the first of a cycle only (EventCrash is).
	UnloadCrashed UnloadCause = "crashed"
	// UnloadReloaded: the host stopped the plugin to start it again: a reload (a rebuild of a development plugin, a retry), an update or a reinstall, or the restart that recovers a crash.
	UnloadReloaded UnloadCause = "reloaded"
	// UnloadUninstalled: the plugin was removed.
	UnloadUninstalled UnloadCause = "uninstalled"
	// UnloadDisabled: the person turned the plugin off.
	UnloadDisabled UnloadCause = "disabled"
)

// UnloadedPayload is sent with EventUnloaded: the plugin and why it stopped. It has no other member, and a member that carried text would put the plugin's words in the window's hands.
type UnloadedPayload struct {
	PluginID string      `json:"pluginID"`
	Cause    UnloadCause `json:"cause"`
}

// PluginErrorPayload is sent with EventCrash, EventCrashRecoveryFailed and
// EventRecovered (which leaves Error empty).
type PluginErrorPayload struct {
	PluginID string `json:"pluginID"`
	Error    string `json:"error,omitempty"`
}

// StateWriteErrorPayload is sent with EventStateWriteError.
type StateWriteErrorPayload struct {
	PluginID string `json:"pluginID"`
	Detail   string `json:"detail"`
}

// UpdatePayload is sent with EventUpdateStarted and EventUpdateComplete.
type UpdatePayload struct {
	PluginID string `json:"pluginID"`
	Version  string `json:"version"`
}

// UpdateErrorPayload is sent with EventUpdateError.
type UpdateErrorPayload struct {
	PluginID string `json:"pluginID"`
	Error    string `json:"error"`
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

// emitUnloaded tells the window that a plugin it may hold an interface of stopped serving it, and why.
func emitUnloaded(emitter resource.EventEmitter, pluginID string, cause UnloadCause) {
	if emitter == nil {
		return
	}
	emitter.Emit(EventUnloaded, UnloadedPayload{PluginID: pluginID, Cause: cause})
}
