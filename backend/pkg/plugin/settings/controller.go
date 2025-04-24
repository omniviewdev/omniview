package settings

import (
	"errors"
	"fmt"
	"reflect"

	"github.com/hashicorp/go-plugin"
	pkgsettings "github.com/omniviewdev/settings"
	"go.uber.org/zap"

	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/settings"
)

const (
	PluginName = "settings"
)

// Controller handles all requests to interface with the settings capabilities on installed plugins.
//
// This controller is embedded in the client IDE facing client.
type Controller interface {
	internaltypes.Controller
	IClient
}

// runtime assertion to make sure we satisfy both internal and external interfaces.
var _ Controller = (*controller)(nil)

type controller struct {
	logger           *zap.SugaredLogger
	settingsProvider pkgsettings.Provider
	clients          map[string]sdksettings.Provider
}

// NewController returns a new Controller instance.
func NewController(logger *zap.SugaredLogger, sp pkgsettings.Provider) Controller {
	return &controller{
		logger:           logger.Named("SettingsController"),
		settingsProvider: sp,
		clients:          make(map[string]sdksettings.Provider),
	}
}

func (c *controller) OnPluginInit(meta config.PluginMeta) {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginInit")

	// make sure we have our maps initialized
	if c.clients == nil {
		c.clients = make(map[string]sdksettings.Provider)
	}
}

func (c *controller) OnPluginStart(
	meta config.PluginMeta,
	client plugin.ClientProtocol,
) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginStart")

	// make sure we have a client we can call for this plugin
	raw, err := client.Dispense(PluginName)
	if err != nil {
		return err
	}

	resourceClient, ok := raw.(sdksettings.Provider)
	if !ok {
		// get the type for for debugging/error
		typeOfClient := reflect.TypeOf(raw).String()
		err = fmt.Errorf(
			"could not start plugin: expected SettingsProvider but got '%s'",
			typeOfClient,
		)
		logger.Error(err)
		return err
	}

	c.clients[meta.ID] = resourceClient
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

	return c.OnPluginStop(meta)
}

func (c *controller) OnPluginDestroy(meta config.PluginMeta) error {
	logger := c.logger.With("pluginID", meta.ID)
	logger.Debug("OnPluginDestroy")

	// nothing to do here
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
	c.logger.Debug("HasPlugin")

	_, hasClient := c.clients[pluginID]
	return hasClient
}

// ================================== CLIENT METHODS ================================== //

// Values returns all of the values for all of the plugins
func (c *controller) Values() map[string]any {
	logger := c.logger.With("method", "Values")
	logger.Debug("Listing all settings values")

	// create a new map to hold the values
	values := make(map[string]any)
	// call all plugin clients simultaneously to collect them into the key value store
	for pluginID, client := range c.clients {
		clientValues := client.ListSettings()
		for settingID, setting := range clientValues {
			// create the key for the setting
			key := fmt.Sprintf("%s.%s", pluginID, settingID)
			// add the setting to the map
			values[key] = setting.Value
		}
	}

	return values
}

func (c *controller) PluginValues(plugin string) map[string]any {
	logger := c.logger.With("plugin", plugin, "method", "PluginValues")
	logger.Debug("Listing settings values for plugin")

	if plugin == "" {
		return nil
	}
	client, ok := c.clients[plugin]
	if !ok {
		logger.Error(errors.New("plugin not found"))
		return nil
	}

	values := make(map[string]any)
	clientValues := client.ListSettings()
	for settingID, setting := range clientValues {
		// create the key for the setting
		key := fmt.Sprintf("%s.%s", plugin, settingID)
		// add the setting to the map
		values[key] = setting.Value
	}

	return values
}

// ListSettings returns the settings store.
func (c *controller) ListSettings(plugin string) map[string]pkgsettings.Setting {
	logger := c.logger.With("plugin", plugin, "method", "ListSettings")

	client, ok := c.clients[plugin]
	if !ok {
		logger.Error(errors.New("plugin not found"))
		return nil
	}

	return client.ListSettings()
}

// GetSetting returns the setting by ID. This ID should be in the form of a dot separated string
// that represents the path to the setting. For example, "appearance.theme".
func (c *controller) GetSetting(plugin, id string) (pkgsettings.Setting, error) {
	logger := c.logger.With("plugin", plugin, "method", "GetSetting", "id", id)

	client, ok := c.clients[plugin]
	if !ok {
		err := errors.New("plugin not found")
		logger.Error(err)
		return pkgsettings.Setting{}, err
	}

	return client.GetSetting(id)
}

// SetSetting sets the value of the setting by ID.
func (c *controller) SetSetting(plugin, id string, value any) error {
	logger := c.logger.With("plugin", plugin, "method", "SetSetting", "id", id)

	client, ok := c.clients[plugin]
	if !ok {
		err := errors.New("plugin not found")
		logger.Error(err)
		return err
	}

	return client.SetSetting(id, value)
}

// SetSettings sets multiple settings at once.
func (c *controller) SetSettings(plugin string, settings map[string]any) error {
	logger := c.logger.With("plugin", plugin, "method", "SetSettings", "entries", settings)

	client, ok := c.clients[plugin]
	if !ok {
		err := errors.New("plugin not found")
		logger.Error(err)
		return err
	}

	return client.SetSettings(settings)
}
