package types

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/plugin/pkg/config"
)

const (
	DefaultTimeout         = 10 * time.Second
	DefaultMaxRetries      = 3
	DefaultBackoffInterval = 1 * time.Second
)

// PluginContext holds contextual data for requests made to a plugin.
type PluginContext struct {
	// Current context
	Context context.Context

	// RequestOptions are the options that were set for the request.
	RequestOptions *RequestOptions

	// AuthContext holds the identifier of the auth context for the plugin.
	AuthContext *AuthContext

	// The resource context for the request, if available
	ResourceContext *ResourceContext

	// The plugin settings for the request
	PluginConfig *config.PluginConfig

	// GlobalSettings are settings that are accessible to all plugins, taken
	// from the global settings in the IDE section
	GlobalConfig *config.GlobalConfig

	// Unique ID for the request
	RequestID string

	// The ID of the requester
	RequesterID string
}

// Construct a new plugin context with the given requester, resource key, and resource context.
func NewPluginContext(
	context context.Context,
	requester string,
	pluginConfig *config.PluginConfig,
	globalConfig *config.GlobalConfig,
	resourceContext *ResourceContext,
) *PluginContext {
	return &PluginContext{
		Context:         context,
		RequestID:       uuid.New().String(),
		RequesterID:     requester,
		RequestOptions:  NewDefaultRequestOptions(),
		ResourceContext: resourceContext,
		PluginConfig:    pluginConfig,
		GlobalConfig:    globalConfig,
	}
}

func NewPluginContextFromCtx(ctx context.Context) *PluginContext {
	return &PluginContext{
		Context:        ctx,
		RequestID:      uuid.New().String(),
		RequestOptions: NewDefaultRequestOptions(),
		PluginConfig:   config.PluginConfigFromContext(ctx),
		GlobalConfig:   config.GlobalConfigFromContext(ctx),
	}
}

func (c *PluginContext) SetAuthContext(authContext *AuthContext) {
	if c.ResourceContext != nil {
		c.AuthContext = authContext
	}
}

func (c *PluginContext) IsAuthenticated() bool {
	return c.AuthContext != nil
}

// RequestOptions are the options that were set for the request.
type RequestOptions struct {
	// The timeout for the request
	Timeout time.Duration

	// The maximum number of retries for the request, if set
	MaxRetries int

	// The backoff interval for the request
	BackoffInterval time.Duration
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
	Key string
}
