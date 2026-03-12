package networker

import (
	"context"
	"fmt"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	otelcodes "go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	logging "github.com/omniviewdev/plugin-sdk/log"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

var tracer = otel.Tracer("omniview.networker")

func recordError(span trace.Span, err error) {
	span.RecordError(err)
	span.SetStatus(otelcodes.Error, err.Error())
}

// Wails event keys for port-forward session lifecycle.
const (
	PortForwardSessionCreated = "core/networker/portforward/created"
	PortForwardSessionClosed  = "core/networker/portforward/closed"
)

type Controller interface {
	internaltypes.Controller

	// Run stores the Wails application context for event emission.
	Run(ctx context.Context)

	// GetSupportedPortForwardTargets returns the supported targets for port forwarding
	GetSupportedPortForwardTargets(pluginID string) ([]string, error)

	// GetPortForwardSession returns a port forward session by ID
	GetPortForwardSession(sessionID string) (*networker.PortForwardSession, error)

	// ListPortForwardSessions returns a list of port forward sessions for a plugin
	ListPortForwardSessions(pluginID, connectionID string) ([]*networker.PortForwardSession, error)

	// ListAllPortForwardSessions returns all port forward sessions across all plugins
	ListAllPortForwardSessions() ([]*networker.PortForwardSession, error)

	// FindPortForwardSessions returns a list of port forward sessions for a plugin
	FindPortForwardSessions(
		pluginID, connectionID string,
		request networker.FindPortForwardSessionRequest,
	) ([]*networker.PortForwardSession, error)

	// StartResourcePortForwardingSession starts a port forwarding session
	StartResourcePortForwardingSession(
		pluginID, connectionID string,
		opts networker.PortForwardSessionOptions,
	) (*networker.PortForwardSession, error)

	// ClosePortForwardSession closes a port forward session
	ClosePortForwardSession(sessionID string) (*networker.PortForwardSession, error)
}

// make it easy for us to lookup sessions by ID, without having to know
// the plugin or connection ID.
type sessionIndex struct {
	pluginID     string
	connectionID string
}

func NewController(
	logger logging.Logger,
	sp pkgsettings.Provider,
	resourceClient resource.Service,
) Controller {
	return &controller{
		logger:           logger.Named("NetworkerController"),
		settingsProvider: sp,
		sessionIndex:     make(map[string]sessionIndex),
		stops:            make(map[string]chan struct{}),
		resourceClient:   resourceClient,
	}
}

var _ Controller = &controller{}

type controller struct {
	ctx              context.Context
	logger           logging.Logger
	settingsProvider pkgsettings.Provider
	resourceClient   resource.Service

	mu           sync.RWMutex
	clients      map[string]NetworkerProvider
	sessionIndex map[string]sessionIndex
	stops        map[string]chan struct{}
}

// Run stores the Wails application context for event emission.
func (c *controller) Run(ctx context.Context) {
	c.ctx = ctx
}

// ====================================== Controller Implementation ====================================== //

func (c *controller) OnPluginInit(pluginID string, meta config.PluginMeta) {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginInit")

	c.mu.Lock()
	if c.clients == nil {
		c.clients = make(map[string]NetworkerProvider)
	}
	if c.stops == nil {
		c.stops = make(map[string]chan struct{})
	}
	c.mu.Unlock()
}

// dispenseProvider extracts the networker provider from the backend,
// wrapping it in the version-appropriate adapter.
func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (NetworkerProvider, error) {
	raw, err := backend.Dispense("networker")
	if err != nil {
		return nil, err
	}

	version := backend.NegotiatedVersion()
	switch version {
	case 1:
		v1, ok := raw.(networker.Provider)
		if !ok {
			return nil, apperror.New(
				apperror.TypePluginLoadFailed, 500,
				"Plugin type mismatch",
				fmt.Sprintf("Expected networker.Provider for v1, got %T", raw),
			)
		}
		return NewAdapterV1(v1), nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, 500,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for networker, engine supports v1", pluginID, version),
		)
	}
}

func (c *controller) OnPluginStart(pluginID string, meta config.PluginMeta, backend internaltypes.PluginBackend) error {
	ctx, span := tracer.Start(context.Background(), "networker.OnPluginStart")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		recordError(span, err)
		logger.Errorw(ctx, "error", "error", err)
		return err
	}

	c.mu.Lock()
	c.clients[pluginID] = provider
	c.mu.Unlock()
	return nil
}

