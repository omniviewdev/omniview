package exec

import (
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

// PluginOpts contains the options for the exec plugin.
type PluginOpts struct {
	Handlers []Handler `json:"handlers"`
}

// Handler handles performs running commands and creating sessions for a resource.
type Handler struct {
	Plugin         string                          `json:"plugin"`
	Resource       string                          `json:"resource"`
	TargetBuilder  sdkresource.ActionTargetBuilder `json:"target_builder"`
	DefaultCommand []string                        `json:"default_command"`
	TTYHandler     TTYHandler                      `json:"-"`
	CommandHandler CommandHandler                  `json:"-"`
	// if the handler supports resizing, it will be sent through the channel instead of the pty file
	HandlesResize bool `json:"-"`
}

func (h Handler) ToProto() *proto.ExecHandler {
	return &proto.ExecHandler{
		Plugin:         h.Plugin,
		Resource:       h.Resource,
		TargetBuilder:  h.TargetBuilder.ToProto(),
		DefaultCommand: h.DefaultCommand,
	}
}

func HandlerFromProto(p *proto.ExecHandler) Handler {
	return Handler{
		Plugin:         p.GetPlugin(),
		Resource:       p.GetResource(),
		TargetBuilder:  sdkresource.ActionTargetBuilderFromProto(p.GetTargetBuilder()),
		DefaultCommand: p.GetDefaultCommand(),
	}
}

func (h Handler) ID() string {
	return h.Plugin + "/" + h.Resource
}

func (h Handler) String() string {
	return h.ID()
}
