package exec

import (
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

type ClientFactory[ClientT any] interface {
	CreateClient(ctx *types.PluginContext) (*ClientT, error)
	RefreshClient(ctx *types.PluginContext, client *ClientT) error
	StartClient(ctx *types.PluginContext, client *ClientT) error
	StopClient(ctx *types.PluginContext, client *ClientT) error
}
