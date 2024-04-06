package exec

import (
	"context"

	"github.com/hashicorp/go-plugin"
	"go.uber.org/zap"

	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/exec"
)

type Controller interface {
	internaltypes.Controller
}

func NewController(logger *zap.SugaredLogger) Controller {
	return &controller{
		logger: logger.Named("ExecController"),
	}
}

type controller struct {
	// wails context
	ctx     context.Context
	logger  *zap.SugaredLogger
	clients map[string]exec.Provider
}

func (c *controller) Run(ctx context.Context) {
	c.ctx = ctx
}

func (c *controller) OnPluginInit(meta config.PluginMeta) {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginInit")
}

func (c *controller) OnPluginStart(meta config.PluginMeta, client plugin.ClientProtocol) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStart")

	return nil
}

func (c *controller) OnPluginStop(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStop")

	return nil
}

func (c *controller) OnPluginShutdown(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginShutdown")

	return nil
}

func (c *controller) OnPluginDestroy(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginDestroy")

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
