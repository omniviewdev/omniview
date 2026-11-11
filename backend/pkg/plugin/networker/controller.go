package networker

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

var tracer = otel.Tracer("omniview.networker")

func finishNetworkerOp(span trace.Span, err *error) {
	if *err == nil {
		span.SetAttributes(attribute.String("outcome", "success"))
	} else {
		outcome := "failure"
		if telemetryutil.ErrorClass(*err) == "canceled" {
			outcome = "canceled"
		}
		span.SetAttributes(attribute.String("outcome", outcome))
		telemetryutil.RecordError(span, *err)
	}
}

// Wails event keys for port-forward session lifecycle.
const (
	PortForwardSessionCreated = "core/networker/portforward/created"
	PortForwardSessionClosed  = "core/networker/portforward/closed"
)

func init() {
	application.RegisterEvent[*networker.PortForwardSession](PortForwardSessionCreated)
	application.RegisterEvent[*networker.PortForwardSession](PortForwardSessionClosed)
}

type Controller interface {
	internaltypes.Controller

	// ServiceStartup initialises the controller during application startup.
	ServiceStartup(ctx context.Context, options application.ServiceOptions) error
	// ServiceShutdown cleans up resources during application shutdown.
	ServiceShutdown() error
	SetReferenceAdmitter(resource.ReferenceAdmitter)

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
		ctx context.Context,
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
	resourceClient resource.ConnectionReader,
) Controller {
	return &controller{
		app:              nil,
		ctx:              nil,
		logger:           logger.Named("NetworkerController"),
		settingsProvider: sp,
		resourceClient:   resourceClient,
		mu:               sync.RWMutex{},
		clients:          nil,
		sessionIndex:     make(map[string]sessionIndex),
		stops:            make(map[string]chan struct{}),
	}
}

var _ Controller = (*controller)(nil)

type controller struct {
	app               *application.App
	ctx               context.Context
	logger            logging.Logger
	settingsProvider  pkgsettings.Provider
	resourceClient    resource.ConnectionReader
	referenceAdmitter resource.ReferenceAdmitter

	mu           sync.RWMutex
	clients      map[string]Provider
	sessionIndex map[string]sessionIndex
	stops        map[string]chan struct{}
}

// SetReferenceAdmitter is configured by native composition before startup.
func (c *controller) SetReferenceAdmitter(admit resource.ReferenceAdmitter) {
	c.referenceAdmitter = admit
}

// ServiceStartup initialises the controller during application startup.
func (c *controller) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	c.app = application.Get()
	c.ctx = ctx
	return nil
}

// ServiceShutdown cleans up resources during application shutdown.
func (c *controller) ServiceShutdown() error {
	c.mu.RLock()
	plugins := make([]string, 0, len(c.clients))
	for id := range c.clients {
		plugins = append(plugins, id)
	}
	c.mu.RUnlock()
	for _, id := range plugins {
		if err := c.OnPluginStop(id, config.PluginMeta{}); err != nil {
			c.logger.Warnw(context.Background(), "port-forward provider stop failed during shutdown",
				"pluginID", id, "errorClass", telemetryutil.ErrorClass(err))
		}
	}
	return nil
}

// ====================================== Controller Implementation ====================================== //

func (c *controller) OnPluginInit(pluginID string, _ config.PluginMeta) {
	ctx, span := tracer.Start(context.Background(), "networker.OnPluginInit")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginInit")

	c.mu.Lock()
	if c.clients == nil {
		c.clients = make(map[string]Provider)
	}
	if c.stops == nil {
		c.stops = make(map[string]chan struct{})
	}
	c.mu.Unlock()
}

// dispenseProvider extracts the networker provider from the backend,
// wrapping it in the version-appropriate adapter.
func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (Provider, error) {
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
				apperror.TypePluginLoadFailed, http.StatusInternalServerError,
				"Plugin type mismatch",
				fmt.Sprintf("Expected networker.Provider for v1, got %T", raw),
			)
		}
		return NewAdapterV1(v1), nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for networker, engine supports v1", pluginID, version),
		)
	}
}

func (c *controller) OnPluginStart(pluginID string, _ config.PluginMeta, backend internaltypes.PluginBackend) error {
	ctx, span := tracer.Start(context.Background(), "networker.OnPluginStart")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		telemetryutil.RecordError(span, err)
		logger.Errorw(ctx, "error", "errorClass", telemetryutil.ErrorClass(err))
		return err
	}

	c.mu.Lock()
	c.clients[pluginID] = provider
	c.mu.Unlock()
	return nil
}

func (c *controller) OnPluginStop(pluginID string, _ config.PluginMeta) error {
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
	return c.OnPluginStop(pluginID, meta)
}

func (c *controller) OnPluginDestroy(pluginID string, _ config.PluginMeta) error {
	ctx, span := tracer.Start(context.Background(), "networker.OnPluginDestroy")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginDestroy")

	// nil action
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	_, span := tracer.Start(context.Background(), "networker.ListPlugins")
	defer span.End()
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
	_, span := tracer.Start(context.Background(), "networker.HasPlugin")
	defer span.End()
	span.SetAttributes(attribute.String("plugin_id", pluginID))
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.clients[pluginID]
	return ok
}

