package resource

import (
	"context"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/transportjson"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceWrapper binds only admitted resource operations. Native lifecycle and
// graph reference validation are deliberately not frontend methods.
type ServiceWrapper struct {
	Ctrl  Controller
	Realm *invocation.Scope
}

func (s *ServiceWrapper) realmContext(ctx context.Context) context.Context {
	if s.Realm == nil {
		return ctx
	}
	return s.Realm.Context(ctx)
}
func (s *ServiceWrapper) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if service, ok := s.Ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return service.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *ServiceWrapper) ServiceShutdown() error {
	if service, ok := s.Ctrl.(interface{ ServiceShutdown() error }); ok {
		return service.ServiceShutdown()
	}
	return nil
}
func (s *ServiceWrapper) ListPlugins(ctx context.Context) ([]string, error) {
	return s.Ctrl.ListPlugins(s.realmContext(ctx))
}
func (s *ServiceWrapper) HasPlugin(ctx context.Context, pluginID string) (bool, error) {
	return s.Ctrl.HasPlugin(s.realmContext(ctx), pluginID)
}
func (s *ServiceWrapper) Features(ctx context.Context, pluginID string) (resourcev2.FeatureSet, error) {
	return s.Ctrl.Features(s.realmContext(ctx), pluginID)
}
func (s *ServiceWrapper) Catalog(ctx context.Context, pluginID string, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
	return s.Ctrl.Catalog(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) ResolveTarget(ctx context.Context, pluginID string, request ResolveTargetRequest) (ResolvedTarget, error) {
	return s.Ctrl.ResolveTarget(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) ResolveReference(ctx context.Context, pluginID string, request ResolveReferenceRequest) (ResolvedReference, error) {
	return s.Ctrl.ResolveReference(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) Get(ctx context.Context, pluginID string, request HostGetRequest) (HostRecord, error) {
	return s.Ctrl.Get(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) Enumerate(ctx context.Context, pluginID string, request HostEnumerateRequest) (HostSourcePage, error) {
	return s.Ctrl.Enumerate(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) NativeQuery(ctx context.Context, pluginID string, encoded string) (HostSourcePage, error) {
	var request HostNativeQueryRequest
	if err := transportjson.Decode(encoded, &request, pluginID); err != nil {
		return HostSourcePage{}, err
	}
	return s.Ctrl.NativeQuery(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) Mutate(ctx context.Context, pluginID string, encoded string) (resourcev2.Record, error) {
	var request resourcev2.MutationRequest
	if err := transportjson.Decode(encoded, &request, pluginID); err != nil {
		return resourcev2.Record{}, err
	}
	return s.Ctrl.Mutate(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) Action(ctx context.Context, pluginID string, encoded string) (resourcev2.Value, error) {
	var request resourcev2.ActionRequest
	if err := transportjson.Decode(encoded, &request, pluginID); err != nil {
		return resourcev2.Value{}, err
	}
	return s.Ctrl.Action(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) StartConnection(ctx context.Context, pluginID string, connectionID string) (types.ConnectionStatus, error) {
	return s.Ctrl.StartConnection(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) StopConnection(ctx context.Context, pluginID string, connectionID string) (types.Connection, error) {
	return s.Ctrl.StopConnection(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) CheckConnection(ctx context.Context, pluginID string, connectionID string) (types.ConnectionStatus, error) {
	return s.Ctrl.CheckConnection(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) LoadConnections(ctx context.Context, pluginID string) ([]types.Connection, error) {
	return s.Ctrl.LoadConnections(s.realmContext(ctx), pluginID)
}
func (s *ServiceWrapper) ListConnections(ctx context.Context, pluginID string) ([]types.Connection, error) {
	return s.Ctrl.ListConnections(s.realmContext(ctx), pluginID)
}
func (s *ServiceWrapper) ListAllConnections(ctx context.Context) (map[string][]types.Connection, error) {
	return s.Ctrl.ListAllConnections(s.realmContext(ctx))
}
func (s *ServiceWrapper) GetAllConnectionStates(ctx context.Context) (map[string][]ConnectionState, error) {
	return s.Ctrl.GetAllConnectionStates(s.realmContext(ctx))
}
func (s *ServiceWrapper) GetConnection(ctx context.Context, pluginID string, connectionID string) (types.Connection, error) {
	return s.Ctrl.GetConnection(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) GetConnectionMetadata(ctx context.Context, pluginID, connectionID string) (HostConnectionMetadata, error) {
	return s.Ctrl.GetConnectionMetadata(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) RefreshConnectionMetadata(ctx context.Context, pluginID, connectionID string) (HostConnectionMetadata, error) {
	return s.Ctrl.RefreshConnectionMetadata(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) ScopeValues(ctx context.Context, pluginID string, route resourcev2.AccessRoute, dimension string) ([]string, error) {
	return s.Ctrl.ScopeValues(s.realmContext(ctx), pluginID, route, dimension)
}
func (s *ServiceWrapper) SaveConnectionProfile(ctx context.Context, pluginID string, connection types.Connection) (ConnectionProfileResult, error) {
	return s.Ctrl.SaveConnectionProfile(s.realmContext(ctx), pluginID, connection)
}
func (s *ServiceWrapper) ListConnectionProfiles(ctx context.Context, pluginID string) ([]ConnectionProfile, error) {
	return s.Ctrl.ListConnectionProfiles(s.realmContext(ctx), pluginID)
}
func (s *ServiceWrapper) ImportConnectionProfile(ctx context.Context, pluginID string, connectionID string) (ConnectionProfileResult, error) {
	return s.Ctrl.ImportConnectionProfile(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) ResetConnectionProfile(ctx context.Context, pluginID string, connectionID string) (ConnectionProfileResult, error) {
	return s.Ctrl.ResetConnectionProfile(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) RemoveConnection(ctx context.Context, pluginID string, connectionID string) error {
	return s.Ctrl.RemoveConnection(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) StartConnectionWatch(ctx context.Context, pluginID string, targets []resourcev2.ReadTarget) error {
	return s.Ctrl.StartConnectionWatch(s.realmContext(ctx), pluginID, targets)
}
func (s *ServiceWrapper) StopConnectionWatch(ctx context.Context, pluginID string, route resourcev2.AccessRoute) error {
	return s.Ctrl.StopConnectionWatch(s.realmContext(ctx), pluginID, route)
}
func (s *ServiceWrapper) GetWatchState(ctx context.Context, pluginID string, route resourcev2.AccessRoute) (*resourcev2.WatchConnectionSummary, error) {
	return s.Ctrl.GetWatchState(s.realmContext(ctx), pluginID, route)
}
func (s *ServiceWrapper) EnsureResourceWatch(ctx context.Context, pluginID string, target resourcev2.ReadTarget) error {
	return s.Ctrl.EnsureResourceWatch(s.realmContext(ctx), pluginID, target)
}
func (s *ServiceWrapper) StopResourceWatch(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) error {
	return s.Ctrl.StopResourceWatch(s.realmContext(ctx), pluginID, route, resourceType)
}
func (s *ServiceWrapper) RestartResourceWatch(ctx context.Context, pluginID string, target resourcev2.ReadTarget) error {
	return s.Ctrl.RestartResourceWatch(s.realmContext(ctx), pluginID, target)
}
func (s *ServiceWrapper) IsResourceWatchRunning(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (bool, error) {
	return s.Ctrl.IsResourceWatchRunning(s.realmContext(ctx), pluginID, route, resourceType)
}
func (s *ServiceWrapper) SubscribeResource(ctx context.Context, pluginID string, subscription HostSubscription) error {
	return s.Ctrl.SubscribeResource(s.realmContext(ctx), pluginID, subscription)
}
func (s *ServiceWrapper) UnsubscribeResource(ctx context.Context, pluginID string, subscription HostSubscription) error {
	return s.Ctrl.UnsubscribeResource(s.realmContext(ctx), pluginID, subscription)
}
func (s *ServiceWrapper) GetResourceGroups(ctx context.Context, pluginID string, route resourcev2.AccessRoute) ([]resourcev2.ResourceGroup, error) {
	return s.Ctrl.GetResourceGroups(s.realmContext(ctx), pluginID, route)
}
func (s *ServiceWrapper) GetResourceDefinition(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) (resourcev2.ResourceDefinition, error) {
	return s.Ctrl.GetResourceDefinition(s.realmContext(ctx), pluginID, route, resourceType)
}
func (s *ServiceWrapper) GetEditorSchemas(ctx context.Context, pluginID string, route resourcev2.AccessRoute) ([]resourcev2.EditorSchema, error) {
	return s.Ctrl.GetEditorSchemas(s.realmContext(ctx), pluginID, route)
}
func (s *ServiceWrapper) GetSchemaDocument(ctx context.Context, pluginID string, route resourcev2.AccessRoute, reference resourcev2.SchemaDocumentReference) (resourcev2.SchemaDocument, error) {
	return s.Ctrl.GetSchemaDocument(s.realmContext(ctx), pluginID, route, reference)
}
func (s *ServiceWrapper) GetRelationships(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) ([]resourcev2.RelationshipDescriptor, error) {
	return s.Ctrl.GetRelationships(s.realmContext(ctx), pluginID, route, resourceType)
}
func (s *ServiceWrapper) ResolveRelationships(ctx context.Context, pluginID string, request resourcev2.GetRequest) ([]resourcev2.ResolvedRelationship, error) {
	return s.Ctrl.ResolveRelationships(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) GetHealth(ctx context.Context, pluginID string, encoded string) (*resourcev2.ResourceHealth, error) {
	var args struct {
		Request resourcev2.GetRequest `json:"request"`
		Body    resourcev2.Value      `json:"body"`
	}
	if err := transportjson.Decode(encoded, &args, pluginID); err != nil {
		return nil, err
	}
	return s.Ctrl.GetHealth(s.realmContext(ctx), pluginID, args.Request, args.Body)
}
func (s *ServiceWrapper) GetResourceEvents(ctx context.Context, pluginID string, request resourcev2.GetRequest, limit uint32) ([]resourcev2.ResourceEvent, error) {
	return s.Ctrl.GetResourceEvents(s.realmContext(ctx), pluginID, request, limit)
}
func (s *ServiceWrapper) GetActions(ctx context.Context, pluginID string, route resourcev2.AccessRoute, resourceType string) ([]resourcev2.ActionDescriptor, error) {
	return s.Ctrl.GetActions(s.realmContext(ctx), pluginID, route, resourceType)
}
func (s *ServiceWrapper) StreamAction(ctx context.Context, pluginID string, encoded string) (string, error) {
	var request resourcev2.ActionRequest
	if err := transportjson.Decode(encoded, &request, pluginID); err != nil {
		return "", err
	}
	return s.Ctrl.StreamAction(s.realmContext(ctx), pluginID, request)
}
func (s *ServiceWrapper) AttachStreamAction(ctx context.Context, handleID string) (ActionSnapshot, error) {
	return s.Ctrl.AttachStreamAction(s.realmContext(ctx), handleID)
}
func (s *ServiceWrapper) CancelStreamAction(ctx context.Context, handleID string) error {
	return s.Ctrl.CancelStreamAction(s.realmContext(ctx), handleID)
}
