package settings

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
)

const (
	PluginName = "settings"
)

var tracer = otel.Tracer("omniview.settings")

// Service is the system/UI facing interface for making settings requests.
type Service interface {
	// ListPlugins returns a list of all the plugins that are registered with the settings controller
	ListPlugins() ([]string, error)

	// Values returns a list of all of the values calculated in the current setting store
	Values() map[string]any

	// PluginValues returns a list of all of the values calculated in the plugin's setting store
	PluginValues(plugin string) map[string]any

	// ListSettings returns the settings store
	ListSettings(plugin string) map[string]pkgsettings.Setting

	// GetSetting returns the setting by ID. This ID should be in the form of a dot separated string
	// that represents the path to the setting. For example, "appearance.theme"
	GetSetting(plugin, id string) (pkgsettings.Setting, error)

	// SetSetting sets the value of the setting by ID
	SetSetting(plugin, id string, value any) error

	// SetSettings sets multiple settings at once
	SetSettings(plugin string, settings map[string]any) error
}

// Controller handles all requests to interface with the settings capabilities on installed plugins.
//
// This controller is embedded in the client IDE facing client.
type Controller interface {
	internaltypes.Controller
	ServiceStartup(ctx context.Context, options application.ServiceOptions) error
	ServiceShutdown() error
	Service
}

// runtime assertion to make sure we satisfy both internal and external interfaces.
var _ Controller = (*controller)(nil)

// pendingChange represents a queued settings change for a plugin that is not yet hydrated.
type pendingChange struct {
	settings map[string]any
	errCh    chan error
}

type controller struct {
	logger           logging.Logger
	settingsProvider pkgsettings.Provider
	store            *settingsstore.Store
	mu               sync.RWMutex
	clients          map[string]SettingsProvider
	hydrated         map[string]bool
	schemaCache      map[string]map[string]pkgsettings.Setting
	pendingMu        sync.Mutex
	pendingChanges   map[string][]pendingChange
	hydratingMu      sync.Mutex
	hydrating        map[string]bool
}

// NewController returns a new Controller instance.
func NewController(logger logging.Logger, sp pkgsettings.Provider, store *settingsstore.Store) Controller {
	return &controller{
		logger:           logger.Named("SettingsController"),
		settingsProvider: sp,
		store:            store,
		clients:          make(map[string]SettingsProvider),
		hydrated:         make(map[string]bool),
		schemaCache:      make(map[string]map[string]pkgsettings.Setting),
		pendingChanges:   make(map[string][]pendingChange),
		hydrating:        make(map[string]bool),
	}
}

func (c *controller) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

func (c *controller) ServiceShutdown() error {
	return nil
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
	ctx := context.Background()
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginStart")

	provider, err := dispenseProvider(pluginID, backend)
	if err != nil {
		logger.Errorw(ctx, "error", "error", err)
		return err
	}

	// Mark as hydrating before publishing the client so that concurrent
	// readers calling tryHydrate will see the guard and skip.
	c.hydratingMu.Lock()
	c.hydrating[pluginID] = true
	c.hydratingMu.Unlock()

	c.mu.Lock()
	c.clients[pluginID] = provider
	c.mu.Unlock()

	// Hydrate the plugin from bbolt (hydratePlugin clears the hydrating flag via its callers).
	c.hydratePlugin(ctx, pluginID, provider, logger)

	c.hydratingMu.Lock()
	delete(c.hydrating, pluginID)
	c.hydratingMu.Unlock()

	return nil
}

