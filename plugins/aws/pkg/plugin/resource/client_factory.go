package resource

import (
	"errors"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/factories"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// NewClientFactory is provided to the plugin server to be able to generate clients for interacting
// with the resource backend. The server will call this method when it needs a new client for a
// connection.
func NewClientFactory() factories.ResourceClientFactory[Client] {
	return &clientFactory{}
}

type clientFactory struct{}

var _ factories.ResourceClientFactory[Client] = &clientFactory{}

// CreateClient creates a new client for interacting with the API server for a given cluster, given a
// path to the kubeconfig file and the context to use.
func (f *clientFactory) CreateClient(
	ctx *types.PluginContext,
) (*Client, error) {
	if ctx.Connection == nil {
		return nil, errors.New("connection context is required")
	}

	var client Client

	// Perform your client creation logic here
	// ...

	return &client, nil
}

// RefreshClient takes in an existing client, and refreshes it's connection to the resource backend.
// If the client is not able to be refreshed, or does not need to be, you can keep the method empty.
func (f *clientFactory) RefreshClient(_ *types.PluginContext, _ *Client) error {
	return nil
}

// StartClient starts the given client, and returns an error if the client could not be started.
// If the client does not need to be started, you can keep the method empty.
func (f *clientFactory) StartClient(_ *types.PluginContext, _ *Client) error {
	return nil
}

// StopClient stops the given client, and returns an error if the client could not be stopped.
// If the client does not need to be stopped, you can keep the method empty.
func (f *clientFactory) StopClient(_ *types.PluginContext, _ *Client) error {
	return nil
}
