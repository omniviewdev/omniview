package resource

import (
	rt "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Client is the system/UI facing client for making resource requests to the resource controller.
// We don't really want to expose the other methods of the controller to the outside world, so only
// methods that should exist here are the ones that the UI/other controllers need to interact with.
type IClient interface {
	// ListPlugins returns a list of all the plugins that are registered with the resource controller
	ListPlugins() ([]string, error)

	// Get performs a get requests for a resource against a resource backend plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	Get(pluginID, connectionID, key string, input rt.GetInput) (*rt.GetResult, error)

	// List performs a list requests for a resource against a resource backend plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	List(pluginID, connectionID, key string, input rt.ListInput) (*rt.ListResult, error)

	// Find performs a find requests for a resource against a resource backend plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	Find(pluginID, connectionID, key string, input rt.FindInput) (*rt.FindResult, error)

	// Create performs a create requests for a resource against a resource backend plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	Create(pluginID, connectionID, key string, input rt.CreateInput) (*rt.CreateResult, error)

	// Update performs a update requests for a resource against a resource backend plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	Update(pluginID, connectionID, key string, input rt.UpdateInput) (*rt.UpdateResult, error)

	// Delete performs a delete requests for a resource against a resource backend plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	Delete(pluginID, connectionID, key string, input rt.DeleteInput) (*rt.DeleteResult, error)

	// StartConnection starts a connection for a plugin
	StartConnection(pluginID, connectionID string) (types.ConnectionStatus, error)

	// StopConnection stops a connection for a plugin
	StopConnection(pluginID, connectionID string) (types.Connection, error)

	// LoadConnections loads the connections for the resource provider
	LoadConnections(pluginID string) ([]types.Connection, error)

	// ListConnections returns a list of connections for the plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	ListConnections(pluginID string) ([]types.Connection, error)

	// GetConnection returns a connection for the plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	GetConnection(pluginID, connectionID string) (types.Connection, error)

	// GetConnectionNamespaces returns a list of connection namespaces for a plugin.
	GetConnectionNamespaces(pluginID, connectionID string) ([]string, error)

	// AddConnection adds a new connection for the plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	AddConnection(pluginID string, connection types.Connection) error

	// UpdateConnection updates an existing connection for a plugin
	// The pluginID should match the name of the plugin in the plugin metadata.
	UpdateConnection(pluginID string, connection types.Connection) (types.Connection, error)

	// RemoveConnection removes a connection for a plugin
	// The pluginID should match the name of the plugin in the plugin metadata.
	RemoveConnection(pluginID, connectionID string) error

	// StartConnectionInformer starts an informer for the given connection
	StartConnectionInformer(pluginID, connectionID string) error

	// StopConnectionInformer stops an informer for the given connection
	StopConnectionInformer(pluginID, connectionID string) error

	// GetResourceGroups
	GetResourceGroups(pluginID, connectionID string) map[string]rt.ResourceGroup

	// GetResourceGroup
	GetResourceGroup(pluginID, groupID string) (rt.ResourceGroup, error)

	// GetResourceTypes returns a map of all the resource types that are available to the resource controller
	GetResourceTypes(pluginID, connectionID string) map[string]rt.ResourceMeta

	// GetResourceType returns the resource type information by it's string representation
	// For example, "core::v1::Pod" or "ec2::2012-12-01::EC2Instance"
	GetResourceType(pluginID, typeID string) (*rt.ResourceMeta, error)

	// HasResourceType checks to see if the resource type exists
	HasResourceType(pluginID, typeID string) bool

	// GetResourceDefinition returns the resource definition for a given resource
	GetResourceDefinition(pluginID, typeID string) (rt.ResourceDefinition, error)

	// GetActions returns available actions for a resource type
	GetActions(pluginID, connectionID, key string) ([]rt.ActionDescriptor, error)

	// ExecuteAction executes a named action on a resource
	ExecuteAction(pluginID, connectionID, key, actionID string, input rt.ActionInput) (*rt.ActionResult, error)

	// StreamAction executes a streaming action, returning an operation ID for event subscription
	StreamAction(pluginID, connectionID, key, actionID string, input rt.ActionInput) (string, error)

	// GetLayout returns the layout for the plugin
	GetLayout(pluginID string, layoutID string) ([]rt.LayoutItem, error)

	// GetDefaultLayout returns the default layout for the plugin
	GetDefaultLayout(pluginID string) ([]rt.LayoutItem, error)

	// SetLayout sets a single layout for a plugin
	SetLayout(pluginID string, layoutID string, layout []rt.LayoutItem) error

	// GetEditorSchemas returns editor schemas for the given plugin and connection
	GetEditorSchemas(pluginID, connectionID string) ([]rt.EditorSchema, error)

	// GetInformerState returns the current informer state summary for a connection
	GetInformerState(pluginID, connectionID string) (*rt.InformerConnectionSummary, error)

	// EnsureInformerForResource ensures an informer is running for a specific resource type
	EnsureInformerForResource(pluginID, connectionID, resourceKey string) error

	// SubscribeResource registers frontend interest in live ADD/UPDATE/DELETE events for a resource.
	SubscribeResource(pluginID, connectionID, resourceKey string) error

	// UnsubscribeResource removes frontend interest in live events for a resource.
	UnsubscribeResource(pluginID, connectionID, resourceKey string) error

	// ListAllConnections returns all connections across all plugins
	ListAllConnections() (map[string][]types.Connection, error)
}

// I HATE THIS. WHY CAN'T I JUST USE THE SAME INSTANCE?????
type Client struct {
	controller Controller
}

func NewClient(controller Controller) *Client {
	return &Client{
		controller: controller,
	}
}

func (c *Client) ListPlugins() ([]string, error) {
	return c.controller.ListPlugins()
}

func (c *Client) Get(
	pluginID, connectionID, key string,
	input rt.GetInput,
) (*rt.GetResult, error) {
	return c.controller.Get(pluginID, connectionID, key, input)
}

func (c *Client) List(
	pluginID, connectionID, key string,
	input rt.ListInput,
) (*rt.ListResult, error) {
	return c.controller.List(pluginID, connectionID, key, input)
}

func (c *Client) Find(
	pluginID, connectionID, key string,
	input rt.FindInput,
) (*rt.FindResult, error) {
	return c.controller.Find(pluginID, connectionID, key, input)
}

func (c *Client) Create(
	pluginID, connectionID, key string,
	input rt.CreateInput,
) (*rt.CreateResult, error) {
	return c.controller.Create(pluginID, connectionID, key, input)
}

func (c *Client) Update(
	pluginID, connectionID, key string,
	input rt.UpdateInput,
) (*rt.UpdateResult, error) {
	return c.controller.Update(pluginID, connectionID, key, input)
}

func (c *Client) Delete(
	pluginID, connectionID, key string,
	input rt.DeleteInput,
) (*rt.DeleteResult, error) {
	return c.controller.Delete(pluginID, connectionID, key, input)
}

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

func (c *Client) GetConnection(pluginID, connectionID string) (types.Connection, error) {
	return c.controller.GetConnection(pluginID, connectionID)
}

func (c *Client) GetConnectionNamespaces(pluginID, connectionID string) ([]string, error) {
	return c.controller.GetConnectionNamespaces(pluginID, connectionID)
}

func (c *Client) AddConnection(pluginID string, connection types.Connection) error {
	return c.controller.AddConnection(pluginID, connection)
}

func (c *Client) UpdateConnection(
	pluginID string,
	connection types.Connection,
) (types.Connection, error) {
	return c.controller.UpdateConnection(pluginID, connection)
}

func (c *Client) RemoveConnection(pluginID, connectionID string) error {
	return c.controller.RemoveConnection(pluginID, connectionID)
}

func (c *Client) StartConnectionInformer(pluginID, connectionID string) error {
	return c.controller.StartConnectionInformer(pluginID, connectionID)
}

func (c *Client) StopConnectionInformer(pluginID, connectionID string) error {
	return c.controller.StopConnectionInformer(pluginID, connectionID)
}

func (c *Client) GetResourceGroups(pluginID, connectionID string) map[string]rt.ResourceGroup {
	return c.controller.GetResourceGroups(pluginID, connectionID)
}

func (c *Client) GetResourceGroup(pluginID, groupID string) (rt.ResourceGroup, error) {
	return c.controller.GetResourceGroup(pluginID, groupID)
}

func (c *Client) GetResourceTypes(pluginID, connectionID string) map[string]rt.ResourceMeta {
	return c.controller.GetResourceTypes(pluginID, connectionID)
}

func (c *Client) GetResourceType(pluginID, typeID string) (*rt.ResourceMeta, error) {
	return c.controller.GetResourceType(pluginID, typeID)
}

func (c *Client) HasResourceType(pluginID, typeID string) bool {
	return c.controller.HasResourceType(pluginID, typeID)
}

func (c *Client) GetResourceDefinition(pluginID, typeID string) (rt.ResourceDefinition, error) {
	return c.controller.GetResourceDefinition(pluginID, typeID)
}

func (c *Client) GetActions(pluginID, connectionID, key string) ([]rt.ActionDescriptor, error) {
	return c.controller.GetActions(pluginID, connectionID, key)
}

func (c *Client) ExecuteAction(
	pluginID, connectionID, key, actionID string,
	input rt.ActionInput,
) (*rt.ActionResult, error) {
	return c.controller.ExecuteAction(pluginID, connectionID, key, actionID, input)
}

func (c *Client) StreamAction(
	pluginID, connectionID, key, actionID string,
	input rt.ActionInput,
) (string, error) {
	return c.controller.StreamAction(pluginID, connectionID, key, actionID, input)
}

func (c *Client) GetLayout(pluginID string, layoutID string) ([]rt.LayoutItem, error) {
	return c.controller.GetLayout(pluginID, layoutID)
}

func (c *Client) GetDefaultLayout(pluginID string) ([]rt.LayoutItem, error) {
	return c.controller.GetDefaultLayout(pluginID)
}

func (c *Client) SetLayout(pluginID string, layoutID string, layout []rt.LayoutItem) error {
	return c.controller.SetLayout(pluginID, layoutID, layout)
}

func (c *Client) GetEditorSchemas(pluginID, connectionID string) ([]rt.EditorSchema, error) {
	return c.controller.GetEditorSchemas(pluginID, connectionID)
}

func (c *Client) GetInformerState(pluginID, connectionID string) (*rt.InformerConnectionSummary, error) {
	return c.controller.GetInformerState(pluginID, connectionID)
}

func (c *Client) EnsureInformerForResource(pluginID, connectionID, resourceKey string) error {
	return c.controller.EnsureInformerForResource(pluginID, connectionID, resourceKey)
}

func (c *Client) SubscribeResource(pluginID, connectionID, resourceKey string) error {
	return c.controller.SubscribeResource(pluginID, connectionID, resourceKey)
}

func (c *Client) UnsubscribeResource(pluginID, connectionID, resourceKey string) error {
	return c.controller.UnsubscribeResource(pluginID, connectionID, resourceKey)
}

func (c *Client) ListAllConnections() (map[string][]types.Connection, error) {
	return c.controller.ListAllConnections()
}