// hydratePlugin reads the plugin's declared schema, merges with persisted values from bbolt,
// pushes the merged values to the plugin, and persists the result.
func (c *controller) hydratePlugin(ctx context.Context, pluginID string, client SettingsProvider, logger logging.Logger) {
	// 1. Get the plugin's declared schema
	schema := client.ListSettings()
	if schema == nil {
		logger.Warnw(ctx, "plugin returned nil schema, skipping hydration", "plugin", pluginID)
		c.mu.Lock()
		c.hydrated[pluginID] = false
		c.mu.Unlock()
		c.failPendingChanges(pluginID, errors.New("plugin returned nil schema"))
		return
	}

	// 2. Load persisted values from bbolt
	var persisted map[string]any
	if c.store != nil {
		var err error
		persisted, err = c.store.LoadPluginSettings(pluginID)
		if err != nil {
			logger.Warnw(ctx, "failed to load persisted settings", "plugin", pluginID, "error", err)
			persisted = make(map[string]any)
		}
	} else {
		persisted = make(map[string]any)
	}

	// 3. Merge: for each setting in schema, prefer persisted value, otherwise use default
	merged := make(map[string]any, len(schema))
	for key, setting := range schema {
		if val, ok := persisted[key]; ok {
			merged[key] = val
		} else if setting.Value != nil {
			merged[key] = setting.Value
		} else {
			merged[key] = setting.Default
		}
	}

	// 4. Push merged values to the plugin
	if err := client.SetSettings(merged); err != nil {
		logger.Errorw(ctx, "failed to push hydrated settings to plugin", "plugin", pluginID, "error", err)
		c.mu.Lock()
		c.hydrated[pluginID] = false
		c.mu.Unlock()
		c.failPendingChanges(pluginID, fmt.Errorf("hydration failed: %w", err))
		return
	}

	// 5. Persist merged state
	if c.store != nil {
		if err := c.store.SavePluginSettings(pluginID, merged); err != nil {
			logger.Warnw(ctx, "failed to persist merged settings", "plugin", pluginID, "error", err)
		}
	}

	// 6. Mark as hydrated and cache the schema for fallback use
	c.mu.Lock()
	c.hydrated[pluginID] = true
	c.schemaCache[pluginID] = schema
	c.mu.Unlock()

	// 7. Drain pending changes
	c.drainPendingChanges(ctx, pluginID, client, logger)
}

// failPendingChanges removes and fails all pending changes for a plugin, sending err on each errCh.
func (c *controller) failPendingChanges(pluginID string, err error) {
	c.pendingMu.Lock()
	pending := c.pendingChanges[pluginID]
	delete(c.pendingChanges, pluginID)
	c.pendingMu.Unlock()

	for _, p := range pending {
		if p.errCh != nil {
			p.errCh <- err
		}
	}
}

// drainPendingChanges applies any queued settings changes for a plugin.
func (c *controller) drainPendingChanges(ctx context.Context, pluginID string, client SettingsProvider, logger logging.Logger) {
	c.pendingMu.Lock()
	pending := c.pendingChanges[pluginID]
	delete(c.pendingChanges, pluginID)
	c.pendingMu.Unlock()

	var anySuccess bool
	for _, p := range pending {
		err := client.SetSettings(p.settings)
		if err == nil {
			anySuccess = true
		}
		if p.errCh != nil {
			p.errCh <- err
		}
	}

	// Persist once after all pending changes are applied, rather than per-change.
	if anySuccess {
		c.persistCurrentSettings(ctx, pluginID, client, logger)
	}
}

// persistCurrentSettings reads the current settings from the plugin and persists them.
func (c *controller) persistCurrentSettings(ctx context.Context, pluginID string, client SettingsProvider, logger logging.Logger) {
	if c.store == nil {
		return
	}
	allSettings := client.ListSettings()
	if allSettings == nil {
		return
	}
	vals := make(map[string]any, len(allSettings))
	for k, s := range allSettings {
		vals[k] = s.Value
	}
	if err := c.store.SavePluginSettings(pluginID, vals); err != nil {
		logger.Warnw(ctx, "failed to persist plugin settings", "plugin", pluginID, "error", err)
	}
}

