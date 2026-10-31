package resource

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// ConnectionReader is the native connection lookup required by resource utilities.
type ConnectionReader interface {
	GetConnection(ctx context.Context, pluginID string, connectionID string) (types.Connection, error)
}

// Service is the typed native resource boundary. Wails uses explicit transport
// adapters; only host envelopes add row membership.
type Service interface {
	ListPlugins(ctx context.Context) ([]string, error)
	HasPlugin(ctx context.Context, pluginID string) (bool, error)
	Features(ctx context.Context, pluginID string) (resourcev2.FeatureSet, error)
	Catalog(ctx context.Context, pluginID string, request resourcev2.CatalogRequest) (resourcev2.Catalog, error)
	ResolveTarget(ctx context.Context, pluginID string, request ResolveTargetRequest) (ResolvedTarget, error)
	ResolveReference(ctx context.Context, pluginID string, request ResolveReferenceRequest) (ResolvedReference, error)
	Get(ctx context.Context, pluginID string, request HostGetRequest) (HostRecord, error)
	Enumerate(ctx context.Context, pluginID string, request HostEnumerateRequest) (HostSourcePage, error)
	NativeQuery(ctx context.Context, pluginID string, request HostNativeQueryRequest) (HostSourcePage, error)
	Mutate(ctx context.Context, pluginID string, request resourcev2.MutationRequest) (resourcev2.Record, error)
	Action(ctx context.Context, pluginID string, request resourcev2.ActionRequest) (resourcev2.Value, error)

	StartConnection(ctx context.Context, pluginID string, connectionID string) (types.ConnectionStatus, error)
	StopConnection(ctx context.Context, pluginID string, connectionID string) (types.Connection, error)
	CheckConnection(ctx context.Context, pluginID string, connectionID string) (types.ConnectionStatus, error)
	LoadConnections(ctx context.Context, pluginID string) ([]types.Connection, error)
	ListConnections(ctx context.Context, pluginID string) ([]types.Connection, error)
	ListAllConnections(ctx context.Context) (map[string][]types.Connection, error)
	GetAllConnectionStates(ctx context.Context) (map[string][]ConnectionState, error)
	GetConnection(ctx context.Context, pluginID string, connectionID string) (types.Connection, error)
	GetConnectionMetadata(ctx context.Context, pluginID, connectionID string) (HostConnectionMetadata, error)
	RefreshConnectionMetadata(ctx context.Context, pluginID, connectionID string) (HostConnectionMetadata, error)
	ScopeValues(ctx context.Context, pluginID string, route resourcev2.AccessRoute, dimension string) ([]string, error)
	SaveConnectionProfile(ctx context.Context, pluginID string, connection types.Connection) (ConnectionProfileResult, error)
	ListConnectionProfiles(ctx context.Context, pluginID string) ([]ConnectionProfile, error)
	ImportConnectionProfile(ctx context.Context, pluginID string, connectionID string) (ConnectionProfileResult, error)
	ResetConnectionProfile(ctx context.Context, pluginID string, connectionID string) (ConnectionProfileResult, error)
	RemoveConnection(ctx context.Context, pluginID string, connectionID string) error

	StartConnectionWatch(ctx context.Context, pluginID string, targets []resourcev2.ReadTarget) error
	StopConnectionWatch(ctx context.Context, pluginID string, route resourcev2.AccessRoute) error
	GetWatchState(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (*resourcev2.WatchConnectionSummary, error)
	EnsureResourceWatch(ctx context.Context, pluginID string, target resourcev2.ReadTarget) error
	StopResourceWatch(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) error
	RestartResourceWatch(ctx context.Context, pluginID string, target resourcev2.ReadTarget) error
	IsResourceWatchRunning(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (bool, error)
	SubscribeResource(ctx context.Context, pluginID string, subscription HostSubscription) error
	UnsubscribeResource(ctx context.Context, pluginID string, subscription HostSubscription) error

	GetResourceGroups(ctx context.Context, pluginID string, route resourcev2.AccessRoute) ([]resourcev2.ResourceGroup, error)
	GetResourceDefinition(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (resourcev2.ResourceDefinition, error)
	GetEditorSchemas(ctx context.Context, pluginID string, route resourcev2.AccessRoute) ([]resourcev2.EditorSchema, error)
	GetSchemaDocument(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error)
	GetRelationships(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) ([]resourcev2.RelationshipDescriptor, error)
	ResolveRelationships(ctx context.Context, pluginID string, request resourcev2.GetRequest) ([]resourcev2.ResolvedRelationship, error)
	GetHealth(ctx context.Context, pluginID string, request resourcev2.GetRequest, body resourcev2.Value) (*resourcev2.ResourceHealth, error)
	GetResourceEvents(ctx context.Context, pluginID string, request resourcev2.GetRequest, limit uint32) ([]resourcev2.ResourceEvent, error)
	GetActions(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) ([]resourcev2.ActionDescriptor, error)
	StreamAction(ctx context.Context, pluginID string, request resourcev2.ActionRequest) (string, error)
	AttachStreamAction(ctx context.Context, handleID string) (ActionSnapshot, error)
	CancelStreamAction(ctx context.Context, handleID string) error
}
