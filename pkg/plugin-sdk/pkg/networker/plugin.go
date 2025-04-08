package networker

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
	PluginID = "networker"
)

type PortForwardProvider interface {
	GetSupportedPortForwardTargets(*types.PluginContext) []string
	GetPortForwardSession(*types.PluginContext, string) (*PortForwardSession, error)
	ListPortForwardSessions(*types.PluginContext) ([]*PortForwardSession, error)
	FindPortForwardSessions(
		*types.PluginContext,
		FindPortForwardSessionRequest,
	) ([]*PortForwardSession, error)
	StartPortForwardSession(
		*types.PluginContext,
		PortForwardSessionOptions,
	) (*PortForwardSession, error)
	ClosePortForwardSession(*types.PluginContext, string) (*PortForwardSession, error)
}

// Provider is the interface satisfied by the plugin server and client
// to provide the networker functionality.
type Provider interface {
	PortForwardProvider
}

type Plugin struct {
	plugin.Plugin
	Impl Provider
}

func (p *Plugin) GRPCServer(_ *plugin.GRPCBroker, s *grpc.Server) error {
	proto.RegisterNetworkerPluginServer(s, &PluginServer{log: hclog.Default(), Impl: p.Impl})
	return nil
}

func (p *Plugin) GRPCClient(
	_ context.Context,
	_ *plugin.GRPCBroker,
	c *grpc.ClientConn,
) (interface{}, error) {
	return &PluginClient{client: proto.NewNetworkerPluginClient(c)}, nil
}

func RegisterPlugin(
	p *sdk.Plugin,
	opts PluginOpts,
) error {
	if p == nil {
		return errors.New("plugin is nil")
	}

	impl := NewManager(
		p.SettingsProvider,
		opts,
	)

	p.RegisterCapability(PluginID, &Plugin{Impl: impl})
	return nil
}
