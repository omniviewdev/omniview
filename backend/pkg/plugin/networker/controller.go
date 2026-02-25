package networker

import (
	"context"
	"fmt"
	"reflect"

	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/networker"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

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
	GetSupportedPortForwardTargets(pluginID string) []string

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
	logger *zap.SugaredLogger,
	sp pkgsettings.Provider,
	resourceClient resource.IClient,
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
	logger           *zap.SugaredLogger
	settingsProvider pkgsettings.Provider
	clients          map[string]networker.Provider
	sessionIndex     map[string]sessionIndex

	// forwarder channels
	stops map[string]chan struct{}

	resourceClient resource.IClient
}

// Run stores the Wails application context for event emission.
func (c *controller) Run(ctx context.Context) {
	c.ctx = ctx
}

// ====================================== Controller Implementation ====================================== //

func (c *controller) OnPluginInit(pluginID string, meta config.PluginMeta) {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginInit")

	if c.clients == nil {
		c.clients = make(map[string]networker.Provider)
	}
	if c.stops == nil {
		c.stops = make(map[string]chan struct{})
	}
}

func (c *controller) OnPluginStart(pluginID string, meta config.PluginMeta, backend internaltypes.PluginBackend) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginStart")

	raw, err := backend.Dispense("networker")
	if err != nil {
		return err
	}

	provider, ok := raw.(networker.Provider)
	if !ok {
		typeof := reflect.TypeOf(raw).String()
		err = apperror.New(apperror.TypePluginLoadFailed, 500, "Plugin type mismatch", fmt.Sprintf("Expected networker.Provider but got '%s'.", typeof))
		logger.Error(err)
		return err
	}

	c.clients[pluginID] = provider
	return nil
}

func (c *controller) OnPluginStop(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginStop")

	delete(c.clients, pluginID)
	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginShutdown")

	delete(c.clients, pluginID)
	return nil
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", pluginID)
	logger.Debug("OnPluginDestroy")

	// nil action
	return nil
}

func (c *controller) ListPlugins() ([]string, error) {
	c.logger.Debug("ListPlugins")
	plugins := make([]string, 0, len(c.clients))
	for k := range c.clients {
		plugins = append(plugins, k)
	}
	return plugins, nil
}

func (c *controller) HasPlugin(pluginID string) bool {
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
		c.logger.Errorw("error getting connection: ", "err", err)
		return nil
	}

	return sdktypes.NewPluginContextWithConnection(
		context.Background(),
		"networker",
		nil,
		nil,
		&connection,
	)
}

func (c *controller) getUnconnectedCtx(
	ctx context.Context,
) *sdktypes.PluginContext {
	return sdktypes.NewPluginContextWithConnection(ctx, "networker", nil, nil, nil)
}

func (c *controller) GetSupportedPortForwardTargets(plugin string) []string {
	if provider, ok := c.clients[plugin]; ok {
		return provider.GetSupportedPortForwardTargets(
			sdktypes.NewPluginContextWithConnection(
				context.Background(),
				"networker",
				nil,
				nil,
				nil,
			),
		)
	}
	return nil
}

func (c *controller) GetPortForwardSession(
	sessionID string,
) (*networker.PortForwardSession, error) {
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}

	provider, ok := c.clients[index.pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(index.pluginID)
	}

	return provider.GetPortForwardSession(
		c.getConnectedCtx(index.pluginID, index.connectionID),
		sessionID,
	)
}

func (c *controller) ListPortForwardSessions(
	pluginID, connectionID string,
) ([]*networker.PortForwardSession, error) {
	provider, ok := c.clients[pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}

	return provider.ListPortForwardSessions(
		c.getConnectedCtx(pluginID, connectionID),
	)
}

func (c *controller) ListAllPortForwardSessions() ([]*networker.PortForwardSession, error) {
	// Collect unique plugin+connection pairs from session index
	type pair struct{ pluginID, connectionID string }
	seen := make(map[pair]struct{})
	for _, idx := range c.sessionIndex {
		seen[pair{idx.pluginID, idx.connectionID}] = struct{}{}
	}

	var all []*networker.PortForwardSession
	for p := range seen {
		provider, ok := c.clients[p.pluginID]
		if !ok {
			continue
		}
		sessions, err := provider.ListPortForwardSessions(
			c.getConnectedCtx(p.pluginID, p.connectionID),
		)
		if err != nil {
			c.logger.Warnw("ListAllPortForwardSessions: error listing sessions",
				"pluginID", p.pluginID, "connectionID", p.connectionID, "err", err)
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
	provider, ok := c.clients[pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
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
	provider, ok := c.clients[pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(pluginID)
	}

	session, err := provider.StartPortForwardSession(
		c.getConnectedCtx(pluginID, connectionID),
		opts,
	)
	if err != nil {
		return nil, err
	}
	c.sessionIndex[session.ID] = sessionIndex{
		pluginID:     pluginID,
		connectionID: connectionID,
	}

	if c.ctx != nil {
		runtime.EventsEmit(c.ctx, PortForwardSessionCreated, session)
	}

	return session, nil
}

// ClosePortForwardSession closes a port forward session
func (c *controller) ClosePortForwardSession(
	sessionID string,
) (*networker.PortForwardSession, error) {
	index, ok := c.sessionIndex[sessionID]
	if !ok {
		return nil, apperror.SessionNotFound(sessionID)
	}

	provider, ok := c.clients[index.pluginID]
	if !ok {
		return nil, apperror.PluginNotFound(index.pluginID)
	}

	session, err := provider.ClosePortForwardSession(
		c.getConnectedCtx(index.pluginID, index.connectionID),
		sessionID,
	)
	if err != nil {
		return nil, err
	}

	delete(c.sessionIndex, sessionID)

	if c.ctx != nil {
		runtime.EventsEmit(c.ctx, PortForwardSessionClosed, session)
	}

	return session, nil
}
