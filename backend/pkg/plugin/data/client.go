package data

// Client is the Wails-facing client for the plugin data store.
type Client struct {
	controller Controller
}

// NewClient creates a new data store client.
func NewClient(controller Controller) *Client {
	return &Client{
		controller: controller,
	}
}

func (c *Client) Get(pluginID, key string) (any, error) {
	return c.controller.Get(pluginID, key)
}

func (c *Client) Set(pluginID, key string, value any) error {
	return c.controller.Set(pluginID, key, value)
}

func (c *Client) Delete(pluginID, key string) error {
	return c.controller.Delete(pluginID, key)
}

func (c *Client) Keys(pluginID string) ([]string, error) {
	return c.controller.Keys(pluginID)
}
