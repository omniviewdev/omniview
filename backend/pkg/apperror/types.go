package apperror

// Error type URI constants used across Go and TypeScript.
const (
	// Plugin errors
	TypePluginNotFound     = "omniview:plugin/not-found"
	TypePluginNotLoaded    = "omniview:plugin/not-loaded"
	TypePluginAlreadyLoaded = "omniview:plugin/already-loaded"
	TypePluginInstallFailed = "omniview:plugin/install-failed"
	TypePluginLoadFailed   = "omniview:plugin/load-failed"
	TypePluginBuildFailed  = "omniview:plugin/build-failed"

	// Settings errors
	TypeSettingsMissingConfig = "omniview:settings/missing-config"
	TypeSettingsInvalidConfig = "omniview:settings/invalid-config"

	// Resource errors
	TypeResourceNotFound    = "omniview:resource/not-found"
	TypeResourceForbidden   = "omniview:resource/forbidden"
	TypeResourceUnauthorized = "omniview:resource/unauthorized"
	TypeResourceConflict    = "omniview:resource/conflict"
	TypeResourceTimeout     = "omniview:resource/timeout"

	// Connection errors
	TypeConnectionNotFound = "omniview:connection/not-found"
	TypeConnectionFailed   = "omniview:connection/failed"

	// Session errors
	TypeSessionNotFound = "omniview:session/not-found"
	TypeSessionFailed   = "omniview:session/failed"

	// General errors
	TypeCancelled      = "omniview:cancelled"
	TypeInternal       = "omniview:internal"
	TypeValidation     = "omniview:validation"
	TypeNotImplemented = "omniview:not-implemented"
)