func (c *controller) OnPluginStop(pluginID string, meta config.PluginMeta) error {
	ctx, span := tracer.Start(context.Background(), "networker.OnPluginStop")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStop")

	c.mu.Lock()
	provider, ok := c.clients[pluginID]
	delete(c.clients, pluginID)
	c.mu.Unlock()
	if ok {
		provider.StopAll()
	}
	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginShutdown")

	c.mu.Lock()
	delete(c.clients, pluginID)
	c.mu.Unlock()
	return nil
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginDestroy")

	// nil action
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	c.logger.Debugw(context.Background(), "ListPlugins")
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

// ====================================== Port Forwarding Implementation ====================================== //

func (c *controller) getConnectedCtx(
	plugin string,
	connectionID string,
) *sdktypes.PluginContext {
	// get the connection from the right resource
	connection, err := c.resourceClient.GetConnection(plugin, connectionID)
	if err != nil {
		c.logger.Errorw(context.Background(), "getConnectedCtx: failed to get connection",
			"pluginID", plugin,
			"connectionID", connectionID,
			"err", err,
		)
		return nil
	}

	c.logger.Debugw(context.Background(), "getConnectedCtx: resolved connection",
		"pluginID", plugin,
		"connectionID", connectionID,
		"connectionDataKeys", mapKeys(connection.Data),
	)

	return sdktypes.NewPluginContextWithConnection(
		context.Background(),
		"networker",
		nil,
		nil,
		&connection,
	)
}

// mapKeys returns the keys from a map (for diagnostic logging).
func mapKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func (c *controller) getUnconnectedCtx(
	ctx context.Context,
) *sdktypes.PluginContext {
	return sdktypes.NewPluginContextWithConnection(ctx, "networker", nil, nil, nil)
}

func (c *controller) GetSupportedPortForwardTargets(plugin string) ([]string, error) {
	ctx, span := tracer.Start(context.Background(), "networker.GetSupportedPortForwardTargets")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", plugin))

	c.mu.RLock()
	provider, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(plugin)
		recordError(span, err)
		return nil, err
	}
	return provider.GetSupportedPortForwardTargets(
		sdktypes.NewPluginContextWithConnection(
			ctx,
			"networker",
			nil,
			nil,
			nil,
		),
	)
}

func (c *controller) GetPortForwardSession(
	sessionID string,
) (*networker.PortForwardSession, error) {
	_, span := tracer.Start(context.Background(), "networker.GetPortForwardSession")
	defer span.End()
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		c.mu.RUnlock()
		err := apperror.SessionNotFound(sessionID)
		recordError(span, err)
		return nil, err
	}
	provider, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(index.pluginID)
		recordError(span, err)
		return nil, err
	}

	span.SetAttributes(
		attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID),
	)

	return provider.GetPortForwardSession(
		c.getConnectedCtx(index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) ListPortForwardSessions(
	pluginID, connectionID string,
) ([]*networker.PortForwardSession, error) {
	_, span := tracer.Start(context.Background(), "networker.ListPortForwardSessions")
	defer span.End()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
	)

	c.mu.RLock()
	provider, ok := c.clients[pluginID]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(pluginID)
		recordError(span, err)
		return nil, err
	}

	return provider.ListPortForwardSessions(
		c.getConnectedCtx(pluginID, connectionID),
	)
}

func (c *controller) ListAllPortForwardSessions() ([]*networker.PortForwardSession, error) {
	ctx, span := tracer.Start(context.Background(), "networker.ListAllPortForwardSessions")
	defer span.End()

	c.mu.RLock()
	type pair struct{ pluginID, connectionID string }
	seen := make(map[pair]struct{})
	for _, idx := range c.sessionIndex {
		seen[pair{idx.pluginID, idx.connectionID}] = struct{}{}
	}
	// Snapshot clients we need
	type providerPair struct {
		pair
		provider NetworkerProvider
	}
	var pairs []providerPair
	for p := range seen {
		provider, ok := c.clients[p.pluginID]
		if !ok {
			continue
		}
		pairs = append(pairs, providerPair{p, provider})
	}
	c.mu.RUnlock()

	span.SetAttributes(attribute.Int("provider_count", len(pairs)))

	var all []*networker.PortForwardSession
	for _, pp := range pairs {
		provider := pp.provider
		sessions, err := provider.ListPortForwardSessions(
			c.getConnectedCtx(pp.pluginID, pp.connectionID),
		)
		if err != nil {
			c.logger.Warnw(ctx, "ListAllPortForwardSessions: error listing sessions",
				"pluginID", pp.pluginID, "connectionID", pp.connectionID, "err", err)
			continue
		}
		all = append(all, sessions...)
	}
	return all, nil
}

