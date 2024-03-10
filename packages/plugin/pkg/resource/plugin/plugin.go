package plugin

import (
	"net/rpc"

	goplugin "github.com/hashicorp/go-plugin"

	"github.com/omniviewdev/plugin/pkg/resource/types"
)

// This is the implementation of plugin.Plugin so we can serve/consume this.
type ResourcePlugin struct {
	// Concrete implementation, written in Go. This is only used for plugins
	// that are written in Go.
	Impl types.ResourceProvider
}

func (p *ResourcePlugin) Server(*goplugin.MuxBroker) (interface{}, error) {
	return &ResourcePlugin{Impl: p.Impl}, nil
}

func (ResourcePlugin) Client(_ *goplugin.MuxBroker, c *rpc.Client) (interface{}, error) {
	return &ResourcePluginClient{client: c}, nil
}

type InformerPlugin struct {
	// Concrete implementation, written in Go. This is only used for plugins
	// that are written in Go.
	Impl types.InformerProvider
}

func (p *InformerPlugin) Server(*goplugin.MuxBroker) (interface{}, error) {
	return &InformerPlugin{Impl: p.Impl}, nil
}

func (InformerPlugin) Client(_ *goplugin.MuxBroker, c *rpc.Client) (interface{}, error) {
	return &InformerPluginClient{ResourcePluginClient: ResourcePluginClient{client: c}}, nil
}