// tryHydrate attempts hydration if the plugin is not yet hydrated.
// Returns true if the plugin is hydrated (or became so).
// It guards against concurrent hydration of the same plugin.
func (c *controller) tryHydrate(ctx context.Context, pluginID string) bool {
	c.mu.RLock()
	isHydrated := c.hydrated[pluginID]
	client, hasClient := c.clients[pluginID]
	c.mu.RUnlock()

	if isHydrated || !hasClient {
		return isHydrated
	}

	// Prevent redundant concurrent hydrations for the same plugin.
	c.hydratingMu.Lock()
	if c.hydrating[pluginID] {
		c.hydratingMu.Unlock()
		return false
	}
	c.hydrating[pluginID] = true
	c.hydratingMu.Unlock()

	defer func() {
		c.hydratingMu.Lock()
		delete(c.hydrating, pluginID)
		c.hydratingMu.Unlock()
	}()

	logger := c.logger.With(logging.Any("pluginID", pluginID))
	c.hydratePlugin(ctx, pluginID, client, logger)

	c.mu.RLock()
	result := c.hydrated[pluginID]
	c.mu.RUnlock()
	return result
}

func (c *controller) OnPluginStop(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginStop")

	c.mu.Lock()
	delete(c.clients, pluginID)
	c.hydrated[pluginID] = false
	c.mu.Unlock()

	// Discard any pending changes (plugin is no longer running).
	c.failPendingChanges(pluginID, errors.New("plugin stopped"))

	return nil
}

func (c *controller) OnPluginShutdown(pluginID string, meta config.PluginMeta) error {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginShutdown")

	return c.OnPluginStop(pluginID, meta)
}

