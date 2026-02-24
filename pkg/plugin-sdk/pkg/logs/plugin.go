package logs

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

// Provider is the interface satisfied by the plugin server and client
// to provide log viewing functionality.
type Provider interface {
	GetSupportedResources(ctx *types.PluginContext) []Handler
	CreateSession(ctx *types.PluginContext, opts CreateSessionOptions) (*LogSession, error)
	GetSession(ctx *types.PluginContext, sessionID string) (*LogSession, error)
	ListSessions(ctx *types.PluginContext) ([]*LogSession, error)
	CloseSession(ctx *types.PluginContext, sessionID string) error
	UpdateSessionOptions(ctx *types.PluginContext, sessionID string, opts LogSessionOptions) (*LogSession, error)
	Stream(ctx context.Context, in chan StreamInput) (chan StreamOutput, error)
}

// Plugin implements the hashicorp go-plugin interfaces for log capability.
type Plugin struct {
	plugin.Plugin
	Impl Provider
}

func (p *Plugin) GRPCServer(_ *plugin.GRPCBroker, s *grpc.Server) error {
	proto.RegisterLogPluginServer(s, &PluginServer{log: hclog.Default(), Impl: p.Impl})
	return nil
}

func (p *Plugin) GRPCClient(
	_ context.Context,
	_ *plugin.GRPCBroker,
	c *grpc.ClientConn,
) (interface{}, error) {
	return &PluginClient{client: proto.NewLogPluginClient(c)}, nil
}

// RegisterPlugin registers the log capability with the plugin system.
func RegisterPlugin(
	p *sdk.Plugin,
	opts PluginOpts,
) error {
	if p == nil {
		return errors.New("plugin is nil")
	}

	handlers := make(map[string]Handler)
	for key, handler := range opts.Handlers {
		handlers[handler.Plugin+"/"+key] = handler
	}

	resolvers := make(map[string]SourceResolver)
	for key, resolver := range opts.SourceResolvers {
		resolvers[key] = resolver
	}

	impl := NewManager(
		p.HCLLogger,
		p.SettingsProvider,
		handlers,
		resolvers,
	)

	p.RegisterCapability("log", &Plugin{Impl: impl})
	return nil
}