// ====================================== Port Forwarding Implementation ====================================== //

func (c *controller) getConnectedCtx(
	ctx context.Context,
	plugin string,
	connectionID string,
) *sdktypes.PluginContext {
	// get the connection from the right resource
	connection, err := c.resourceClient.GetConnection(ctx, plugin, connectionID)
	if err != nil {
		c.logger.Errorw(ctx, "getConnectedCtx: failed to get connection",
			"pluginID", plugin,
			"connectionID", connectionID,
			"errorClass", telemetryutil.ErrorClass(err),
		)
		return nil
	}

	c.logger.Debugw(ctx, "getConnectedCtx: resolved connection",
		"pluginID", plugin,
		"connectionID", connectionID,
	)

	return sdktypes.NewPluginContextWithConnection(
		ctx,
		"networker",
		nil,
		nil,
		&connection,
	)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) GetSupportedPortForwardTargets(plugin string) (_ []string, resultErr error) {
	ctx, span := tracer.Start(context.Background(), "networker.GetSupportedPortForwardTargets")
	defer span.End()
	defer finishNetworkerOp(span, &resultErr)
	span.SetAttributes(attribute.String("plugin_id", plugin))

	c.mu.RLock()
	provider, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(plugin)
		telemetryutil.RecordError(span, err)
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

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) GetPortForwardSession(
	sessionID string,
) (_ *networker.PortForwardSession, resultErr error) {
	ctx, span := tracer.Start(context.Background(), "networker.GetPortForwardSession")
	defer span.End()
	defer finishNetworkerOp(span, &resultErr)
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		c.mu.RUnlock()
		err := apperror.SessionNotFound(sessionID)
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	provider, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(index.pluginID)
		telemetryutil.RecordError(span, err)
		return nil, err
	}

	span.SetAttributes(
		attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID),
	)

	return provider.GetPortForwardSession(
		c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID),
		sessionID,
	)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) ListPortForwardSessions(
	pluginID, connectionID string,
) (_ []*networker.PortForwardSession, resultErr error) {
	ctx, span := tracer.Start(context.Background(), "networker.ListPortForwardSessions")
	defer span.End()
	defer finishNetworkerOp(span, &resultErr)
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
	)

	c.mu.RLock()
	provider, ok := c.clients[pluginID]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(pluginID)
		telemetryutil.RecordError(span, err)
		return nil, err
	}

	return provider.ListPortForwardSessions(
		c.getConnectedCtx(invocation.HostContext(ctx), pluginID, connectionID),
	)
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) ListAllPortForwardSessions() (_ []*networker.PortForwardSession, resultErr error) {
	ctx, span := tracer.Start(context.Background(), "networker.ListAllPortForwardSessions")
	defer span.End()
	defer finishNetworkerOp(span, &resultErr)

	c.mu.RLock()
	type pair struct{ pluginID, connectionID string }
	seen := make(map[pair]struct{})
	for _, idx := range c.sessionIndex {
		seen[pair(idx)] = struct{}{}
	}
	// Snapshot clients we need
	type providerPair struct {
		pair
		provider Provider
	}
	var pairs []providerPair
	for p := range seen {
		provider, ok := c.clients[p.pluginID]
		if !ok {
			c.logger.Debugw(ctx, "port forward provider unavailable", "pluginID", p.pluginID,
				"connectionID", p.connectionID, "errorClass", "NOT_FOUND")
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
			c.getConnectedCtx(invocation.HostContext(ctx), pp.pluginID, pp.connectionID),
		)
		if err != nil {
			c.logger.Warnw(ctx, "ListAllPortForwardSessions: error listing sessions",
				"pluginID", pp.pluginID, "connectionID", pp.connectionID, "errorClass", telemetryutil.ErrorClass(err))
			continue
		}
		all = append(all, sessions...)
	}
	return all, nil
}

//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) FindPortForwardSessions(
	pluginID string,
	connectionID string,
	request networker.FindPortForwardSessionRequest,
) (_ []*networker.PortForwardSession, resultErr error) {
	ctx, span := tracer.Start(context.Background(), "networker.FindPortForwardSessions")
	defer span.End()
	defer finishNetworkerOp(span, &resultErr)
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
	)

	c.mu.RLock()
	provider, ok := c.clients[pluginID]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(pluginID)
		telemetryutil.RecordError(span, err)
		return nil, err
	}

	return provider.FindPortForwardSessions(
		c.getConnectedCtx(invocation.HostContext(ctx), pluginID, connectionID),
		request,
	)
}

