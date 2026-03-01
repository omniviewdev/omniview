package settings

import (
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// Service is the system/UI facing client for making settings requests to the settings controller.
type Service interface {
	// ListPlugins returns a list of all the plugins that are registered with the settings controller
	ListPlugins() ([]string, error)

	// Values returns a list of all of the values calculated in the current setting store
	Values() map[string]any

	// PluginValues returns a list of all of the values calculated in the plugin's setting store
	PluginValues(plugin string) map[string]any

	// ListSettings returns the settings store
	ListSettings(plugin string) map[string]pkgsettings.Setting

	// GetSetting returns the setting by ID. This ID should be in the form of a dot separated string
	// that represents the path to the setting. For example, "appearance.theme"
	GetSetting(plugin, id string) (pkgsettings.Setting, error)

	// SetSetting sets the value of the setting by ID
	SetSetting(plugin, id string, value any) error

	// SetSettings sets multiple settings at once
	SetSettings(plugin string, settings map[string]any) error
}

// TODO - I really do not like this. I wish we could just expose the interface to the IDE instead
// of having to manually embed the same controller into a struct and declare pointer recievers
// for each method.
//
// Currently a limitation of Wails it seems, unless I'm missing something.
type Client struct {
	controller Controller
}

func NewClient(controller Controller) *Client {
	return &Client{
		controller: controller,
	}
}

var _ Service = (*Client)(nil)

func (c *Client) Values() map[string]any {
	return c.controller.Values()
}

func (c *Client) PluginValues(plugin string) map[string]any {
	return c.controller.PluginValues(plugin)
}

func (c *Client) ListPlugins() ([]string, error) {
	return c.controller.ListPlugins()
}

func (c *Client) ListSettings(plugin string) map[string]pkgsettings.Setting {
	return c.controller.ListSettings(plugin)
}

func (c *Client) GetSetting(plugin, id string) (pkgsettings.Setting, error) {
	return c.controller.GetSetting(plugin, id)
}

func (c *Client) SetSetting(plugin, id string, value any) error {
	return c.controller.SetSetting(plugin, id, value)
}

func (c *Client) SetSettings(plugin string, settings map[string]any) error {
	return c.controller.SetSettings(plugin, settings)
}
