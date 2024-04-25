package ui

type Client struct {
	manager *componentManager
}

func NewClient(manager *componentManager) *Client {
	return &Client{
		manager: manager,
	}
}

type GetPluginComponentsInput struct {
	Plugin string `json:"plugin"`
}

// Get all the registered components for a plugin.
func (c *Client) GetPluginComponents(
	params GetPluginComponentsInput,
) map[string][]ResourceComponent {
	store := c.manager.GetResourceComponentStore()
	return store.GetComponentsByResource(params.Plugin)
}

type GetResourceComponentsInput struct {
	Plugin   string `json:"plugin"`
	Resource string `json:"resource"`
}

// Get all the registered components for a plugin's resource.
func (c *Client) GetResourceComponents(params GetResourceComponentsInput) []ResourceComponent {
	store := c.manager.GetResourceComponentStore()
	return store.GetComponentsForResource(params.Plugin, params.Resource)
}

type GetResourceAreaComponentInput struct {
	Plugin   string                `json:"plugin"`
	Resource string                `json:"resource"`
	Area     ResourceComponentArea `json:"area"`
}

// Get the preferred component to display for the resource area.
func (c *Client) GetResourceAreaComponent(params GetResourceAreaComponentInput) *ResourceComponent {
	store := c.manager.GetResourceComponentStore()
	components := store.GetComponentsForResource(params.Plugin, params.Resource)
	for _, component := range components {
		if component.Area == params.Area {
			return &component
		}
	}
	return nil
}
