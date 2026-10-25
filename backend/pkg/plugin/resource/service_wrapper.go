package resource

import (
	"context"
	"encoding/json"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
)

// ServiceWrapper is an explicit delegation wrapper around resource.Controller.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//
//	OnPluginDestroy, Run, SetCrashCallback, Graph
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
	if ss, ok := s.Ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}

func (s *ServiceWrapper) ServiceShutdown() error {
	if ss, ok := s.Ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}

// CRUD.
func (s *ServiceWrapper) Get(ctx context.Context, pluginID, connectionID, key string,
	input sdkresource.GetInput) (*sdkresource.GetResult, error) {
	return s.Ctrl.Get(s.realmContext(ctx), pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) List(ctx context.Context, pluginID, connectionID, key string,
	input sdkresource.ListInput) (*sdkresource.ListResult, error) {
	return s.Ctrl.List(s.realmContext(ctx), pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) Find(ctx context.Context, pluginID, connectionID, key string,
	input sdkresource.FindInput) (*sdkresource.FindResult, error) {
	return s.Ctrl.Find(s.realmContext(ctx), pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) Create(ctx context.Context, pluginID, connectionID, key string,
	input sdkresource.CreateInput) (*sdkresource.CreateResult, error) {
	return s.Ctrl.Create(s.realmContext(ctx), pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) Update(ctx context.Context, pluginID, connectionID, key string,
	input sdkresource.UpdateInput) (*sdkresource.UpdateResult, error) {
	return s.Ctrl.Update(s.realmContext(ctx), pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) Delete(ctx context.Context, pluginID, connectionID, key string,
	input sdkresource.DeleteInput) (*sdkresource.DeleteResult, error) {
	return s.Ctrl.Delete(s.realmContext(ctx), pluginID, connectionID, key, input)
}

// Connection lifecycle.
func (s *ServiceWrapper) StartConnection(ctx context.Context, pluginID, connectionID string) (sdktypes.ConnectionStatus, error) {
	return s.Ctrl.StartConnection(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) StopConnection(ctx context.Context, pluginID, connectionID string) (sdktypes.Connection, error) {
	return s.Ctrl.StopConnection(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) CheckConnection(ctx context.Context, pluginID, connectionID string) (sdktypes.ConnectionStatus, error) {
	return s.Ctrl.CheckConnection(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) LoadConnections(ctx context.Context, pluginID string) ([]sdktypes.Connection, error) {
	return s.Ctrl.LoadConnections(s.realmContext(ctx), pluginID)
}
func (s *ServiceWrapper) ListConnections(ctx context.Context, pluginID string) ([]sdktypes.Connection, error) {
	return s.Ctrl.ListConnections(s.realmContext(ctx), pluginID)
}
func (s *ServiceWrapper) ListAllConnections(ctx context.Context) (map[string][]sdktypes.Connection, error) {
	return s.Ctrl.ListAllConnections(s.realmContext(ctx))
}
func (s *ServiceWrapper) GetAllConnectionStates(ctx context.Context) (map[string][]ConnectionState, error) {
	return s.Ctrl.GetAllConnectionStates(s.realmContext(ctx))
}
func (s *ServiceWrapper) GetConnection(ctx context.Context, pluginID, connectionID string) (sdktypes.Connection, error) {
	return s.Ctrl.GetConnection(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) GetConnectionNamespaces(ctx context.Context, pluginID, connectionID string) ([]string, error) {
	return s.Ctrl.GetConnectionNamespaces(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) AddConnection(ctx context.Context, pluginID string, connection sdktypes.Connection) error {
	return s.Ctrl.AddConnection(s.realmContext(ctx), pluginID, connection)
}
func (s *ServiceWrapper) UpdateConnection(ctx context.Context, pluginID string,
	connection sdktypes.Connection) (sdktypes.Connection, error) {
	return s.Ctrl.UpdateConnection(s.realmContext(ctx), pluginID, connection)
}
func (s *ServiceWrapper) RemoveConnection(ctx context.Context, pluginID, connectionID string) error {
	return s.Ctrl.RemoveConnection(s.realmContext(ctx), pluginID, connectionID)
}

// Watch lifecycle.
func (s *ServiceWrapper) StartConnectionWatch(ctx context.Context, pluginID, connectionID string) error {
	return s.Ctrl.StartConnectionWatch(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) StopConnectionWatch(ctx context.Context, pluginID, connectionID string) error {
	return s.Ctrl.StopConnectionWatch(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) GetWatchState(ctx context.Context, pluginID, connectionID string) (*sdkresource.WatchConnectionSummary, error) {
	return s.Ctrl.GetWatchState(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) EnsureResourceWatch(ctx context.Context, pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.EnsureResourceWatch(s.realmContext(ctx), pluginID, connectionID, resourceKey)
}
func (s *ServiceWrapper) StopResourceWatch(ctx context.Context, pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.StopResourceWatch(s.realmContext(ctx), pluginID, connectionID, resourceKey)
}
func (s *ServiceWrapper) RestartResourceWatch(ctx context.Context, pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.RestartResourceWatch(s.realmContext(ctx), pluginID, connectionID, resourceKey)
}
func (s *ServiceWrapper) IsResourceWatchRunning(ctx context.Context, pluginID, connectionID, resourceKey string) (bool, error) {
	return s.Ctrl.IsResourceWatchRunning(s.realmContext(ctx), pluginID, connectionID, resourceKey)
}

// Subscriptions.
func (s *ServiceWrapper) SubscribeResource(ctx context.Context, pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.SubscribeResource(s.realmContext(ctx), pluginID, connectionID, resourceKey)
}
func (s *ServiceWrapper) UnsubscribeResource(ctx context.Context, pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.UnsubscribeResource(s.realmContext(ctx), pluginID, connectionID, resourceKey)
}

// Type metadata.
func (s *ServiceWrapper) GetResourceGroups(ctx context.Context, pluginID, connectionID string) (map[string]sdkresource.ResourceGroup, error) {
	return s.Ctrl.GetResourceGroups(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) GetResourceGroup(ctx context.Context, pluginID, groupID string) (sdkresource.ResourceGroup, error) {
	return s.Ctrl.GetResourceGroup(s.realmContext(ctx), pluginID, groupID)
}
func (s *ServiceWrapper) GetResourceTypes(ctx context.Context, pluginID, connectionID string) (map[string]sdkresource.ResourceMeta, error) {
	return s.Ctrl.GetResourceTypes(s.realmContext(ctx), pluginID, connectionID)
}
func (s *ServiceWrapper) GetResourceType(ctx context.Context, pluginID, typeID string) (*sdkresource.ResourceMeta, error) {
	return s.Ctrl.GetResourceType(s.realmContext(ctx), pluginID, typeID)
}
func (s *ServiceWrapper) HasResourceType(ctx context.Context, pluginID, typeID string) (bool, error) {
	return s.Ctrl.HasResourceType(s.realmContext(ctx), pluginID, typeID)
}
func (s *ServiceWrapper) GetResourceDefinition(ctx context.Context, pluginID, typeID string) (sdkresource.ResourceDefinition, error) {
	return s.Ctrl.GetResourceDefinition(s.realmContext(ctx), pluginID, typeID)
}
func (s *ServiceWrapper) GetResourceCapabilities(ctx context.Context, pluginID, key string) (*sdkresource.ResourceCapabilities, error) {
	return s.Ctrl.GetResourceCapabilities(s.realmContext(ctx), pluginID, key)
}
func (s *ServiceWrapper) GetFilterFields(ctx context.Context, pluginID, connectionID, key string) ([]sdkresource.FilterField, error) {
	return s.Ctrl.GetFilterFields(s.realmContext(ctx), pluginID, connectionID, key)
}
func (s *ServiceWrapper) GetResourceSchema(ctx context.Context, pluginID, connectionID, key string) (json.RawMessage, error) {
	return s.Ctrl.GetResourceSchema(s.realmContext(ctx), pluginID, connectionID, key)
}

// Actions.
func (s *ServiceWrapper) GetActions(ctx context.Context, pluginID, connectionID, key string) ([]sdkresource.ActionDescriptor, error) {
	return s.Ctrl.GetActions(s.realmContext(ctx), pluginID, connectionID, key)
}
func (s *ServiceWrapper) ExecuteAction(ctx context.Context, pluginID, connectionID, key, actionID string,
	input sdkresource.ActionInput) (*sdkresource.ActionResult, error) {
	return s.Ctrl.ExecuteAction(s.realmContext(ctx), pluginID, connectionID, key, actionID, input)
}
func (s *ServiceWrapper) StreamAction(ctx context.Context, pluginID, connectionID, key, actionID string,
	input sdkresource.ActionInput) (string, error) {
	return s.Ctrl.StreamAction(s.realmContext(ctx), pluginID, connectionID, key, actionID, input)
}

// Editor schemas.
func (s *ServiceWrapper) GetEditorSchemas(ctx context.Context, pluginID, connectionID string) ([]sdkresource.EditorSchema, error) {
	return s.Ctrl.GetEditorSchemas(s.realmContext(ctx), pluginID, connectionID)
}

// Relationships.
func (s *ServiceWrapper) GetRelationships(ctx context.Context, pluginID, key string) ([]sdkresource.RelationshipDescriptor, error) {
	return s.Ctrl.GetRelationships(s.realmContext(ctx), pluginID, key)
}
func (s *ServiceWrapper) ResolveRelationships(ctx context.Context, pluginID, connectionID, key, id, namespace string) ([]sdkresource.ResolvedRelationship, error) {
	return s.Ctrl.ResolveRelationships(s.realmContext(ctx), pluginID, connectionID, key, id, namespace)
}

// Health.
func (s *ServiceWrapper) GetHealth(ctx context.Context, pluginID, connectionID, key string,
	data json.RawMessage) (*sdkresource.ResourceHealth, error) {
	return s.Ctrl.GetHealth(s.realmContext(ctx), pluginID, connectionID, key, data)
}
func (s *ServiceWrapper) GetResourceEvents(ctx context.Context, pluginID, connectionID, key, id, namespace string,
	limit int32) ([]sdkresource.ResourceEvent, error) {
	return s.Ctrl.GetResourceEvents(s.realmContext(ctx), pluginID, connectionID, key, id, namespace, limit)
}

// ListPlugins.
func (s *ServiceWrapper) ListPlugins(ctx context.Context) ([]string, error) {
	return s.Ctrl.ListPlugins(s.realmContext(ctx))
}

// HasPlugin.
func (s *ServiceWrapper) HasPlugin(ctx context.Context, pluginID string) (bool, error) {
	return s.Ctrl.HasPlugin(s.realmContext(ctx), pluginID)
}

func (s *ServiceWrapper) AttachStreamAction(ctx context.Context, handleID string) (ActionSnapshot, error) {
	return s.Ctrl.AttachStreamAction(s.realmContext(ctx), handleID)
}

func (s *ServiceWrapper) CancelStreamAction(ctx context.Context, handleID string) error {
	return s.Ctrl.CancelStreamAction(s.realmContext(ctx), handleID)
}
