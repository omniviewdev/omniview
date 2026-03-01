package resource

import (
	"encoding/json"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Service is the Wails-bound public API for resource operations.
// Every method prefixes with pluginID to route to the correct plugin's ResourceProvider.
type Service interface {
	ListPlugins() ([]string, error)

	// CRUD
	Get(pluginID, connectionID, key string, input resource.GetInput) (*resource.GetResult, error)
	List(pluginID, connectionID, key string, input resource.ListInput) (*resource.ListResult, error)
	Find(pluginID, connectionID, key string, input resource.FindInput) (*resource.FindResult, error)
	Create(pluginID, connectionID, key string, input resource.CreateInput) (*resource.CreateResult, error)
	Update(pluginID, connectionID, key string, input resource.UpdateInput) (*resource.UpdateResult, error)
	Delete(pluginID, connectionID, key string, input resource.DeleteInput) (*resource.DeleteResult, error)

	// Connection lifecycle
	StartConnection(pluginID, connectionID string) (types.ConnectionStatus, error)
	StopConnection(pluginID, connectionID string) (types.Connection, error)
	LoadConnections(pluginID string) ([]types.Connection, error)
	ListConnections(pluginID string) ([]types.Connection, error)
	ListAllConnections() (map[string][]types.Connection, error)
	GetConnection(pluginID, connectionID string) (types.Connection, error)
	GetConnectionNamespaces(pluginID, connectionID string) ([]string, error)
	AddConnection(pluginID string, connection types.Connection) error
	UpdateConnection(pluginID string, connection types.Connection) (types.Connection, error)
	RemoveConnection(pluginID, connectionID string) error

	// Watch lifecycle
	StartConnectionWatch(pluginID, connectionID string) error
	StopConnectionWatch(pluginID, connectionID string) error
	GetWatchState(pluginID, connectionID string) (*resource.WatchConnectionSummary, error)
	EnsureResourceWatch(pluginID, connectionID, resourceKey string) error
	StopResourceWatch(pluginID, connectionID, resourceKey string) error
	RestartResourceWatch(pluginID, connectionID, resourceKey string) error
	IsResourceWatchRunning(pluginID, connectionID, resourceKey string) (bool, error)

	// Subscriptions (engine-side, ref-counted)
	SubscribeResource(pluginID, connectionID, resourceKey string) error
	UnsubscribeResource(pluginID, connectionID, resourceKey string) error

	// Type metadata
	GetResourceGroups(pluginID, connectionID string) map[string]resource.ResourceGroup
	GetResourceGroup(pluginID, groupID string) (resource.ResourceGroup, error)
	GetResourceTypes(pluginID, connectionID string) map[string]resource.ResourceMeta
	GetResourceType(pluginID, typeID string) (*resource.ResourceMeta, error)
	HasResourceType(pluginID, typeID string) bool
	GetResourceDefinition(pluginID, typeID string) (resource.ResourceDefinition, error)
	GetResourceCapabilities(pluginID, key string) (*resource.ResourceCapabilities, error)
	GetFilterFields(pluginID, connectionID, key string) ([]resource.FilterField, error)
	GetResourceSchema(pluginID, connectionID, key string) (json.RawMessage, error)

	// Actions
	GetActions(pluginID, connectionID, key string) ([]resource.ActionDescriptor, error)
	ExecuteAction(pluginID, connectionID, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error)
	StreamAction(pluginID, connectionID, key, actionID string, input resource.ActionInput) (string, error)

	// Editor schemas
	GetEditorSchemas(pluginID, connectionID string) ([]resource.EditorSchema, error)

	// Relationships
	GetRelationships(pluginID, key string) ([]resource.RelationshipDescriptor, error)
	ResolveRelationships(pluginID, connectionID, key, id, namespace string) ([]resource.ResolvedRelationship, error)

	// Health
	GetHealth(pluginID, connectionID, key string, data json.RawMessage) (*resource.ResourceHealth, error)
	GetResourceEvents(pluginID, connectionID, key, id, namespace string, limit int32) ([]resource.ResourceEvent, error)
}
