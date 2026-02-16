package plugin

import (
	"context"

	"github.com/hashicorp/go-plugin"
	pkgsettings "github.com/omniviewdev/settings"
	"google.golang.org/grpc"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

// This is the implementation of plugin.Plugin so we can serve/consume this.
type ResourcePlugin struct {
	plugin.Plugin
	// Concrete implementation, written in Go. This is only used for plugins
	// that are written in Go.
	Impl             types.ResourceProvider
	SettingsProvider pkgsettings.Provider
}

func (p *ResourcePlugin) GRPCServer(_ *plugin.GRPCBroker, s *grpc.Server) error {
	proto.RegisterResourcePluginServer(s, &ResourcePluginServer{
		Impl:             p.Impl,
		settingsProvider: p.SettingsProvider,
	})
	return nil
}

func (p *ResourcePlugin) GRPCClient(
	_ context.Context,
	_ *plugin.GRPCBroker,
	c *grpc.ClientConn,
) (interface{}, error) {
	return &ResourcePluginClient{client: proto.NewResourcePluginClient(c)}, nil
}
