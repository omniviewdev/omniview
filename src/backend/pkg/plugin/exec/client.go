package exec

import (
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/exec"
)

// I HATE THIS. WHY CAN'T I JUST USE THE SAME INSTANCE?????
type Client struct {
	controller Controller
}

func NewClient(controller Controller) *Client {
	return &Client{
		controller: controller,
	}
}

func (c *Client) GetPluginHandlers(plugin string) map[string]sdkexec.HandlerOpts {
	return c.controller.GetPluginHandlers(plugin)
}

func (c *Client) GetHandlers() map[string]map[string]sdkexec.HandlerOpts {
	return c.controller.GetHandlers()
}

func (c *Client) GetHandler(plugin, resource string) *sdkexec.HandlerOpts {
	return c.controller.GetHandler(plugin, resource)
}

func (c *Client) ListPlugins() ([]string, error) {
	return c.controller.ListPlugins()
}

func (c *Client) GetSession(sessionID string) (*sdkexec.Session, error) {
	return c.controller.GetSession(sessionID)
}

func (c *Client) ListSessions() ([]*sdkexec.Session, error) {
	return c.controller.ListSessions()
}

type AttachSessionResult struct {
	Session *sdkexec.Session `json:"session"`
	Buffer  []byte           `json:"buffer"`
}

func (c *Client) AttachSession(sessionID string) (AttachSessionResult, error) {
	session, buffer, err := c.controller.AttachSession(sessionID)
	if err != nil {
		return AttachSessionResult{}, err
	}
	return AttachSessionResult{
		Session: session,
		Buffer:  buffer,
	}, nil
}

func (c *Client) DetachSession(sessionID string) (*sdkexec.Session, error) {
	return c.controller.DetachSession(sessionID)
}

func (c *Client) CreateSession(
	plugin, connection string,
	opts sdkexec.SessionOptions,
) (*sdkexec.Session, error) {
	return c.controller.CreateSession(plugin, connection, opts)
}

type CreateTerminalOptions struct {
	Labels  map[string]string `json:"labels"`
	Command []string          `json:"command"`
}

func (c *Client) CreateTerminal(opts CreateTerminalOptions) (*sdkexec.Session, error) {
	sessionopts := sdkexec.SessionOptions{
		Command: opts.Command,
		TTY:     true,
		Labels:  opts.Labels,
	}

	return c.controller.CreateSession("local", "local", sessionopts)
}

func (c *Client) CloseSession(sessionID string) error {
	return c.controller.CloseSession(sessionID)
}

func (c *Client) WriteSession(sessionID string, input string) error {
	return c.controller.WriteSession(sessionID, []byte(input))
}

func (c *Client) ResizeSession(sessionID string, rows, cols uint16) error {
	return c.controller.ResizeSession(sessionID, rows, cols)
}
