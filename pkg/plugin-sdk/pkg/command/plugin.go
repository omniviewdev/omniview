package command

import (
	"context"
	"errors"

	"github.com/hashicorp/go-hclog"
	"github.com/hashicorp/go-plugin"
	"google.golang.org/grpc"

	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

const (
	PluginID = "command"
)

type ProviderImpl interface {
	Call(ctx *types.PluginContext, target string, payload []byte) ([]byte, error)
}

// Provider is the interface satisfied by the plugin server and client
// to provide the general functionality.
type Provider interface {
	ProviderImpl
}

type Plugin struct {
	plugin.Plugin
	Impl Provider
}

func (p *Plugin) GRPCServer(_ *plugin.GRPCBroker, s *grpc.Server) error {
	proto.RegisterCommandServer(s, &PluginServer{log: hclog.Default(), Impl: p.Impl})
	return nil
}

func (p *Plugin) GRPCClient(
	_ context.Context,
	_ *plugin.GRPCBroker,
	c *grpc.ClientConn,
) (interface{}, error) {
	return &PluginClient{client: proto.NewCommandClient(c)}, nil
}

func RegisterPlugin(
	p *sdk.Plugin,
	opts PluginOpts,
) error {
	if p == nil {
		return errors.New("plugin is nil")
	}

	impl := NewManager(
		p.HCLLogger,
		p.SettingsProvider,
		opts.Handlers,
	)

	p.RegisterCapability(PluginID, &Plugin{Impl: impl})
	return nil
}
