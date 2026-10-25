package resource

import (
	"context"
	"encoding/json"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// Service is the Wails-bound public API for resource operations.
// Every method prefixes with pluginID to route to the correct plugin's ResourceProvider.
type Service interface {
	ListPlugins(ctx context.Context) ([]string, error)
	HasPlugin(ctx context.Context, pluginID string) (bool, error)

	// CRUD
	Get(ctx context.Context, pluginID, connectionID, key string, input resource.GetInput) (*resource.GetResult, error)
	List(ctx context.Context, pluginID, connectionID, key string, input resource.ListInput) (*resource.ListResult, error)
	Find(ctx context.Context, pluginID, connectionID, key string, input resource.FindInput) (*resource.FindResult, error)
	Create(ctx context.Context, pluginID, connectionID, key string, input resource.CreateInput) (*resource.CreateResult, error)
	Update(ctx context.Context, pluginID, connectionID, key string, input resource.UpdateInput) (*resource.UpdateResult, error)
	Delete(ctx context.Context, pluginID, connectionID, key string, input resource.DeleteInput) (*resource.DeleteResult, error)

	// Connection lifecycle
	StartConnection(ctx context.Context, pluginID, connectionID string) (types.ConnectionStatus, error)
	StopConnection(ctx context.Context, pluginID, connectionID string) (types.Connection, error)
	CheckConnection(ctx context.Context, pluginID, connectionID string) (types.ConnectionStatus, error)
	LoadConnections(ctx context.Context, pluginID string) ([]types.Connection, error)
	ListConnections(ctx context.Context, pluginID string) ([]types.Connection, error)
	ListAllConnections(ctx context.Context) (map[string][]types.Connection, error)
	GetAllConnectionStates(ctx context.Context) (map[string][]ConnectionState, error)
	GetConnection(ctx context.Context, pluginID, connectionID string) (types.Connection, error)
	GetConnectionNamespaces(ctx context.Context, pluginID, connectionID string) ([]string, error)
	AddConnection(ctx context.Context, pluginID string, connection types.Connection) error
	UpdateConnection(ctx context.Context, pluginID string, connection types.Connection) (types.Connection, error)
	RemoveConnection(ctx context.Context, pluginID, connectionID string) error

	// Watch lifecycle
	StartConnectionWatch(ctx context.Context, pluginID, connectionID string) error
	StopConnectionWatch(ctx context.Context, pluginID, connectionID string) error
	GetWatchState(ctx context.Context, pluginID, connectionID string) (*resource.WatchConnectionSummary, error)
	EnsureResourceWatch(ctx context.Context, pluginID, connectionID, resourceKey string) error
	StopResourceWatch(ctx context.Context, pluginID, connectionID, resourceKey string) error
	RestartResourceWatch(ctx context.Context, pluginID, connectionID, resourceKey string) error
	IsResourceWatchRunning(ctx context.Context, pluginID, connectionID, resourceKey string) (bool, error)

	// Subscriptions (engine-side, ref-counted)
	SubscribeResource(ctx context.Context, pluginID, connectionID, resourceKey string) error
	UnsubscribeResource(ctx context.Context, pluginID, connectionID, resourceKey string) error

	// Type metadata
	GetResourceGroups(ctx context.Context, pluginID, connectionID string) (map[string]resource.ResourceGroup, error)
	GetResourceGroup(ctx context.Context, pluginID, groupID string) (resource.ResourceGroup, error)
	GetResourceTypes(ctx context.Context, pluginID, connectionID string) (map[string]resource.ResourceMeta, error)
	GetResourceType(ctx context.Context, pluginID, typeID string) (*resource.ResourceMeta, error)
	HasResourceType(ctx context.Context, pluginID, typeID string) (bool, error)
	GetResourceDefinition(ctx context.Context, pluginID, typeID string) (resource.ResourceDefinition, error)
	GetResourceCapabilities(ctx context.Context, pluginID, key string) (*resource.ResourceCapabilities, error)
	GetFilterFields(ctx context.Context, pluginID, connectionID, key string) ([]resource.FilterField, error)
	GetResourceSchema(ctx context.Context, pluginID, connectionID, key string) (json.RawMessage, error)

	// Actions
	GetActions(ctx context.Context, pluginID, connectionID, key string) ([]resource.ActionDescriptor, error)
	ExecuteAction(ctx context.Context, pluginID, connectionID, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error)
	StreamAction(ctx context.Context, pluginID, connectionID, key, actionID string, input resource.ActionInput) (string, error)
	AttachStreamAction(ctx context.Context, handleID string) (ActionSnapshot, error)
	CancelStreamAction(ctx context.Context, handleID string) error

	// Editor schemas
	GetEditorSchemas(ctx context.Context, pluginID, connectionID string) ([]resource.EditorSchema, error)

	// Relationships
	GetRelationships(ctx context.Context, pluginID, key string) ([]resource.RelationshipDescriptor, error)
	ResolveRelationships(ctx context.Context, pluginID, connectionID, key, id, namespace string) ([]resource.ResolvedRelationship, error)

	// Health
	GetHealth(ctx context.Context, pluginID, connectionID, key string, data json.RawMessage) (*resource.ResourceHealth, error)
	GetResourceEvents(ctx context.Context, pluginID, connectionID, key, id, namespace string, limit int32) ([]resource.ResourceEvent, error)
}
