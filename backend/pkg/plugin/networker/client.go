package networker

import (
	sdknetworker "github.com/omniviewdev/plugin-sdk/pkg/networker"
)

type Client struct {
	controller Controller
}

func NewClient(controller Controller) *Client {
	return &Client{
		controller: controller,
	}
}

func (c *Client) GetSupportedPortForwardTargets(plugin string) []string {
	return c.controller.GetSupportedPortForwardTargets(plugin)
}

func (c *Client) GetPortForwardSession(
	sessionID string,
) (*sdknetworker.PortForwardSession, error) {
	return c.controller.GetPortForwardSession(sessionID)
}

func (c *Client) ListPortForwardSessions(
	pluginID, connectionID string,
) ([]*sdknetworker.PortForwardSession, error) {
	return c.controller.ListPortForwardSessions(pluginID, connectionID)
}

func (c *Client) ListAllPortForwardSessions() ([]*sdknetworker.PortForwardSession, error) {
	return c.controller.ListAllPortForwardSessions()
}

func (c *Client) FindPortForwardSessions(
	pluginID, connectionID string,
	request sdknetworker.FindPortForwardSessionRequest,
) ([]*sdknetworker.PortForwardSession, error) {
	return c.controller.FindPortForwardSessions(pluginID, connectionID, request)
}

// StartResourcePortForwardingSession starts a port forwarding session.
func (c *Client) StartResourcePortForwardingSession(
	pluginID, connectionID string,
	opts sdknetworker.PortForwardSessionOptions,
) (*sdknetworker.PortForwardSession, error) {
	return c.controller.StartResourcePortForwardingSession(pluginID, connectionID, opts)
}

// ClosePortForwardSession closes a port forward session.
func (c *Client) ClosePortForwardSession(sessionID string,
) (*sdknetworker.PortForwardSession, error) {
	return c.controller.ClosePortForwardSession(sessionID)
}
