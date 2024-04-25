package networker

import (
	"context"
	"fmt"
	"reflect"

	"go.uber.org/zap"

	"github.com/hashicorp/go-plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/networker"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	pkgsettings "github.com/omniviewdev/settings"
)

type Controller interface {
	internaltypes.Controller

	// GetSupportedPortForwardTargets returns the supported targets for port forwarding
	GetSupportedPortForwardTargets(pluginID string) []string

	// GetPortForwardSession returns a port forward session by ID
	GetPortForwardSession(sessionID string) (*networker.PortForwardSession, error)

	// ListPortForwardSessions returns a list of port forward sessions for a plugin
	ListPortForwardSessions(pluginID, connectionID string) ([]*networker.PortForwardSession, error)

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

// ====================================== Controller Implementation ====================================== //

func (c *controller) OnPluginInit(meta config.PluginMeta) {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginInit")

	if c.clients == nil {
		c.clients = make(map[string]networker.Provider)
	}
	if c.stops == nil {
		c.stops = make(map[string]chan struct{})
	}
}

func (c *controller) OnPluginStart(meta config.PluginMeta, client plugin.ClientProtocol) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStart")

	raw, err := client.Dispense("networker")
	if err != nil {
		return err
	}

	provider, ok := raw.(networker.Provider)
	if !ok {
		typeof := reflect.TypeOf(raw).String()
		err = fmt.Errorf("could not start plugin: expected networker.Provider, got %s", typeof)
		logger.Error(err)
		return err
	}

	c.clients[meta.ID] = provider
	return nil
}

func (c *controller) OnPluginStop(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStop")

	delete(c.clients, meta.ID)
	return nil
}

func (c *controller) OnPluginShutdown(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginShutdown")

	delete(c.clients, meta.ID)
	return nil
}

func (c *controller) OnPluginDestroy(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
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
		return nil, fmt.Errorf("session %s not found", sessionID)
	}

	provider, ok := c.clients[index.pluginID]
	if !ok {
		return nil, fmt.Errorf("plugin %s not found", index.pluginID)
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
		return nil, fmt.Errorf("plugin %s not found", pluginID)
	}

	return provider.ListPortForwardSessions(
		c.getConnectedCtx(pluginID, connectionID),
	)
}

func (c *controller) FindPortForwardSessions(
	pluginID string,
	connectionID string,
	request networker.FindPortForwardSessionRequest,
) ([]*networker.PortForwardSession, error) {
	provider, ok := c.clients[pluginID]
	if !ok {
		return nil, fmt.Errorf("plugin %s not found", pluginID)
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
	panic("implement me")
}

// ClosePortForwardSession closes a port forward session
func (c *controller) ClosePortForwardSession(
	sessionID string,
) (*networker.PortForwardSession, error) {
	panic("implement me")
}
