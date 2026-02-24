package logs

import (
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/logs"
)

type Client struct {
	controller Controller
}

func NewClient(controller Controller) *Client {
	return &Client{
		controller: controller,
	}
}

func (c *Client) GetSupportedResources(pluginID string) []sdklogs.Handler {
	return c.controller.GetSupportedResources(pluginID)
}

func (c *Client) CreateSession(
	plugin, connectionID string,
	opts sdklogs.CreateSessionOptions,
) (*sdklogs.LogSession, error) {
	return c.controller.CreateSession(plugin, connectionID, opts)
}

func (c *Client) GetSession(sessionID string) (*sdklogs.LogSession, error) {
	return c.controller.GetSession(sessionID)
}

func (c *Client) ListSessions() ([]*sdklogs.LogSession, error) {
	return c.controller.ListSessions()
}

func (c *Client) CloseSession(sessionID string) error {
	return c.controller.CloseSession(sessionID)
}

func (c *Client) PauseSession(sessionID string) error {
	return c.controller.SendCommand(sessionID, sdklogs.StreamCommandPause)
}

func (c *Client) ResumeSession(sessionID string) error {
	return c.controller.SendCommand(sessionID, sdklogs.StreamCommandResume)
}

func (c *Client) UpdateSessionOptions(
	sessionID string,
	opts sdklogs.LogSessionOptions,
) (*sdklogs.LogSession, error) {
	return c.controller.UpdateSessionOptions(sessionID, opts)
}