func (c *controller) OnPluginDestroy(pluginID string, meta config.PluginMeta) error {
	ctx := context.Background()
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(ctx, "OnPluginDestroy")

	// Delete persisted settings from bbolt
	if c.store != nil {
		if err := c.store.DeletePluginSettings(pluginID); err != nil {
			logger.Warnw(ctx, "failed to delete plugin settings from store", "plugin", pluginID, "error", err)
		}
	}

	// Discard any pending changes
	c.failPendingChanges(pluginID, errors.New("plugin destroyed"))

	c.mu.Lock()
	delete(c.hydrated, pluginID)
	delete(c.clients, pluginID)
	delete(c.schemaCache, pluginID)
	c.mu.Unlock()

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

// bboltFallbackSettings loads settings from bbolt when gRPC is unavailable.
// It enriches each setting with metadata from the cached schema (populated
// during hydration). If no schema is cached, Type defaults to Text.
func (c *controller) bboltFallbackSettings(pluginID string) map[string]pkgsettings.Setting {
	if c.store == nil {
		return nil
	}
	vals, err := c.store.LoadPluginSettings(pluginID)
	if err != nil || len(vals) == 0 {
		return nil
	}

	c.mu.RLock()
	schema := c.schemaCache[pluginID]
	c.mu.RUnlock()

	result := make(map[string]pkgsettings.Setting, len(vals))
	for k, v := range vals {
		if cached, ok := schema[k]; ok {
			copy := cached
			copy.Value = v
			result[k] = copy
		} else {
			result[k] = pkgsettings.Setting{
				ID:    k,
				Label: k,
				Type:  pkgsettings.Text,
				Value: v,
			}
		}
	}
	return result
}

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
		// Attempt hydration if not yet done
		c.tryHydrate(ctx, pluginID)

		clientValues := client.ListSettings()
		if clientValues == nil {
			// gRPC failed, fall back to bbolt
			if fallback := c.bboltFallbackSettings(pluginID); fallback != nil {
				clientValues = fallback
			}
		}
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

	// Attempt hydration if not yet done
	c.tryHydrate(ctx, plugin)

	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		// No client — try bbolt fallback
		if fallback := c.bboltFallbackSettings(plugin); fallback != nil {
			values := make(map[string]any, len(fallback))
			for settingID, setting := range fallback {
				key := fmt.Sprintf("%s.%s", plugin, settingID)
				values[key] = setting.Value
			}
			return values
		}
		err := errors.New("plugin not found")
		telemetryutil.RecordError(span, err)
		logger.Errorw(ctx, "plugin not found", "error", err)
		return nil
	}

	clientValues := client.ListSettings()
	if clientValues == nil {
		// gRPC failed, fall back to bbolt
		if fallback := c.bboltFallbackSettings(plugin); fallback != nil {
			clientValues = fallback
		}
	}

	values := make(map[string]any)
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

	// Attempt hydration if not yet done
	c.tryHydrate(ctx, plugin)

	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		telemetryutil.RecordError(span, errors.New("plugin not found"))
		logger.Errorw(ctx, "plugin not found for ListSettings")
		// Fall back to bbolt
		return c.bboltFallbackSettings(plugin)
	}

	result := client.ListSettings()
	if result == nil {
		// gRPC failed, fall back to bbolt
		return c.bboltFallbackSettings(plugin)
	}
	return result
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

	// Attempt hydration if not yet done
	c.tryHydrate(ctx, plugin)

	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		// Try bbolt fallback
		if fallback := c.bboltFallbackSettings(plugin); fallback != nil {
			if s, found := fallback[id]; found {
				return s, nil
			}
		}
		retErr = apperror.PluginNotFound(plugin)
		logger.Errorw(ctx, "plugin not found for GetSetting", "error", retErr)
		return pkgsettings.Setting{}, retErr
	}

	setting, err := client.GetSetting(id)
	if err != nil {
		// gRPC failed, try bbolt fallback
		if fallback := c.bboltFallbackSettings(plugin); fallback != nil {
			if s, found := fallback[id]; found {
				return s, nil
			}
		}
		return pkgsettings.Setting{}, err
	}
	return setting, nil
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
	isHydrated := c.hydrated[plugin]
	c.mu.RUnlock()

	// If no client or not hydrated, queue the change
	if !ok || !isHydrated {
		if !ok {
			retErr = apperror.PluginNotFound(plugin)
			logger.Errorw(ctx, "plugin not found for SetSetting", "error", retErr)
			return retErr
		}
		// Not hydrated — queue
		errCh := make(chan error, 1)
		c.pendingMu.Lock()
		c.pendingChanges[plugin] = append(c.pendingChanges[plugin], pendingChange{
			settings: map[string]any{id: value},
			errCh:    errCh,
		})
		c.pendingMu.Unlock()
		select {
		case err := <-errCh:
			return err
		case <-time.After(30 * time.Second):
			c.pendingMu.Lock()
			pending := c.pendingChanges[plugin]
			for i, p := range pending {
				if p.errCh == errCh {
					c.pendingChanges[plugin] = append(pending[:i], pending[i+1:]...)
					break
				}
			}
			c.pendingMu.Unlock()
			return fmt.Errorf("timeout waiting for plugin %q to hydrate", plugin)
		}
	}

	if err := client.SetSetting(id, value); err != nil {
		return err
	}

	// Persist after successful gRPC
	c.persistCurrentSettings(ctx, plugin, client, logger)

	return nil
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
	isHydrated := c.hydrated[plugin]
	c.mu.RUnlock()

	// If no client or not hydrated, queue the change
	if !ok || !isHydrated {
		if !ok {
			retErr = apperror.PluginNotFound(plugin)
			logger.Errorw(ctx, "plugin not found for SetSettings", "error", retErr)
			return retErr
		}
		// Not hydrated — queue (clone the map to avoid caller mutation)
		cloned := make(map[string]any, len(settings))
		for k, v := range settings {
			cloned[k] = v
		}
		errCh := make(chan error, 1)
		c.pendingMu.Lock()
		c.pendingChanges[plugin] = append(c.pendingChanges[plugin], pendingChange{
			settings: cloned,
			errCh:    errCh,
		})
		c.pendingMu.Unlock()
		select {
		case err := <-errCh:
			return err
		case <-time.After(30 * time.Second):
			c.pendingMu.Lock()
			pending := c.pendingChanges[plugin]
			for i, p := range pending {
				if p.errCh == errCh {
					c.pendingChanges[plugin] = append(pending[:i], pending[i+1:]...)
					break
				}
			}
			c.pendingMu.Unlock()
			return fmt.Errorf("timeout waiting for plugin %q to hydrate", plugin)
		}
	}

	if err := client.SetSettings(settings); err != nil {
		return err
	}

	// Persist after successful gRPC
	c.persistCurrentSettings(ctx, plugin, client, logger)

	return nil
}
