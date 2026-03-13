package settings

import (
	"context"
	"errors"
	"fmt"
	"sync"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
)

const (
	PluginName = "settings"
)

var tracer = otel.Tracer("omniview.settings")

// Controller handles all requests to interface with the settings capabilities on installed plugins.
//
// This controller is embedded in the client IDE facing client.
type Controller interface {
	internaltypes.Controller
	Service
}

// runtime assertion to make sure we satisfy both internal and external interfaces.
var _ Controller = (*controller)(nil)

type controller struct {
	logger           logging.Logger
	settingsProvider pkgsettings.Provider
	mu               sync.RWMutex
	clients          map[string]SettingsProvider
}

// NewController returns a new Controller instance.
func NewController(logger logging.Logger, sp pkgsettings.Provider) Controller {
	return &controller{
		logger:           logger.Named("SettingsController"),
		settingsProvider: sp,
		clients:          make(map[string]SettingsProvider),
	}
}

func (c *controller) OnPluginInit(pluginID string, meta config.PluginMeta) {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginInit")

	c.mu.Lock()
	if c.clients == nil {
		c.clients = make(map[string]SettingsProvider)
	}
	c.mu.Unlock()
}

// dispenseProvider extracts the settings provider from the backend,
// wrapping it in the version-appropriate adapter.
func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (SettingsProvider, error) {
	raw, err := backend.Dispense(PluginName)
	if err != nil {
		return nil, err
	}

	version := backend.NegotiatedVersion()
	switch version {
	case 1:
		v1, ok := raw.(sdksettings.Provider)
		if !ok {
			return nil, apperror.New(
				apperror.TypePluginLoadFailed, 500,
				"Plugin type mismatch",
				fmt.Sprintf("Expected settings.Provider for v1, got %T", raw),
			)
		}
		return NewAdapterV1(v1), nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, 500,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for settings, engine supports v1", pluginID, version),
		)
	}
}

func (c *controller) OnPluginStart(
	pluginID string,
	meta config.PluginMeta,
	backend internaltypes.PluginBackend,
) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		logger.Errorw(context.Background(), "error", "error", err)
		return err
	}

	c.mu.Lock()
	c.clients[pluginID] = provider
	c.mu.Unlock()
	return nil
}

func (c *controller) OnPluginStop(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginStop")

	c.mu.Lock()
	delete(c.clients, pluginID)
	c.mu.Unlock()

	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginShutdown")

	return c.OnPluginStop(pluginID, meta)
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginDestroy")

	// nothing to do here
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
	c.logger.Debugw(context.Background(), "HasPlugin")

	c.mu.RLock()
	defer c.mu.RUnlock()
	_, hasClient := c.clients[pluginID]
	return hasClient
}

// ================================== CLIENT METHODS ================================== //

// Values returns all of the values for all of the plugins
func (c *controller) Values() map[string]any {
	ctx, span := tracer.Start(context.Background(), "settings.Values")
	defer span.End()
	logger := c.logger.With(logging.Any("method", "Values"))
	logger.Debugw(ctx, "Listing all settings values")

	c.mu.RLock()
	snapshot := make(map[string]SettingsProvider, len(c.clients))
	for k, v := range c.clients {
		snapshot[k] = v
	}
	c.mu.RUnlock()

	values := make(map[string]any)
	for pluginID, client := range snapshot {
		clientValues := client.ListSettings()
		for settingID, setting := range clientValues {
			key := fmt.Sprintf("%s.%s", pluginID, settingID)
			values[key] = setting.Value
		}
	}

	return values
}

func (c *controller) PluginValues(plugin string) map[string]any {
	ctx, span := tracer.Start(context.Background(), "settings.PluginValues")
	defer span.End()
	span.SetAttributes(attribute.String("plugin", plugin))
	logger := c.logger.With(logging.Any("plugin", plugin), logging.Any("method", "PluginValues"))
	logger.Debugw(ctx, "Listing settings values for plugin")

	if plugin == "" {
		return nil
	}
	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		err := errors.New("plugin not found")
		telemetryutil.RecordError(span, err)
		logger.Errorw(ctx, "plugin not found", "error", err)
		return nil
	}

	values := make(map[string]any)
	clientValues := client.ListSettings()
	for settingID, setting := range clientValues {
		key := fmt.Sprintf("%s.%s", plugin, settingID)
		values[key] = setting.Value
	}

	return values
}

// ListSettings returns the settings store.
func (c *controller) ListSettings(plugin string) map[string]pkgsettings.Setting {
	ctx, span := tracer.Start(context.Background(), "settings.ListSettings")
	defer span.End()
	span.SetAttributes(attribute.String("plugin", plugin))
	logger := c.logger.With(logging.Any("plugin", plugin), logging.Any("method", "ListSettings"))

	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		telemetryutil.RecordError(span, errors.New("plugin not found"))
		logger.Errorw(ctx, "plugin not found for ListSettings")
		return nil
	}

	return client.ListSettings()
}

// GetSetting returns the setting by ID. This ID should be in the form of a dot separated string
// that represents the path to the setting. For example, "appearance.theme".
func (c *controller) GetSetting(plugin, id string) (result pkgsettings.Setting, retErr error) {
	ctx, span := tracer.Start(context.Background(), "settings.GetSetting")
	defer span.End()
	defer func() {
		if retErr != nil {
			telemetryutil.RecordError(span, retErr)
		}
	}()
	span.SetAttributes(attribute.String("plugin", plugin), attribute.String("setting_id", id))
	logger := c.logger.With(logging.Any("plugin", plugin), logging.Any("method", "GetSetting"), logging.Any("id", id))

	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		retErr = apperror.PluginNotFound(plugin)
		logger.Errorw(ctx, "plugin not found for GetSetting", "error", retErr)
		return pkgsettings.Setting{}, retErr
	}

	return client.GetSetting(id)
}

// SetSetting sets the value of the setting by ID.
func (c *controller) SetSetting(plugin, id string, value any) (retErr error) {
	ctx, span := tracer.Start(context.Background(), "settings.SetSetting")
	defer span.End()
	defer func() {
		if retErr != nil {
			telemetryutil.RecordError(span, retErr)
		}
	}()
	span.SetAttributes(attribute.String("plugin", plugin), attribute.String("setting_id", id))
	logger := c.logger.With(logging.Any("plugin", plugin), logging.Any("method", "SetSetting"), logging.Any("id", id))

	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		retErr = apperror.PluginNotFound(plugin)
		logger.Errorw(ctx, "plugin not found for SetSetting", "error", retErr)
		return retErr
	}

	return client.SetSetting(id, value)
}

// SetSettings sets multiple settings at once.
func (c *controller) SetSettings(plugin string, settings map[string]any) (retErr error) {
	ctx, span := tracer.Start(context.Background(), "settings.SetSettings")
	defer span.End()
	defer func() {
		if retErr != nil {
			telemetryutil.RecordError(span, retErr)
		}
	}()
	span.SetAttributes(attribute.String("plugin", plugin))
	settingKeys := make([]string, 0, len(settings))
	for k := range settings {
		settingKeys = append(settingKeys, k)
	}
	logger := c.logger.With(logging.Any("plugin", plugin), logging.Any("method", "SetSettings"), logging.Any("keys", settingKeys))

	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		retErr = apperror.PluginNotFound(plugin)
		logger.Errorw(ctx, "plugin not found for SetSettings", "error", retErr)
		return retErr
	}

	return client.SetSettings(settings)
}
