package types

import "errors"

// ErrResourceSkipped is returned by InformerHandle.RegisterResource when the
// resource should not be watched (e.g. ephemeral request-based resources).
// The InformerManager will mark such resources as Cancelled instead of Pending.
var ErrResourceSkipped = errors.New("resource skipped")

// InformerSyncPolicy controls when an informer starts for a resource type.
type InformerSyncPolicy int

const (
	// SyncOnConnect starts the informer when the connection opens (default).
	SyncOnConnect InformerSyncPolicy = iota
	// SyncOnFirstQuery starts the informer on the first Get/List/Find for this resource.
	SyncOnFirstQuery
	// SyncNever never starts an informer; always uses direct queries.
	SyncNever
)

// InformerResourceState represents the sync state of a single resource type's informer.
type InformerResourceState int

const (
	// InformerStatePending means the resource is registered but informer not started.
	InformerStatePending InformerResourceState = iota
	// InformerStateSyncing means the informer is running but cache not yet populated.
	InformerStateSyncing
	// InformerStateSynced means the cache is fully populated.
	InformerStateSynced
	// InformerStateError means an error occurred during sync.
	InformerStateError
	// InformerStateCancelled means the informer was cancelled by context or user.
	InformerStateCancelled
)

// InformerStateEvent is emitted when a resource's informer state changes.
type InformerStateEvent struct {
	PluginID      string                  `json:"pluginId"`
	Connection    string                  `json:"connection"`
	ResourceKey   string                  `json:"resourceKey"`
	State         InformerResourceState   `json:"state"`
	ResourceCount int                     `json:"resourceCount"`
	TotalCount    int                     `json:"totalCount"` // -1 if unknown
	Error         *ResourceOperationError `json:"error,omitempty"`
}

// InformerConnectionSummary provides an aggregate view of all informer states for a connection.
type InformerConnectionSummary struct {
	Connection     string                              `json:"connection"`
	Resources      map[string]InformerResourceState     `json:"resources"`
	ResourceCounts map[string]int                       `json:"resourceCounts"`
	TotalResources int                                  `json:"totalResources"`
	SyncedCount    int                                  `json:"syncedCount"`
	ErrorCount     int                                  `json:"errorCount"`
}
