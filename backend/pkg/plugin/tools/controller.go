package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdktools "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

var tracer = otel.Tracer("omniview.tools")

// Provider is the SDK tools provider dispensed from a plugin backend.
type Provider = sdktools.Provider

// PluginTools is the cached tool list of one running plugin.
type PluginTools struct {
	Meta  config.PluginMeta
	Tools []sdktools.Descriptor
}

// Controller caches every running plugin's tools and dispatches calls.
type Controller interface {
	internaltypes.Controller

	// ListAll returns a copy of the cached tools of every running plugin.
	ListAll() map[string]PluginTools

	// CallTool invokes a plugin tool. connection is nil for plugin-scoped tools.
	CallTool(
		ctx context.Context,
		pluginID string,
		connection *sdktypes.Connection,
		name string,
		arguments json.RawMessage,
	) (*sdktools.Result, error)

	// OnChange registers fn to run (outside the controller lock) after every
	// cache change: plugin start, stop or shutdown.
	OnChange(fn func())
}

func NewController(logger logging.Logger) Controller {
	return &controller{
		logger:  logger.Named("ToolsController"),
		clients: make(map[string]Provider),
		cache:   make(map[string]PluginTools),
	}
}

var _ Controller = (*controller)(nil)

type controller struct {
	logger logging.Logger

	mu        sync.RWMutex
	clients   map[string]Provider
	cache     map[string]PluginTools
	listeners []func()
}

// ====================================== Controller Implementation ====================================== //

func (c *controller) OnPluginInit(pluginID string, _ config.PluginMeta) {
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(context.Background(), "OnPluginInit")
}

func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (Provider, error) {
	raw, err := backend.Dispense(sdktools.PluginID)
	if err != nil {
		return nil, err
	}

	version := backend.NegotiatedVersion()
	switch version {
	case 1:
		v1, ok := raw.(sdktools.Provider)
		if !ok {
			return nil, apperror.New(
				apperror.TypePluginLoadFailed, http.StatusInternalServerError,
				"Plugin type mismatch",
				fmt.Sprintf("Expected tools.Provider for v1, got %T", raw),
			)
		}
		return v1, nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for tools, engine supports v1", pluginID, version),
		)
	}
}

func (c *controller) OnPluginStart(pluginID string, meta config.PluginMeta, backend internaltypes.PluginBackend) error {
	ctx, span := tracer.Start(context.Background(), "tools.OnPluginStart")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		telemetryutil.RecordError(span, err)
		logger.Errorw(ctx, "error", "error", err)
		return err
	}

	descriptors, err := provider.ListTools(sdktypes.NewPluginContext(ctx, "mcp", nil, nil, nil))
	if err != nil {
		telemetryutil.RecordError(span, err)
		logger.Errorw(ctx, "failed to list plugin tools", "error", err)
		return err
	}

	c.mu.Lock()
	c.clients[pluginID] = provider
	c.cache[pluginID] = PluginTools{Meta: meta, Tools: descriptors}
	listeners := c.listeners
	c.mu.Unlock()

	logger.Infow(ctx, "registered plugin tools", "count", len(descriptors))
	notify(listeners)
	return nil
}

func (c *controller) OnPluginStop(pluginID string, _ config.PluginMeta) error {
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(context.Background(), "OnPluginStop")
	c.forget(pluginID)
	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, _ config.PluginMeta) error {
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(context.Background(), "OnPluginShutdown")
	c.forget(pluginID)
	return nil
}

func (c *controller) OnPluginDestroy(pluginID string, _ config.PluginMeta) error {
	c.logger.With(logging.Any("pluginID", pluginID)).Debugw(context.Background(), "OnPluginDestroy")
	return nil
}

func (c *controller) forget(pluginID string) {
	c.mu.Lock()
	_, known := c.clients[pluginID]
	delete(c.clients, pluginID)
	delete(c.cache, pluginID)
	listeners := c.listeners
	c.mu.Unlock()
	if known {
		notify(listeners)
	}
}

func notify(listeners []func()) {
	for _, fn := range listeners {
		fn()
	}
}

func (c *controller) ListPlugins() ([]string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	plugins := make([]string, 0, len(c.clients))
	for k := range c.clients {
		plugins = append(plugins, k)
	}
	return plugins, nil
}

func (c *controller) HasPlugin(pluginID string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.clients[pluginID]
	return ok
}

// ====================================== Tools ====================================== //

func (c *controller) ListAll() map[string]PluginTools {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make(map[string]PluginTools, len(c.cache))
	for id, entry := range c.cache {
		out[id] = PluginTools{Meta: entry.Meta, Tools: append([]sdktools.Descriptor(nil), entry.Tools...)}
	}
	return out
}

func (c *controller) CallTool(
	ctx context.Context,
	pluginID string,
	connection *sdktypes.Connection,
	name string,
	arguments json.RawMessage,
) (*sdktools.Result, error) {
	ctx, span := tracer.Start(ctx, "tools.CallTool")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID), attribute.String("tool", name))

	c.mu.RLock()
	provider, ok := c.clients[pluginID]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}

	var pluginCtx *sdktypes.PluginContext
	var route *resourcev2.AccessRoute
	if connection != nil {
		pluginCtx = sdktypes.NewPluginContextWithConnection(ctx, "mcp", nil, nil, connection)
		route = &resourcev2.AccessRoute{Connection: connection.ID}
	} else {
		pluginCtx = sdktypes.NewPluginContext(ctx, "mcp", nil, nil, nil)
	}

	result, err := provider.CallTool(pluginCtx, sdktools.CallInput{Name: name, Arguments: arguments, Route: route})
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil
}

func (c *controller) OnChange(fn func()) {
	c.mu.Lock()
	c.listeners = append(c.listeners, fn)
	c.mu.Unlock()
}
