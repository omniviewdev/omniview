package types

import (
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// DiscoveryProvider encapsulates the discovery client lifecycle and discovery logic.
// Implementations manage per-connection client creation, caching, and cleanup internally.
type DiscoveryProvider interface {
	// Discover discovers the available resource types for the given connection.
	Discover(ctx *pkgtypes.PluginContext, connection *pkgtypes.Connection) ([]ResourceMeta, error)

	// RemoveConnection removes and cleans up any resources associated with the connection.
	RemoveConnection(ctx *pkgtypes.PluginContext, connection *pkgtypes.Connection) error
}
