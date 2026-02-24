package exec

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
// to provide the exec functionality.
type Provider interface {
	// GetSupportedResources returns the supported resource types
	GetSupportedResources(ctx *types.PluginContext) []Handler
	// GetSession returns a session by ID
	GetSession(ctx *types.PluginContext, sessionID string) (*Session, error)
	// ListSessions returns all of the sessions
	ListSessions(ctx *types.PluginContext) ([]*Session, error)
	// CreateSession creates a new session
	CreateSession(ctx *types.PluginContext, opts SessionOptions) (*Session, error)
	// AttachSession attaches a session
	AttachSession(ctx *types.PluginContext, sessionID string) (*Session, []byte, error)
	// DetachSession detaches a session
	DetachSession(ctx *types.PluginContext, sessionID string) (*Session, error)
	// CloseSession closes a session
	CloseSession(ctx *types.PluginContext, sessionID string) error
	// ResizeSession resizes a session
	ResizeSession(ctx *types.PluginContext, sessionID string, cols, rows int32) error
	// Stream starts a new stream to multiplex sessions
	Stream(context.Context, chan StreamInput) (chan StreamOutput, error)
}

type Plugin struct {
	plugin.Plugin
	Impl Provider
}

func (p *Plugin) GRPCServer(_ *plugin.GRPCBroker, s *grpc.Server) error {
	proto.RegisterExecPluginServer(s, &PluginServer{
		log:  hclog.Default(),
		Impl: p.Impl,
	})
	return nil
}

func (p *Plugin) GRPCClient(
	_ context.Context,
	_ *plugin.GRPCBroker,
	c *grpc.ClientConn,
) (interface{}, error) {
	return &PluginClient{client: proto.NewExecPluginClient(c)}, nil
}

func RegisterPlugin(
	p *sdk.Plugin,
	opts PluginOpts,
) error {
	if p == nil {
		return errors.New("plugin is nil")
	}

	handlers := make(map[string]Handler)
	for _, handler := range opts.Handlers {
		handlers[handler.Plugin+"/"+handler.Resource] = handler
	}

	impl := NewManager(
		p.HCLLogger,
		p.SettingsProvider,
		handlers,
	)

	p.RegisterCapability("exec", &Plugin{Impl: impl})
	return nil
}
