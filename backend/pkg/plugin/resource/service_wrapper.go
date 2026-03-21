package resource

import (
	"context"
	"encoding/json"

	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceWrapper is an explicit delegation wrapper around resource.Controller.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//
//	OnPluginDestroy, Run, SetCrashCallback, Graph
type ServiceWrapper struct {
	Ctrl Controller
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

// CRUD
func (s *ServiceWrapper) Get(pluginID, connectionID, key string, input sdkresource.GetInput) (*sdkresource.GetResult, error) {
	return s.Ctrl.Get(pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) List(pluginID, connectionID, key string, input sdkresource.ListInput) (*sdkresource.ListResult, error) {
	return s.Ctrl.List(pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) Find(pluginID, connectionID, key string, input sdkresource.FindInput) (*sdkresource.FindResult, error) {
	return s.Ctrl.Find(pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) Create(pluginID, connectionID, key string, input sdkresource.CreateInput) (*sdkresource.CreateResult, error) {
	return s.Ctrl.Create(pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) Update(pluginID, connectionID, key string, input sdkresource.UpdateInput) (*sdkresource.UpdateResult, error) {
	return s.Ctrl.Update(pluginID, connectionID, key, input)
}
func (s *ServiceWrapper) Delete(pluginID, connectionID, key string, input sdkresource.DeleteInput) (*sdkresource.DeleteResult, error) {
	return s.Ctrl.Delete(pluginID, connectionID, key, input)
}

// Connection lifecycle
func (s *ServiceWrapper) StartConnection(pluginID, connectionID string) (sdktypes.ConnectionStatus, error) {
	return s.Ctrl.StartConnection(pluginID, connectionID)
}
func (s *ServiceWrapper) StopConnection(pluginID, connectionID string) (sdktypes.Connection, error) {
	return s.Ctrl.StopConnection(pluginID, connectionID)
}
func (s *ServiceWrapper) CheckConnection(pluginID, connectionID string) (sdktypes.ConnectionStatus, error) {
	return s.Ctrl.CheckConnection(pluginID, connectionID)
}
func (s *ServiceWrapper) LoadConnections(pluginID string) ([]sdktypes.Connection, error) {
	return s.Ctrl.LoadConnections(pluginID)
}
func (s *ServiceWrapper) ListConnections(pluginID string) ([]sdktypes.Connection, error) {
	return s.Ctrl.ListConnections(pluginID)
}
func (s *ServiceWrapper) ListAllConnections() (map[string][]sdktypes.Connection, error) {
	return s.Ctrl.ListAllConnections()
}
func (s *ServiceWrapper) GetAllConnectionStates() (map[string][]ConnectionState, error) {
	return s.Ctrl.GetAllConnectionStates()
}
func (s *ServiceWrapper) GetConnection(pluginID, connectionID string) (sdktypes.Connection, error) {
	return s.Ctrl.GetConnection(pluginID, connectionID)
}
func (s *ServiceWrapper) GetConnectionNamespaces(pluginID, connectionID string) ([]string, error) {
	return s.Ctrl.GetConnectionNamespaces(pluginID, connectionID)
}
func (s *ServiceWrapper) AddConnection(pluginID string, connection sdktypes.Connection) error {
	return s.Ctrl.AddConnection(pluginID, connection)
}
func (s *ServiceWrapper) UpdateConnection(pluginID string, connection sdktypes.Connection) (sdktypes.Connection, error) {
	return s.Ctrl.UpdateConnection(pluginID, connection)
}
func (s *ServiceWrapper) RemoveConnection(pluginID, connectionID string) error {
	return s.Ctrl.RemoveConnection(pluginID, connectionID)
}

// Watch lifecycle
func (s *ServiceWrapper) StartConnectionWatch(pluginID, connectionID string) error {
	return s.Ctrl.StartConnectionWatch(pluginID, connectionID)
}
func (s *ServiceWrapper) StopConnectionWatch(pluginID, connectionID string) error {
	return s.Ctrl.StopConnectionWatch(pluginID, connectionID)
}
func (s *ServiceWrapper) GetWatchState(pluginID, connectionID string) (*sdkresource.WatchConnectionSummary, error) {
	return s.Ctrl.GetWatchState(pluginID, connectionID)
}
func (s *ServiceWrapper) EnsureResourceWatch(pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.EnsureResourceWatch(pluginID, connectionID, resourceKey)
}
func (s *ServiceWrapper) StopResourceWatch(pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.StopResourceWatch(pluginID, connectionID, resourceKey)
}
func (s *ServiceWrapper) RestartResourceWatch(pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.RestartResourceWatch(pluginID, connectionID, resourceKey)
}
func (s *ServiceWrapper) IsResourceWatchRunning(pluginID, connectionID, resourceKey string) (bool, error) {
	return s.Ctrl.IsResourceWatchRunning(pluginID, connectionID, resourceKey)
}

// Subscriptions
func (s *ServiceWrapper) SubscribeResource(pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.SubscribeResource(pluginID, connectionID, resourceKey)
}
func (s *ServiceWrapper) UnsubscribeResource(pluginID, connectionID, resourceKey string) error {
	return s.Ctrl.UnsubscribeResource(pluginID, connectionID, resourceKey)
}

// Type metadata
func (s *ServiceWrapper) GetResourceGroups(pluginID, connectionID string) map[string]sdkresource.ResourceGroup {
	return s.Ctrl.GetResourceGroups(pluginID, connectionID)
}
func (s *ServiceWrapper) GetResourceGroup(pluginID, groupID string) (sdkresource.ResourceGroup, error) {
	return s.Ctrl.GetResourceGroup(pluginID, groupID)
}
func (s *ServiceWrapper) GetResourceTypes(pluginID, connectionID string) map[string]sdkresource.ResourceMeta {
	return s.Ctrl.GetResourceTypes(pluginID, connectionID)
}
func (s *ServiceWrapper) GetResourceType(pluginID, typeID string) (*sdkresource.ResourceMeta, error) {
	return s.Ctrl.GetResourceType(pluginID, typeID)
}
func (s *ServiceWrapper) HasResourceType(pluginID, typeID string) bool {
	return s.Ctrl.HasResourceType(pluginID, typeID)
}
func (s *ServiceWrapper) GetResourceDefinition(pluginID, typeID string) (sdkresource.ResourceDefinition, error) {
	return s.Ctrl.GetResourceDefinition(pluginID, typeID)
}
func (s *ServiceWrapper) GetResourceCapabilities(pluginID, key string) (*sdkresource.ResourceCapabilities, error) {
	return s.Ctrl.GetResourceCapabilities(pluginID, key)
}
func (s *ServiceWrapper) GetFilterFields(pluginID, connectionID, key string) ([]sdkresource.FilterField, error) {
	return s.Ctrl.GetFilterFields(pluginID, connectionID, key)
}
func (s *ServiceWrapper) GetResourceSchema(pluginID, connectionID, key string) (json.RawMessage, error) {
	return s.Ctrl.GetResourceSchema(pluginID, connectionID, key)
}

// Actions
func (s *ServiceWrapper) GetActions(pluginID, connectionID, key string) ([]sdkresource.ActionDescriptor, error) {
	return s.Ctrl.GetActions(pluginID, connectionID, key)
}
func (s *ServiceWrapper) ExecuteAction(pluginID, connectionID, key, actionID string, input sdkresource.ActionInput) (*sdkresource.ActionResult, error) {
	return s.Ctrl.ExecuteAction(pluginID, connectionID, key, actionID, input)
}
func (s *ServiceWrapper) StreamAction(pluginID, connectionID, key, actionID string, input sdkresource.ActionInput) (string, error) {
	return s.Ctrl.StreamAction(pluginID, connectionID, key, actionID, input)
}

// Editor schemas
func (s *ServiceWrapper) GetEditorSchemas(pluginID, connectionID string) ([]sdkresource.EditorSchema, error) {
	return s.Ctrl.GetEditorSchemas(pluginID, connectionID)
}

// Relationships
func (s *ServiceWrapper) GetRelationships(pluginID, key string) ([]sdkresource.RelationshipDescriptor, error) {
	return s.Ctrl.GetRelationships(pluginID, key)
}
func (s *ServiceWrapper) ResolveRelationships(pluginID, connectionID, key, id, namespace string) ([]sdkresource.ResolvedRelationship, error) {
	return s.Ctrl.ResolveRelationships(pluginID, connectionID, key, id, namespace)
}

// Health
func (s *ServiceWrapper) GetHealth(pluginID, connectionID, key string, data json.RawMessage) (*sdkresource.ResourceHealth, error) {
	return s.Ctrl.GetHealth(pluginID, connectionID, key, data)
}
func (s *ServiceWrapper) GetResourceEvents(pluginID, connectionID, key, id, namespace string, limit int32) ([]sdkresource.ResourceEvent, error) {
	return s.Ctrl.GetResourceEvents(pluginID, connectionID, key, id, namespace, limit)
}

// ListPlugins
func (s *ServiceWrapper) ListPlugins() ([]string, error) {
	return s.Ctrl.ListPlugins()
}

// HasPlugin
func (s *ServiceWrapper) HasPlugin(pluginID string) bool {
	return s.Ctrl.HasPlugin(pluginID)
}