func (c *controller) FindPortForwardSessions(
	pluginID string,
	connectionID string,
	request networker.FindPortForwardSessionRequest,
) ([]*networker.PortForwardSession, error) {
	_, span := tracer.Start(context.Background(), "networker.FindPortForwardSessions")
	defer span.End()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
	)

	c.mu.RLock()
	provider, ok := c.clients[pluginID]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(pluginID)
		recordError(span, err)
		return nil, err
	}

	return provider.FindPortForwardSessions(
		c.getConnectedCtx(pluginID, connectionID),
		request,
	)
}

// StartResourcePortForwardingSession starts a port forwarding session
func (c *controller) StartResourcePortForwardingSession(
	pluginID, connectionID string,
	opts networker.PortForwardSessionOptions,
) (*networker.PortForwardSession, error) {
	ctx, span := tracer.Start(context.Background(), "networker.StartResourcePortForwardingSession")
	defer span.End()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
		attribute.String("connection_type", string(opts.ConnectionType)),
		attribute.String("protocol", string(opts.Protocol)),
		attribute.Int("local_port", int(opts.LocalPort)),
		attribute.Int("remote_port", int(opts.RemotePort)),
	)

	c.logger.Infow(ctx, "StartResourcePortForwardingSession: request received",
		"pluginID", pluginID,
		"connectionID", connectionID,
		"connectionType", opts.ConnectionType,
		"protocol", opts.Protocol,
		"localPort", opts.LocalPort,
		"remotePort", opts.RemotePort,
	)

	c.mu.RLock()
	provider, ok := c.clients[pluginID]
	c.mu.RUnlock()
	if !ok {
		c.logger.Errorw(ctx, "StartResourcePortForwardingSession: plugin not found",
			"pluginID", pluginID,
		)
		err := apperror.PluginNotFound(pluginID)
		recordError(span, err)
		return nil, err
	}

	pctx := c.getConnectedCtx(pluginID, connectionID)
	if pctx == nil {
		c.logger.Errorw(ctx, "StartResourcePortForwardingSession: nil plugin context (connection lookup failed)",
			"pluginID", pluginID,
			"connectionID", connectionID,
		)
		err := apperror.New(apperror.TypeConnectionNotFound, 404,
			"Connection lookup failed",
			fmt.Sprintf("Could not resolve connection '%s' for plugin '%s'", connectionID, pluginID),
		)
		recordError(span, err)
		return nil, err
	}

	c.logger.Infow(ctx, "StartResourcePortForwardingSession: dispatching to plugin",
		"pluginID", pluginID,
	)

	session, err := provider.StartPortForwardSession(pctx, opts)
	if err != nil {
		recordError(span, err)
		c.logger.Errorw(ctx, "StartResourcePortForwardingSession: plugin returned error",
			"pluginID", pluginID,
			"connectionID", connectionID,
			"err", err,
		)
		return nil, err
	}

	c.logger.Infow(ctx, "StartResourcePortForwardingSession: session created",
		"pluginID", pluginID,
		"sessionID", session.ID,
		"localPort", session.LocalPort,
		"remotePort", session.RemotePort,
		"state", session.State,
	)

	c.mu.Lock()
	c.sessionIndex[session.ID] = sessionIndex{
		pluginID:     pluginID,
		connectionID: connectionID,
	}
	c.mu.Unlock()

	if c.ctx != nil {
		runtime.EventsEmit(c.ctx, PortForwardSessionCreated, session)
	}

	return session, nil
}

// ClosePortForwardSession closes a port forward session
func (c *controller) ClosePortForwardSession(
	sessionID string,
) (*networker.PortForwardSession, error) {
	_, span := tracer.Start(context.Background(), "networker.ClosePortForwardSession")
	defer span.End()
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		c.mu.RUnlock()
		err := apperror.SessionNotFound(sessionID)
		recordError(span, err)
		return nil, err
	}
	provider, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(index.pluginID)
		recordError(span, err)
		return nil, err
	}

	span.SetAttributes(
		attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID),
	)

	session, err := provider.ClosePortForwardSession(
		c.getConnectedCtx(index.pluginID, index.connectionID),
		sessionID,
	)
	if err != nil {
		recordError(span, err)
		return nil, err
	}

	c.mu.Lock()
	delete(c.sessionIndex, sessionID)
	c.mu.Unlock()

	if c.ctx != nil {
		runtime.EventsEmit(c.ctx, PortForwardSessionClosed, session)
	}

	return session, nil
}