// StartResourcePortForwardingSession starts a port forwarding session.
func (c *controller) StartResourcePortForwardingSession(
	ctx context.Context,
	pluginID, connectionID string,
	opts networker.PortForwardSessionOptions,
) (_ *networker.PortForwardSession, resultErr error) {
	ctx, span := tracer.Start(ctx, "networker.StartResourcePortForwardingSession")
	defer span.End()
	defer func() {
		if resultErr != nil {
			telemetryutil.RecordError(span, resultErr)
			span.SetAttributes(attribute.String("outcome", "failure"))
		} else {
			span.SetAttributes(attribute.String("outcome", "success"))
		}
	}()
	span.SetAttributes(
		attribute.String("plugin_id", pluginID),
		attribute.String("connection_id", connectionID),
		attribute.String("connection_type", string(opts.ConnectionType)),
		attribute.String("protocol", string(opts.Protocol)),
		attribute.Int("local_port", int(opts.LocalPort)),
		attribute.Int("remote_port", int(opts.RemotePort)),
	)
	var reference *resourcev2.ResourceReference
	var route *resourcev2.AccessRoute
	switch connection := opts.Connection.(type) {
	case networker.PortForwardResourceConnection:
		reference, route = connection.Reference, connection.Route
	case *networker.PortForwardResourceConnection:
		if connection != nil {
			reference, route = connection.Reference, connection.Route
		}
	}
	if reference != nil {
		if c.referenceAdmitter == nil {
			return nil, resourcev2.NewError("UNSUPPORTED", "Resource reference admission is unavailable.")
		}
		if route == nil || route.Connection != connectionID {
			return nil, resourcev2.NewError("INVALID_REQUEST", "Resource route does not match the selected connection.")
		}
		admitted, err := c.referenceAdmitter(ctx, "networker.StartResourcePortForwardingSession", pluginID, *route, *reference)
		if err != nil {
			return nil, err
		}
		ctx = admitted
	}

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
		telemetryutil.RecordError(span, err)
		return nil, err
	}

	pctx := c.getConnectedCtx(ctx, pluginID, connectionID)
	if pctx == nil {
		c.logger.Errorw(ctx, "StartResourcePortForwardingSession: nil plugin context (connection lookup failed)",
			"pluginID", pluginID,
			"connectionID", connectionID,
		)
		err := apperror.New(apperror.TypeConnectionNotFound, http.StatusNotFound,
			"Connection lookup failed",
			fmt.Sprintf("Could not resolve connection '%s' for plugin '%s'", connectionID, pluginID),
		)
		telemetryutil.RecordError(span, err)
		return nil, err
	}

	c.logger.Infow(ctx, "StartResourcePortForwardingSession: dispatching to plugin",
		"pluginID", pluginID,
	)

	// Providers retain this context for the session, beyond binding completion.
	pctx.Context = context.WithoutCancel(pctx.Context)
	session, err := provider.StartPortForwardSession(pctx, opts)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(ctx, "StartResourcePortForwardingSession: plugin returned error",
			"pluginID", pluginID,
			"connectionID", connectionID,
			"errorClass", telemetryutil.ErrorClass(err),
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

	span.SetAttributes(attribute.String("session_id", session.ID))
	c.mu.Lock()
	c.sessionIndex[session.ID] = sessionIndex{
		pluginID:     pluginID,
		connectionID: connectionID,
	}
	c.mu.Unlock()

	if c.app != nil {
		c.app.Event.Emit(PortForwardSessionCreated, session)
	}

	return session, nil
}

// ClosePortForwardSession closes a port forward session.
//
//nolint:nonamedreturns // The deferred span records the returned error.
func (c *controller) ClosePortForwardSession(
	sessionID string,
) (_ *networker.PortForwardSession, resultErr error) {
	ctx, span := tracer.Start(context.Background(), "networker.ClosePortForwardSession")
	defer span.End()
	defer finishNetworkerOp(span, &resultErr)
	span.SetAttributes(attribute.String("session_id", sessionID))

	c.mu.RLock()
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		c.mu.RUnlock()
		err := apperror.SessionNotFound(sessionID)
		telemetryutil.RecordError(span, err)
		return nil, err
	}
	provider, ok := c.clients[index.pluginID]
	c.mu.RUnlock()
	if !ok {
		err := apperror.PluginNotFound(index.pluginID)
		telemetryutil.RecordError(span, err)
		return nil, err
	}

	span.SetAttributes(
		attribute.String("plugin_id", index.pluginID),
		attribute.String("connection_id", index.connectionID),
	)

	session, err := provider.ClosePortForwardSession(
		c.getConnectedCtx(invocation.HostContext(ctx), index.pluginID, index.connectionID),
		sessionID,
	)
	if err != nil {
		telemetryutil.RecordError(span, err)
		c.logger.Errorw(ctx, "port forward close failed", "pluginID", index.pluginID,
			"sessionID", sessionID, "errorClass", telemetryutil.ErrorClass(err))
		return nil, err
	}

	c.mu.Lock()
	delete(c.sessionIndex, sessionID)
	c.mu.Unlock()
	c.logger.Infow(ctx, "port forward session closed", "pluginID", index.pluginID,
		"sessionID", sessionID, "closeReason", "requested")

	if c.app != nil {
		c.app.Event.Emit(PortForwardSessionClosed, session)
	}

	return session, nil
}
