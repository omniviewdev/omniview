package resource

import (
	"context"
	"encoding/json"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// AdapterV1 wraps SDK v1 resource.Provider as the engine canonical ResourceProvider.
// For v1, this is a direct pass-through (types are identical).
// When v2 ships and canonical types diverge, AdapterV1 translates v1 → canonical.
type AdapterV1 struct {
	inner resource.Provider
}

// Compile-time check.
var _ ResourceProvider = (*AdapterV1)(nil)

// NewAdapterV1 creates a new AdapterV1.
func NewAdapterV1(inner resource.Provider) *AdapterV1 {
	return &AdapterV1{inner: inner}
}

// CRUD

func (a *AdapterV1) Get(ctx context.Context, key string, input resource.GetInput) (*resource.GetResult, error) {
	return a.inner.Get(ctx, key, input)
}

func (a *AdapterV1) List(ctx context.Context, key string, input resource.ListInput) (*resource.ListResult, error) {
	return a.inner.List(ctx, key, input)
}

func (a *AdapterV1) Find(ctx context.Context, key string, input resource.FindInput) (*resource.FindResult, error) {
	return a.inner.Find(ctx, key, input)
}

func (a *AdapterV1) Create(ctx context.Context, key string, input resource.CreateInput) (*resource.CreateResult, error) {
	return a.inner.Create(ctx, key, input)
}

func (a *AdapterV1) Update(ctx context.Context, key string, input resource.UpdateInput) (*resource.UpdateResult, error) {
	return a.inner.Update(ctx, key, input)
}

func (a *AdapterV1) Delete(ctx context.Context, key string, input resource.DeleteInput) (*resource.DeleteResult, error) {
	return a.inner.Delete(ctx, key, input)
}

// Connection lifecycle

func (a *AdapterV1) StartConnection(ctx context.Context, connectionID string) (types.ConnectionStatus, error) {
	return a.inner.StartConnection(ctx, connectionID)
}

func (a *AdapterV1) StopConnection(ctx context.Context, connectionID string) (types.Connection, error) {
	return a.inner.StopConnection(ctx, connectionID)
}

func (a *AdapterV1) LoadConnections(ctx context.Context) ([]types.Connection, error) {
	return a.inner.LoadConnections(ctx)
}

func (a *AdapterV1) ListConnections(ctx context.Context) ([]types.Connection, error) {
	return a.inner.ListConnections(ctx)
}

func (a *AdapterV1) GetConnection(ctx context.Context, id string) (types.Connection, error) {
	return a.inner.GetConnection(ctx, id)
}

func (a *AdapterV1) GetConnectionNamespaces(ctx context.Context, id string) ([]string, error) {
	return a.inner.GetConnectionNamespaces(ctx, id)
}

func (a *AdapterV1) UpdateConnection(ctx context.Context, connection types.Connection) (types.Connection, error) {
	return a.inner.UpdateConnection(ctx, connection)
}

func (a *AdapterV1) DeleteConnection(ctx context.Context, id string) error {
	return a.inner.DeleteConnection(ctx, id)
}

func (a *AdapterV1) WatchConnections(ctx context.Context, stream chan<- []types.Connection) error {
	return a.inner.WatchConnections(ctx, stream)
}

// Watch

func (a *AdapterV1) StartConnectionWatch(ctx context.Context, connectionID string) error {
	return a.inner.StartConnectionWatch(ctx, connectionID)
}

func (a *AdapterV1) StopConnectionWatch(ctx context.Context, connectionID string) error {
	return a.inner.StopConnectionWatch(ctx, connectionID)
}

func (a *AdapterV1) HasWatch(ctx context.Context, connectionID string) bool {
	return a.inner.HasWatch(ctx, connectionID)
}

func (a *AdapterV1) GetWatchState(ctx context.Context, connectionID string) (*resource.WatchConnectionSummary, error) {
	return a.inner.GetWatchState(ctx, connectionID)
}

func (a *AdapterV1) ListenForEvents(ctx context.Context, sink resource.WatchEventSink) error {
	return a.inner.ListenForEvents(ctx, sink)
}

func (a *AdapterV1) EnsureResourceWatch(ctx context.Context, connectionID, resourceKey string) error {
	return a.inner.EnsureResourceWatch(ctx, connectionID, resourceKey)
}

func (a *AdapterV1) StopResourceWatch(ctx context.Context, connectionID, resourceKey string) error {
	return a.inner.StopResourceWatch(ctx, connectionID, resourceKey)
}

func (a *AdapterV1) RestartResourceWatch(ctx context.Context, connectionID, resourceKey string) error {
	return a.inner.RestartResourceWatch(ctx, connectionID, resourceKey)
}

func (a *AdapterV1) IsResourceWatchRunning(ctx context.Context, connectionID, resourceKey string) (bool, error) {
	return a.inner.IsResourceWatchRunning(ctx, connectionID, resourceKey)
}

// Type metadata

func (a *AdapterV1) GetResourceGroups(ctx context.Context, connectionID string) map[string]resource.ResourceGroup {
	return a.inner.GetResourceGroups(ctx, connectionID)
}

func (a *AdapterV1) GetResourceGroup(ctx context.Context, id string) (resource.ResourceGroup, error) {
	return a.inner.GetResourceGroup(ctx, id)
}

func (a *AdapterV1) GetResourceTypes(ctx context.Context, connectionID string) map[string]resource.ResourceMeta {
	return a.inner.GetResourceTypes(ctx, connectionID)
}

func (a *AdapterV1) GetResourceType(ctx context.Context, id string) (*resource.ResourceMeta, error) {
	return a.inner.GetResourceType(ctx, id)
}

func (a *AdapterV1) HasResourceType(ctx context.Context, id string) bool {
	return a.inner.HasResourceType(ctx, id)
}

func (a *AdapterV1) GetResourceDefinition(ctx context.Context, id string) (resource.ResourceDefinition, error) {
	return a.inner.GetResourceDefinition(ctx, id)
}

func (a *AdapterV1) GetResourceCapabilities(ctx context.Context, resourceKey string) (*resource.ResourceCapabilities, error) {
	return a.inner.GetResourceCapabilities(ctx, resourceKey)
}

func (a *AdapterV1) GetResourceSchema(ctx context.Context, connectionID, resourceKey string) (json.RawMessage, error) {
	return a.inner.GetResourceSchema(ctx, connectionID, resourceKey)
}

func (a *AdapterV1) GetFilterFields(ctx context.Context, connectionID, resourceKey string) ([]resource.FilterField, error) {
	return a.inner.GetFilterFields(ctx, connectionID, resourceKey)
}

// Actions

func (a *AdapterV1) GetActions(ctx context.Context, key string) ([]resource.ActionDescriptor, error) {
	return a.inner.GetActions(ctx, key)
}

func (a *AdapterV1) ExecuteAction(ctx context.Context, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error) {
	return a.inner.ExecuteAction(ctx, key, actionID, input)
}

func (a *AdapterV1) StreamAction(ctx context.Context, key, actionID string, input resource.ActionInput, stream chan<- resource.ActionEvent) error {
	return a.inner.StreamAction(ctx, key, actionID, input, stream)
}

// Editor schemas

func (a *AdapterV1) GetEditorSchemas(ctx context.Context, connectionID string) ([]resource.EditorSchema, error) {
	return a.inner.GetEditorSchemas(ctx, connectionID)
}

// Relationships

func (a *AdapterV1) GetRelationships(ctx context.Context, resourceKey string) ([]resource.RelationshipDescriptor, error) {
	return a.inner.GetRelationships(ctx, resourceKey)
}

func (a *AdapterV1) ResolveRelationships(ctx context.Context, connectionID, resourceKey, id, namespace string) ([]resource.ResolvedRelationship, error) {
	return a.inner.ResolveRelationships(ctx, connectionID, resourceKey, id, namespace)
}

// Health

func (a *AdapterV1) GetHealth(ctx context.Context, connectionID, resourceKey string, data json.RawMessage) (*resource.ResourceHealth, error) {
	return a.inner.GetHealth(ctx, connectionID, resourceKey, data)
}

func (a *AdapterV1) GetResourceEvents(ctx context.Context, connectionID, resourceKey, id, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	return a.inner.GetResourceEvents(ctx, connectionID, resourceKey, id, namespace, limit)
}
