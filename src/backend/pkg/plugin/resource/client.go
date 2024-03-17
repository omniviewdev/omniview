package resource

import (
	rt "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Client is the system/UI facing client for making resource requests to the resource controller.
// We don't really want to expose the other methods of the controller to the outside world, so only
// methods that should exist here are the ones that the UI/other controllers need to interact with.
type IClient interface {
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

	// LoadConnections loads the connections for the resource provider
	LoadConnections(pluginID string) ([]types.Connection, error)

	// ListConnections returns a list of connections for the plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	ListConnections(pluginID string) ([]types.Connection, error)

	// AddConnection adds a new connection for the plugin.
	// The pluginID should match the name of the plugin in the plugin metadata.
	AddConnection(pluginID string, connection types.Connection) error

	// UpdateConnection updates an existing connection for a plugin
	// The pluginID should match the name of the plugin in the plugin metadata.
	UpdateConnection(pluginID string, connection types.Connection) error

	// RemoveConnection removes a connection for a plugin
	// The pluginID should match the name of the plugin in the plugin metadata.
	RemoveConnection(pluginID, connectionID string) error

	// StartConnectionInformer starts an informer for the given connection
	StartConnectionInformer(pluginID, connectionID string) error

	// StopConnectionInformer stops an informer for the given connection
	StopConnectionInformer(pluginID, connectionID string) error
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

func (c *Client) LoadConnections(pluginID string) ([]types.Connection, error) {
	return c.controller.LoadConnections(pluginID)
}

func (c *Client) ListConnections(pluginID string) ([]types.Connection, error) {
	return c.controller.ListConnections(pluginID)
}

func (c *Client) AddConnection(pluginID string, connection types.Connection) error {
	return c.controller.AddConnection(pluginID, connection)
}

func (c *Client) UpdateConnection(pluginID string, connection types.Connection) error {
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
