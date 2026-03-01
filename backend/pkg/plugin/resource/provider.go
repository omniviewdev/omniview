package resource

import (
	"context"
	"encoding/json"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ResourceProvider is the engine's version-independent interface for resource plugins.
// The controller and frontend bindings use this interface exclusively.
// Adapters translate between versioned SDK types and this interface.
//
// For v1, method signatures use SDK v1 types directly (they're identical).
// When v2 introduces breaking type changes, canonical types diverge here.
type ResourceProvider interface {
	// CRUD
	Get(ctx context.Context, key string, input resource.GetInput) (*resource.GetResult, error)
	List(ctx context.Context, key string, input resource.ListInput) (*resource.ListResult, error)
	Find(ctx context.Context, key string, input resource.FindInput) (*resource.FindResult, error)
	Create(ctx context.Context, key string, input resource.CreateInput) (*resource.CreateResult, error)
	Update(ctx context.Context, key string, input resource.UpdateInput) (*resource.UpdateResult, error)
	Delete(ctx context.Context, key string, input resource.DeleteInput) (*resource.DeleteResult, error)

	// Connection lifecycle
	StartConnection(ctx context.Context, connectionID string) (types.ConnectionStatus, error)
	StopConnection(ctx context.Context, connectionID string) (types.Connection, error)
	LoadConnections(ctx context.Context) ([]types.Connection, error)
	ListConnections(ctx context.Context) ([]types.Connection, error)
	GetConnection(ctx context.Context, id string) (types.Connection, error)
	GetConnectionNamespaces(ctx context.Context, id string) ([]string, error)
	UpdateConnection(ctx context.Context, connection types.Connection) (types.Connection, error)
	DeleteConnection(ctx context.Context, id string) error
	WatchConnections(ctx context.Context, stream chan<- []types.Connection) error

	// Watch
	StartConnectionWatch(ctx context.Context, connectionID string) error
	StopConnectionWatch(ctx context.Context, connectionID string) error
	HasWatch(ctx context.Context, connectionID string) bool
	GetWatchState(ctx context.Context, connectionID string) (*resource.WatchConnectionSummary, error)
	ListenForEvents(ctx context.Context, sink resource.WatchEventSink) error
	EnsureResourceWatch(ctx context.Context, connectionID, resourceKey string) error
	StopResourceWatch(ctx context.Context, connectionID, resourceKey string) error
	RestartResourceWatch(ctx context.Context, connectionID, resourceKey string) error
	IsResourceWatchRunning(ctx context.Context, connectionID, resourceKey string) (bool, error)

	// Type metadata
	GetResourceGroups(ctx context.Context, connectionID string) map[string]resource.ResourceGroup
	GetResourceGroup(ctx context.Context, id string) (resource.ResourceGroup, error)
	GetResourceTypes(ctx context.Context, connectionID string) map[string]resource.ResourceMeta
	GetResourceType(ctx context.Context, id string) (*resource.ResourceMeta, error)
	HasResourceType(ctx context.Context, id string) bool
	GetResourceDefinition(ctx context.Context, id string) (resource.ResourceDefinition, error)
	GetResourceCapabilities(ctx context.Context, resourceKey string) (*resource.ResourceCapabilities, error)
	GetResourceSchema(ctx context.Context, connectionID, resourceKey string) (json.RawMessage, error)
	GetFilterFields(ctx context.Context, connectionID, resourceKey string) ([]resource.FilterField, error)

	// Actions
	GetActions(ctx context.Context, key string) ([]resource.ActionDescriptor, error)
	ExecuteAction(ctx context.Context, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error)
	StreamAction(ctx context.Context, key, actionID string, input resource.ActionInput, stream chan<- resource.ActionEvent) error

	// Editor schemas
	GetEditorSchemas(ctx context.Context, connectionID string) ([]resource.EditorSchema, error)

	// Relationships
	GetRelationships(ctx context.Context, resourceKey string) ([]resource.RelationshipDescriptor, error)
	ResolveRelationships(ctx context.Context, connectionID, resourceKey, id, namespace string) ([]resource.ResolvedRelationship, error)

	// Health
	GetHealth(ctx context.Context, connectionID, resourceKey string, data json.RawMessage) (*resource.ResourceHealth, error)
	GetResourceEvents(ctx context.Context, connectionID, resourceKey, id, namespace string, limit int32) ([]resource.ResourceEvent, error)
}
