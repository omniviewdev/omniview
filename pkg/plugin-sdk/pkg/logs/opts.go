package logs

import (
	"io"

	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/resource/types"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/proto"
)

// PluginOpts contains the options for the log plugin.
type PluginOpts struct {
	// Handlers maps resource keys to their log handlers.
	// For example: "core::v1::Pod" -> Handler
	Handlers map[string]Handler `json:"handlers"`

	// SourceResolvers maps resource keys to source resolvers that resolve
	// group resources into individual log sources.
	// For example: "apps::v1::Deployment" -> SourceResolver
	SourceResolvers map[string]SourceResolver `json:"-"`
}

// SourceBuilderFunc builds LogSources from resource data for direct handler streaming.
// Plugins implement this to translate their resource data into properly-labeled sources
// that the LogHandlerFunc can consume. For example, a K8s plugin extracts pod name,
// namespace, and container names from the pod spec.
type SourceBuilderFunc func(
	resourceID string,
	resourceData map[string]interface{},
	opts LogSessionOptions,
) []LogSource

// Handler describes a log handler for a specific resource type.
type Handler struct {
	Plugin        string                          `json:"plugin"`
	Resource      string                          `json:"resource"`
	TargetBuilder sdkresource.ActionTargetBuilder `json:"target_builder"`
	Handler       LogHandlerFunc                  `json:"-"`
	SourceBuilder SourceBuilderFunc               `json:"-"`
}

func (h Handler) ToProto() *proto.LogHandler {
	return &proto.LogHandler{
		Plugin:        h.Plugin,
		Resource:      h.Resource,
		TargetBuilder: h.TargetBuilder.ToProto(),
	}
}

func HandlerFromProto(p *proto.LogHandler) Handler {
	return Handler{
		Plugin:        p.GetPlugin(),
		Resource:      p.GetResource(),
		TargetBuilder: sdkresource.ActionTargetBuilderFromProto(p.GetTargetBuilder()),
	}
}

func (h Handler) ID() string {
	return h.Plugin + "/" + h.Resource
}

// LogHandlerFunc opens a log stream for a single source, returning an io.ReadCloser.
type LogHandlerFunc func(ctx *types.PluginContext, req LogStreamRequest) (io.ReadCloser, error)

// SourceResolver resolves a "group" resource into individual log sources.
type SourceResolver func(
	ctx *types.PluginContext,
	resourceData map[string]interface{},
	opts SourceResolverOptions,
) (*SourceResolverResult, error)

// SourceResolverOptions configures how sources are resolved.
type SourceResolverOptions struct {
	Watch  bool              // if true, also return a channel for source changes
	Target string            // optional filter (e.g., specific container name)
	Params map[string]string // plugin-specific resolver params
}

// SourceResolverResult contains the resolved sources and optional event channel.
type SourceResolverResult struct {
	Sources []LogSource         // current sources
	Events  <-chan SourceEvent  // source lifecycle stream (nil if Watch=false)
}
