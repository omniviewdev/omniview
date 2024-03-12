package factories

import (
	"github.com/omniviewdev/plugin/pkg/types"
)

// ResourceDiscoveryClientFactory is a factory to create and refresh clients
// that can discover the available resource types within a resource namespace.
type ResourceDiscoveryClientFactory[ClientT any] interface {
	// CreateClient creates a new discovery client with the given options, and returns
	// the client and an error if the client could not be created.
	CreateClient(ctx types.PluginContext, authContext string) (*ClientT, error)

	// RefreshClient refreshes the given client with the given options, and returns
	// the client and an error if the client could not be refreshed.
	RefreshClient(ctx types.PluginContext, authContext string, client *ClientT) error

	// StartClient starts the given client, and returns an error if the client could not be started.
	// This method should be called when the client is needed.
	//
	// If the client does not need to be started, this method should return nil. This method will
	// be called on every sync operation, and as such should be idempotent.
	StartClient(ctx types.PluginContext, client *ClientT) error

	// StopClient stops the given client, and returns an error if the client could not be stopped.
	// This method should be called when the client is no longer needed.
	//
	// If the client does not need to be stopped, this method should return nil. This method should be
	// idempotent.
	StopClient(ctx types.PluginContext, client *ClientT) error
}
