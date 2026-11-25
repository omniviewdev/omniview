package resource

import (
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ConnectionState is the full state snapshot for a single connection,
// combining metadata, lifecycle, and source state. Returned by GetAllConnectionStates
// so the frontend can hydrate everything in a single call.
type ConnectionState struct {
	// Connection metadata (name, avatar, labels, etc.)
	Connection types.Connection `json:"connection"`

	// Registered native-client state, not network health. UNKNOWN is not stopped.
	// A connection whose last start failed reads FAILED here, whatever else the provider reports
	// for it, unless the provider reports it CONNECTED.
	Readiness types.ConnectionStatusCode `json:"readiness"`

	// Why the connection is not ready. For a connection whose last start failed it is the error of
	// that start, in the public form every provider error is given to a user (the class's own words,
	// and the provider's sentence only after it was cleaned); for a start that ended without an error
	// and answered a failure status (UNAUTHORIZED, FORBIDDEN, FAILED and the like) it is the error of
	// that status's class alone, none of the status's own text. It is kept until a later start
	// answers without failing, the connection is stopped, or it leaves the plugin's list. Otherwise
	// it is why the provider could not report the registered state.
	ReadinessError *apperror.AppError `json:"readinessError,omitempty"`

	// Per-resource source states (resource key → source state).
	Resources map[string]string `json:"resources"`

	// Observed cache membership, not source totals.
	ResourceCounts map[string]sdkresource.Count `json:"resourceCounts"`

	// Aggregate counts computed server-side.
	TotalResources int `json:"totalResources"`
	SyncedCount    int `json:"syncedCount"`
	ErrorCount     int `json:"errorCount"`

	// ISO 8601 timestamp of the last successful sync, or empty if never synced.
	// String instead of time.Time for Wails serialization compatibility.
	LastSyncTime string `json:"lastSyncTime,omitempty"`
}
