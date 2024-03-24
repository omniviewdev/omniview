package resource

import (
	"errors"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/factories"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// NewDiscoveryFactory is provided to the plugin server to be able to generate clients for discovering
// the available resources in the resource backend.
func NewDiscoveryClientFactory() factories.ResourceDiscoveryClientFactory[DiscoveryClient] {
	return &discoveryClientFactory{}
}

type discoveryClientFactory struct{}

var _ factories.ResourceDiscoveryClientFactory[DiscoveryClient] = &discoveryClientFactory{}

// CreateClient creates a new client for interacting with the API server for a given cluster, given a
// path to the kubeconfig file and the context to use.
func (f *discoveryClientFactory) CreateClient(
	ctx *types.PluginContext,
) (*DiscoveryClient, error) {
	if ctx.Connection == nil {
		return nil, errors.New("connection context is required")
	}

	var client DiscoveryClient

	// Perform your client creation logic here
	// ...

	return &client, nil
}

// RefreshClient takes in an existing client, and refreshes it's connection to the resource backend.
// If the client is not able to be refreshed, or does not need to be, you can keep the method empty.
func (f *discoveryClientFactory) RefreshClient(_ *types.PluginContext, _ *DiscoveryClient) error {
	return nil
}

// StartClient starts the given client, and returns an error if the client could not be started.
// If the client does not need to be started, you can keep the method empty.
func (f *discoveryClientFactory) StartClient(_ *types.PluginContext, _ *DiscoveryClient) error {
	return nil
}

// StopClient stops the given client, and returns an error if the client could not be stopped.
// If the client does not need to be stopped, you can keep the method empty.
func (f *discoveryClientFactory) StopClient(_ *types.PluginContext, _ *DiscoveryClient) error {
	return nil
}
