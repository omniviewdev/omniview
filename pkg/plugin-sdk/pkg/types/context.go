package types

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/settings"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

const (
	DefaultTimeout         = 10 * time.Second
	DefaultMaxRetries      = 3
	DefaultBackoffInterval = 1 * time.Second
)

type pluginCtxKey struct{}

// PluginContext holds contextual data for requests made to a plugin.
type PluginContext struct {
	// Current context
	Context context.Context `json:"-"`

	// RequestOptions are the options that were set for the request.
	RequestOptions *RequestOptions `json:"request_options"`

	// Connection holds the identifier of the auth context for the plugin.
	Connection *Connection `json:"connection"`

	// The resource context for the request, if available
	ResourceContext *ResourceContext `json:"resource_context"`

	// The plugin settings for the request
	PluginConfig settings.Provider `json:"-"`

	// GlobalSettings are settings that are accessible to all plugins, taken
	// from the global settings in the IDE section
	GlobalConfig *config.GlobalConfig `json:"global_config"`

	// Unique ID for the request
	RequestID string `json:"request_id"`

	// The ID of the requester
	RequesterID string `json:"requester_id"`
}

func WithPluginContext(ctx context.Context, pluginContext *PluginContext) context.Context {
	pluginContext.Context = nil
	return context.WithValue(ctx, pluginCtxKey{}, pluginContext)
}

func PluginContextFromContext(ctx context.Context) *PluginContext {
	v := ctx.Value(pluginCtxKey{})
	if v == nil {
		return nil
	}
	pluginctx := v.(*PluginContext)
	if pluginctx.Context == nil {
		pluginctx.Context = ctx
	}
	return pluginctx
}

// SerializePluginContext serializes the PluginContext into a JSON string. Used to pass
// the context between the IDE and the plugin.
func SerializePluginContext(pc *PluginContext) (string, error) {
	data, err := json.Marshal(pc)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// DeserializePluginContext deserializes the JSON string back into a PluginContext. Used to pass
// the context between the IDE and the plugin.
func DeserializePluginContext(data string) (*PluginContext, error) {
	pc := &PluginContext{}
	if err := json.Unmarshal([]byte(data), pc); err != nil {
		return nil, err
	}
	return pc, nil
}

// Construct a new plugin context with the given requester, resource key, and resource context.
func NewPluginContext(
	ctx context.Context,
	requester string,
	pluginConfig settings.Provider,
	globalConfig *config.GlobalConfig,
	resourceContext *ResourceContext,
) *PluginContext {
	pluginCtx := &PluginContext{
		RequestID:       uuid.New().String(),
		RequesterID:     requester,
		RequestOptions:  NewDefaultRequestOptions(),
		ResourceContext: resourceContext,
		PluginConfig:    pluginConfig,
		GlobalConfig:    globalConfig,
	}

	pluginCtx.Context = context.WithValue(ctx, pluginCtxKey{}, pluginCtx)
	return pluginCtx
}

// Construct a new plugin context with a valid connection.
func NewPluginContextWithConnection(
	ctx context.Context,
	requester string,
	pluginConfig settings.Provider,
	globalConfig *config.GlobalConfig,
	connection *Connection,
) *PluginContext {
	pluginCtx := &PluginContext{
		RequestID:      uuid.New().String(),
		RequesterID:    requester,
		RequestOptions: NewDefaultRequestOptions(),
		PluginConfig:   pluginConfig,
		GlobalConfig:   globalConfig,
		Connection:     connection,
	}

	pluginCtx.Context = context.WithValue(ctx, pluginCtxKey{}, pluginCtx)
	return pluginCtx
}

func NewPluginContextFromCtx(ctx context.Context) *PluginContext {
	return &PluginContext{
		Context:        ctx,
		RequestID:      uuid.New().String(),
		RequestOptions: NewDefaultRequestOptions(),
		PluginConfig:   nil,
		GlobalConfig:   config.GlobalConfigFromContext(ctx),
	}
}

func (c *PluginContext) SetSettingsProvider(provider settings.Provider) {
	c.PluginConfig = provider
}

func (c *PluginContext) SetResourceContext(resourceContext *ResourceContext) {
	c.ResourceContext = resourceContext
}

func (c *PluginContext) SetConnection(authContext *Connection) {
	c.Connection = authContext
}

func (c *PluginContext) IsAuthenticated() bool {
	return c.Connection != nil
}

// RequestOptions are the options that were set for the request.
type RequestOptions struct {
	// The timeout for the request
	Timeout time.Duration `json:"timeout"`

	// The maximum number of retries for the request, if set
	MaxRetries int `json:"max_retries"`

	// The backoff interval for the request
	BackoffInterval time.Duration `json:"backoff_interval"`
}

func NewDefaultRequestOptions() *RequestOptions {
	return &RequestOptions{
		Timeout:         DefaultTimeout,
		MaxRetries:      DefaultMaxRetries,
		BackoffInterval: DefaultBackoffInterval,
	}
}

// ResourceContext holds the context of the resource that the request is for, if the
// request is for a resource.
type ResourceContext struct {
	// Key identifies the resource type being requested
	Key string `json:"key"`
}
