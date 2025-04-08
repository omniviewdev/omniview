package factories

import (
	pkgtypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// InformerFactory is a factory for creating informers for a given resource connection.
type InformerFactory[ClientT, InformerT any] interface {
	// CreateInformer creates a new informer for a given resource connection.
	CreateInformer(
		ctx *pkgtypes.PluginContext,
		connection *pkgtypes.Connection,
		client *ClientT,
	) (InformerT, error)
}
