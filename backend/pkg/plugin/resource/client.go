package resource

import (
	"encoding/json"

	resource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// NOTE: Client intentionally does NOT implement Service. It is the Wails-bound
// frontend API layer that converts between SDK types (json.RawMessage) and
// frontend-friendly types (interface{} → "any" in TypeScript).

// Client is a thin Wails-bound wrapper around the Controller.
// It converts SDK types (json.RawMessage) to frontend-friendly types (interface{})
// so that Wails generates "any" in TypeScript instead of "number[]".
type Client struct {
	controller Controller
}

func NewClient(controller Controller) *Client {
	return &Client{controller: controller}
}

// Client no longer satisfies Service — it uses frontend-facing types
// (interface{} instead of json.RawMessage) so Wails generates correct TS.

func (c *Client) ListPlugins() ([]string, error) {
	return c.controller.ListPlugins()
}

// CRUD — converts between SDK types and frontend-facing types

func (c *Client) Get(pluginID, connectionID, key string, input resource.GetInput) (*ClientResult, error) {
	result, err := c.controller.Get(pluginID, connectionID, key, input)
	if err != nil {
		return nil, err
	}
	return toClientResult(result), nil
}

func (c *Client) List(pluginID, connectionID, key string, input resource.ListInput) (*ClientListResult, error) {
	result, err := c.controller.List(pluginID, connectionID, key, input)
	if err != nil {
		return nil, err
	}
	return toClientListResult(result), nil
}

func (c *Client) Find(pluginID, connectionID, key string, input resource.FindInput) (*ClientListResult, error) {
	result, err := c.controller.Find(pluginID, connectionID, key, input)
	if err != nil {
		return nil, err
	}
	return findToClientListResult(result), nil
}

func (c *Client) Create(pluginID, connectionID, key string, input ClientCreateInput) (*ClientResult, error) {
	sdkInput, err := toSDKCreateInput(input)
	if err != nil {
		return nil, err
	}
	result, err := c.controller.Create(pluginID, connectionID, key, sdkInput)
	if err != nil {
		return nil, err
	}
	return createToClientResult(result), nil
}

func (c *Client) Update(pluginID, connectionID, key string, input ClientUpdateInput) (*ClientResult, error) {
	sdkInput, err := toSDKUpdateInput(input)
	if err != nil {
		return nil, err
	}
	result, err := c.controller.Update(pluginID, connectionID, key, sdkInput)
	if err != nil {
		return nil, err
	}
	return updateToClientResult(result), nil
}

func (c *Client) Delete(pluginID, connectionID, key string, input resource.DeleteInput) (*ClientResult, error) {
	result, err := c.controller.Delete(pluginID, connectionID, key, input)
	if err != nil {
		return nil, err
	}
	return deleteToClientResult(result), nil
}

// Connection lifecycle

func (c *Client) StartConnection(pluginID, connectionID string) (types.ConnectionStatus, error) {
	return c.controller.StartConnection(pluginID, connectionID)
}

func (c *Client) StopConnection(pluginID, connectionID string) (types.Connection, error) {
	return c.controller.StopConnection(pluginID, connectionID)
}

func (c *Client) LoadConnections(pluginID string) ([]types.Connection, error) {
	return c.controller.LoadConnections(pluginID)
}

func (c *Client) ListConnections(pluginID string) ([]types.Connection, error) {
	return c.controller.ListConnections(pluginID)
}

func (c *Client) ListAllConnections() (map[string][]types.Connection, error) {
	return c.controller.ListAllConnections()
}

func (c *Client) GetAllConnectionStates() (map[string][]ConnectionState, error) {
	return c.controller.GetAllConnectionStates()
}

func (c *Client) GetConnection(pluginID, connectionID string) (types.Connection, error) {
	return c.controller.GetConnection(pluginID, connectionID)
}

func (c *Client) GetConnectionNamespaces(pluginID, connectionID string) ([]string, error) {
	return c.controller.GetConnectionNamespaces(pluginID, connectionID)
}

func (c *Client) AddConnection(pluginID string, connection types.Connection) error {
	return c.controller.AddConnection(pluginID, connection)
}

func (c *Client) UpdateConnection(pluginID string, connection types.Connection) (types.Connection, error) {
	return c.controller.UpdateConnection(pluginID, connection)
}

func (c *Client) RemoveConnection(pluginID, connectionID string) error {
	return c.controller.RemoveConnection(pluginID, connectionID)
}

// Watch lifecycle

func (c *Client) StartConnectionWatch(pluginID, connectionID string) error {
	return c.controller.StartConnectionWatch(pluginID, connectionID)
}

func (c *Client) StopConnectionWatch(pluginID, connectionID string) error {
	return c.controller.StopConnectionWatch(pluginID, connectionID)
}

func (c *Client) GetWatchState(pluginID, connectionID string) (*resource.WatchConnectionSummary, error) {
	return c.controller.GetWatchState(pluginID, connectionID)
}

func (c *Client) EnsureResourceWatch(pluginID, connectionID, resourceKey string) error {
	return c.controller.EnsureResourceWatch(pluginID, connectionID, resourceKey)
}

func (c *Client) StopResourceWatch(pluginID, connectionID, resourceKey string) error {
	return c.controller.StopResourceWatch(pluginID, connectionID, resourceKey)
}

func (c *Client) RestartResourceWatch(pluginID, connectionID, resourceKey string) error {
	return c.controller.RestartResourceWatch(pluginID, connectionID, resourceKey)
}

func (c *Client) IsResourceWatchRunning(pluginID, connectionID, resourceKey string) (bool, error) {
	return c.controller.IsResourceWatchRunning(pluginID, connectionID, resourceKey)
}

// Subscriptions

func (c *Client) SubscribeResource(pluginID, connectionID, resourceKey string) error {
	return c.controller.SubscribeResource(pluginID, connectionID, resourceKey)
}

func (c *Client) UnsubscribeResource(pluginID, connectionID, resourceKey string) error {
	return c.controller.UnsubscribeResource(pluginID, connectionID, resourceKey)
}

// Type metadata

func (c *Client) GetResourceGroups(pluginID, connectionID string) map[string]resource.ResourceGroup {
	return c.controller.GetResourceGroups(pluginID, connectionID)
}

func (c *Client) GetResourceGroup(pluginID, groupID string) (resource.ResourceGroup, error) {
	return c.controller.GetResourceGroup(pluginID, groupID)
}

func (c *Client) GetResourceTypes(pluginID, connectionID string) map[string]resource.ResourceMeta {
	return c.controller.GetResourceTypes(pluginID, connectionID)
}

func (c *Client) GetResourceType(pluginID, typeID string) (*resource.ResourceMeta, error) {
	return c.controller.GetResourceType(pluginID, typeID)
}

func (c *Client) HasResourceType(pluginID, typeID string) bool {
	return c.controller.HasResourceType(pluginID, typeID)
}

func (c *Client) GetResourceDefinition(pluginID, typeID string) (resource.ResourceDefinition, error) {
	return c.controller.GetResourceDefinition(pluginID, typeID)
}

func (c *Client) GetResourceCapabilities(pluginID, key string) (*resource.ResourceCapabilities, error) {
	return c.controller.GetResourceCapabilities(pluginID, key)
}

func (c *Client) GetFilterFields(pluginID, connectionID, key string) ([]resource.FilterField, error) {
	return c.controller.GetFilterFields(pluginID, connectionID, key)
}

func (c *Client) GetResourceSchema(pluginID, connectionID, key string) (interface{}, error) {
	raw, err := c.controller.GetResourceSchema(pluginID, connectionID, key)
	if err != nil {
		return nil, err
	}
	return interface{}(raw), nil
}

// Actions

func (c *Client) GetActions(pluginID, connectionID, key string) ([]resource.ActionDescriptor, error) {
	return c.controller.GetActions(pluginID, connectionID, key)
}

func (c *Client) ExecuteAction(pluginID, connectionID, key, actionID string, input resource.ActionInput) (*resource.ActionResult, error) {
	return c.controller.ExecuteAction(pluginID, connectionID, key, actionID, input)
}

func (c *Client) StreamAction(pluginID, connectionID, key, actionID string, input resource.ActionInput) (string, error) {
	return c.controller.StreamAction(pluginID, connectionID, key, actionID, input)
}

// Editor schemas

func (c *Client) GetEditorSchemas(pluginID, connectionID string) ([]resource.EditorSchema, error) {
	return c.controller.GetEditorSchemas(pluginID, connectionID)
}

// Relationships

func (c *Client) GetRelationships(pluginID, key string) ([]resource.RelationshipDescriptor, error) {
	return c.controller.GetRelationships(pluginID, key)
}

func (c *Client) ResolveRelationships(pluginID, connectionID, key, id, namespace string) ([]resource.ResolvedRelationship, error) {
	return c.controller.ResolveRelationships(pluginID, connectionID, key, id, namespace)
}

// Health

func (c *Client) GetHealth(pluginID, connectionID, key string, data interface{}) (*resource.ResourceHealth, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return c.controller.GetHealth(pluginID, connectionID, key, json.RawMessage(raw))
}

func (c *Client) GetResourceEvents(pluginID, connectionID, key, id, namespace string, limit int32) ([]resource.ResourceEvent, error) {
	return c.controller.GetResourceEvents(pluginID, connectionID, key, id, namespace, limit)
}

