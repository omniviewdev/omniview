package categories

import "github.com/omniviewdev/plugin-sdk/settings"

// Definitions is the single category source for startup and configured-value UI reads.
// The host initializer copies these definitions before registering them.
func Definitions(isDev bool) []settings.Category {
	telemetry := Telemetry
	telemetry.Settings = buildTelemetrySettings(isDev)
	return []settings.Category{General, Appearance, Terminal, Editor, Developer, telemetry}
}

// RestartRequiredIDs is host metadata, not part of the plugin settings contract.
func RestartRequiredIDs() []string {
	return []string{"developer.pprof_enabled", "developer.pprof_port"}
}
