package resource

import (
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ConnectionState is the full state snapshot for a single connection,
// combining metadata, lifecycle, and watch state. Returned by GetAllConnectionStates
// so the frontend can hydrate everything in a single call.
type ConnectionState struct {
	// Connection metadata (name, avatar, labels, etc.)
	Connection types.Connection `json:"connection"`

	// Registered native-client state, not network health. UNKNOWN is not stopped.
	Readiness      types.ConnectionStatusCode `json:"readiness"`
	ReadinessError *apperror.AppError         `json:"readinessError,omitempty"`

	// Per-resource watch states (resource key → WatchState enum).
	Resources map[string]sdkresource.WatchState `json:"resources"`

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
