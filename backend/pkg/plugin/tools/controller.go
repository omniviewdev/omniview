package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
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
	Meta       config.PluginMeta
	Tools      []sdktools.Descriptor
	Generation uint64
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

func NewController(logger logging.Logger, boundary *invocation.Boundary) Controller {
	return &controller{
		logger:   logger.Named("ToolsController"),
		boundary: boundary,
		clients:  make(map[string]Provider),
		cache:    make(map[string]PluginTools),
	}
}

var _ Controller = (*controller)(nil)

type controller struct {
	logger   logging.Logger
	boundary *invocation.Boundary

	mu             sync.RWMutex
	clients        map[string]Provider
	cache          map[string]PluginTools
	listeners      []func()
	generations    map[string]*toolGeneration
	nextGeneration uint64
}

type toolGeneration struct {
	id     uint64
	ctx    context.Context
	cancel context.CancelFunc
}

type expectedGenerationKey struct{}

func WithGeneration(ctx context.Context, generation uint64) context.Context {
	return context.WithValue(ctx, expectedGenerationKey{}, generation)
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

	provider, ok := raw.(sdktools.Provider)
	if !ok {
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Plugin type mismatch",
			fmt.Sprintf("Expected tools.v2 Provider for plugin %s, got %T", pluginID, raw),
		)
	}
	// The SDK's ListTools handshake negotiates the independent tools contract.
	return provider, nil
}

func (c *controller) OnPluginStart(pluginID string, meta config.PluginMeta, backend internaltypes.PluginBackend) error {
	c.forget(pluginID)
	c.mu.Lock()
	if c.generations == nil {
		c.generations = make(map[string]*toolGeneration)
	}
	c.nextGeneration++
	generationCtx, generationCancel := context.WithCancel(context.Background())
	generation := &toolGeneration{id: c.nextGeneration, ctx: generationCtx, cancel: generationCancel}
	c.generations[pluginID] = generation
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(generationCtx, 10*time.Second)
	defer cancel()
	committed := false
	defer func() {
		if !committed {
			generationCancel()
			c.mu.Lock()
			if c.generations[pluginID] == generation {
				delete(c.generations, pluginID)
			}
			c.mu.Unlock()
		}
	}()
	ctx, span := tracer.Start(ctx, "tools.OnPluginStart")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStart")

	type providerResult struct {
		provider Provider
		err      error
	}
	dispensed := make(chan providerResult, 1)
	go func() {
		provider, err := dispenseProvider(pluginID, backend)
		dispensed <- providerResult{provider, err}
	}()
	var provider Provider
	var err error
	select {
	case <-ctx.Done():
		return ctx.Err()
	case result := <-dispensed:
		provider, err = result.provider, result.err
	}
	if err != nil {
		telemetryutil.RecordError(span, err)
		return err
	}

	type discoveryResult struct {
		descriptors []sdktools.Descriptor
		err         error
	}
	discovered := make(chan discoveryResult, 1)
	go func() {
		descriptors, err := provider.ListTools(sdktypes.NewPluginContext(ctx, "mcp", nil, nil, nil))
		discovered <- discoveryResult{descriptors, err}
	}()
	var descriptors []sdktools.Descriptor
	select {
	case <-ctx.Done():
		return ctx.Err()
	case result := <-discovered:
		descriptors, err = result.descriptors, result.err
	}
	if err != nil {
		telemetryutil.RecordError(span, err)
		logger.Errorw(ctx, "failed to list plugin tools", "error", err)
		return err
	}

	c.mu.Lock()
	if c.generations[pluginID] != generation || ctx.Err() != nil {
		c.mu.Unlock()
		generationCancel()
		return context.Canceled
	}
	c.clients[pluginID] = provider
	c.cache[pluginID] = PluginTools{Meta: meta, Tools: descriptors, Generation: generation.id}
	listeners := append([]func(){}, c.listeners...)
	c.mu.Unlock()

	logger.Infow(ctx, "registered plugin tools", "count", len(descriptors))
	committed = true
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
	c.forget(pluginID)
	return nil
}

func (c *controller) forget(pluginID string) {
	c.mu.Lock()
	_, known := c.clients[pluginID]
	delete(c.clients, pluginID)
	if generation := c.generations[pluginID]; generation != nil {
		generation.cancel()
		delete(c.generations, pluginID)
	}
	delete(c.cache, pluginID)
	listeners := append([]func(){}, c.listeners...)
	c.mu.Unlock()
	if known {
		notify(listeners)
	}
}

func notify(listeners []func()) {
	for _, fn := range listeners {
		if fn != nil {
			fn()
		}
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
		out[id] = PluginTools{Meta: entry.Meta, Tools: append([]sdktools.Descriptor(nil), entry.Tools...), Generation: entry.Generation}
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
	generation := c.generations[pluginID]
	c.mu.RUnlock()
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}
	if generation == nil {
		return nil, context.Canceled
	}
	if expected, ok := ctx.Value(expectedGenerationKey{}).(uint64); ok && expected != generation.id {
		return nil, context.Canceled
	}
	if c.boundary != nil {
		target := invocation.Target{Provider: pluginID, Action: name}
		if connection != nil {
			target.Connection = connection.ID
		}
		var err error
		ctx, err = c.boundary.Admit(ctx, "tools.call", target)
		if err != nil {
			return nil, err
		}
	}
	callCtx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(generation.ctx, cancel)
	defer stop()
	defer cancel()
	ctx = callCtx

	var pluginCtx *sdktypes.PluginContext
	var route *resourcev2.AccessRoute
	if connection != nil {
		pluginCtx = sdktypes.NewPluginContextWithConnection(ctx, "mcp", nil, nil, connection)
		route = &resourcev2.AccessRoute{Connection: connection.ID}
	} else {
		pluginCtx = sdktypes.NewPluginContext(ctx, "mcp", nil, nil, nil)
	}

	result, err := provider.CallTool(pluginCtx, sdktools.CallInput{Name: name, Arguments: arguments, Route: route})
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	c.mu.RLock()
	current := c.generations[pluginID] == generation
	c.mu.RUnlock()
	if !current {
		return nil, context.Canceled
	}
	if err != nil {
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	return result, nil
}

func (c *controller) OnChange(fn func()) { c.Subscribe(fn) }

func (c *controller) Subscribe(fn func()) func() {
	c.mu.Lock()
	index := len(c.listeners)
	c.listeners = append(c.listeners, fn)
	c.mu.Unlock()
	return func() {
		c.mu.Lock()
		c.listeners[index] = nil
		c.mu.Unlock()
	}
}
