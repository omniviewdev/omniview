package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const (
	PluginName = "settings"
)

var tracer = otel.Tracer("omniview.settings")

// Service exposes scoped operations and trusted schema access for control decoding.
type Service interface {
	ListPlugins() ([]string, error)
	Snapshot(pluginID string) (pkgsettings.Category, error)
	ListSettings(plugin string) map[string]pkgsettings.Setting
	GetSetting(plugin, id string) (pkgsettings.Setting, error)
	ValidateSetting(plugin, id string, value any) (pkgsettings.ValidationResult, error)
	CommitSettings(
		ctx context.Context,
		plugin string,
		values map[string]any,
		persist pkgsettings.PersistFunc,
	) (pkgsettings.CommitResult, error)
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

// pendingChangeTimeout bounds how long a queued settings change waits for the plugin to hydrate.
const pendingChangeTimeout = 30 * time.Second

// pendingChange represents a queued settings change for a plugin that is not yet hydrated.
type pendingChange struct {
	ctx      context.Context
	settings map[string]any
	persist  pkgsettings.PersistFunc
	done     chan commitOutcome
}

type commitOutcome struct {
	result pkgsettings.CommitResult
	err    error
}
type controller struct {
	logger           logging.Logger
	settingsProvider pkgsettings.Provider
	store            *settingsstore.Store
	mu               sync.RWMutex
	clients          map[string]Provider
	hydrated         map[string]bool
	schemaCache      map[string]map[string]pkgsettings.Setting
	baseline         map[string]map[string]any
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
		mu:               sync.RWMutex{},
		clients:          make(map[string]Provider),
		hydrated:         make(map[string]bool),
		schemaCache:      make(map[string]map[string]pkgsettings.Setting),
		baseline:         make(map[string]map[string]any),
		pendingMu:        sync.Mutex{},
		pendingChanges:   make(map[string][]pendingChange),
		hydratingMu:      sync.Mutex{},
		hydrating:        make(map[string]bool),
	}
}

func (c *controller) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

func (c *controller) ServiceShutdown() error {
	return nil
}

func (c *controller) OnPluginInit(pluginID string, _ config.PluginMeta) {
	logger := c.logger.With(logging.Any("pluginID", pluginID))
	logger.Debugw(context.Background(), "OnPluginInit")

	c.mu.Lock()
	if c.clients == nil {
		c.clients = make(map[string]Provider)
	}
	c.mu.Unlock()
}

// dispenseProvider extracts the negotiated settings provider directly.
func dispenseProvider(pluginID string, backend internaltypes.PluginBackend) (Provider, error) {
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
				apperror.TypePluginLoadFailed, http.StatusInternalServerError,
				"Plugin type mismatch",
				fmt.Sprintf("Expected settings.Provider for v1, got %T", raw),
			)
		}
		return v1, nil
	default:
		return nil, apperror.New(
			apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Unsupported SDK protocol version",
			fmt.Sprintf("Plugin '%s' negotiated v%d for settings, engine supports v1", pluginID, version),
		)
	}
}

func (c *controller) OnPluginStart(
	pluginID string,
	_ config.PluginMeta,
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
func (c *controller) hydratePlugin(
	ctx context.Context,
	pluginID string,
	client Provider,
	logger logging.Logger,
) {
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
			c.failPendingChanges(pluginID, err)
			return
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

	// Persist normalized hydration values before publishing them remotely.
	var persist pkgsettings.PersistFunc
	if c.store != nil {
		persist = func(values map[string]any) error {
			for id, value := range values {
				merged[id] = pkgsettings.CloneValue(value)
			}
			return c.store.SavePluginSettings(pluginID, merged)
		}
	}
	result, err := client.CommitSettings(ctx, merged, persist)
	if err != nil || !result.Applied {
		if err == nil {
			err = errors.New("hydration application uncertain")
		}
		logger.Errorw(ctx, "failed to push hydrated settings to plugin", "plugin", pluginID, "error", err)
		c.mu.Lock()
		c.hydrated[pluginID] = false
		c.mu.Unlock()
		c.failPendingChanges(pluginID, fmt.Errorf("hydration failed: %w", err))
		return
	}

	// 6. Mark as hydrated and cache the schema for fallback use
	c.mu.Lock()
	c.hydrated[pluginID] = true
	c.schemaCache[pluginID] = schema
	if c.baseline == nil {
		c.baseline = make(map[string]map[string]any)
	}
	baseline := make(map[string]any, len(merged))
	for id, value := range merged {
		baseline[id] = pkgsettings.CloneValue(value)
	}
	c.baseline[pluginID] = baseline
	c.mu.Unlock()

	// 7. Drain pending changes
	c.drainPendingChanges(ctx, pluginID, client, logger)
}

// failPendingChanges removes and rejects queued transactions for a plugin.
func (c *controller) failPendingChanges(pluginID string, err error) {
	c.pendingMu.Lock()
	pending := c.pendingChanges[pluginID]
	delete(c.pendingChanges, pluginID)
	c.pendingMu.Unlock()

	for _, p := range pending {
		if p.done != nil {
			p.done <- commitOutcome{
				result: pkgsettings.CommitResult{Committed: false, Applied: false, Uncertain: false},
				err:    err,
			}
		}
	}
}

// drainPendingChanges applies any queued settings changes for a plugin.
func (c *controller) drainPendingChanges(
	ctx context.Context,
	pluginID string,
	client Provider,
	logger logging.Logger,
) {
	c.pendingMu.Lock()
	pending := c.pendingChanges[pluginID]
	delete(c.pendingChanges, pluginID)
	c.pendingMu.Unlock()

	for _, p := range pending {
		result, err := c.commit(p.ctx, client, p.settings, p.persist)
		if p.done != nil {
			p.done <- commitOutcome{result: result, err: err}
		}
	}
}

// tryHydrate attempts hydration if the plugin is not yet hydrated.
// It guards against concurrent hydration of the same plugin.
func (c *controller) tryHydrate(ctx context.Context, pluginID string) {
	c.mu.RLock()
	isHydrated := c.hydrated[pluginID]
	client, hasClient := c.clients[pluginID]
	c.mu.RUnlock()

	if isHydrated || !hasClient {
		return
	}

	// Prevent redundant concurrent hydrations for the same plugin.
	c.hydratingMu.Lock()
	if c.hydrating[pluginID] {
		c.hydratingMu.Unlock()
		return
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
}

func (c *controller) OnPluginStop(pluginID string, _ config.PluginMeta) error {
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

func (c *controller) OnPluginDestroy(pluginID string, _ config.PluginMeta) error {
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
	delete(c.baseline, pluginID)
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
			merged := cached
			merged.Value = v
			result[k] = merged
		} else {
			result[k] = pkgsettings.Setting{
				ID:            k,
				Label:         k,
				Description:   "",
				Type:          pkgsettings.Text,
				Value:         v,
				Default:       nil,
				Validator:     nil,
				Options:       nil,
				FileSelection: nil,
				Sensitive:     false,
				DevOnly:       false,
			}
		}
	}
	return result
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
func (c *controller) GetSetting(plugin, id string) (_ pkgsettings.Setting, retErr error) {
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

// ValidateSetting requires a live plugin; persisted schema cannot execute callbacks.
func (c *controller) ValidateSetting(plugin, id string, value any) (pkgsettings.ValidationResult, error) {
	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		return pkgsettings.ValidationResult{}, apperror.PluginNotFound(plugin)
	}
	return client.ValidateSetting(id, value)
}

// CommitSettings queues writes until hydration completes and persists through the
// plugin's prepared transaction. IDs remain opaque within the plugin scope.
func (c *controller) CommitSettings(
	ctx context.Context,
	plugin string,
	values map[string]any,
	persist pkgsettings.PersistFunc,
) (pkgsettings.CommitResult, error) {
	c.mu.RLock()
	client, ok := c.clients[plugin]
	c.mu.RUnlock()
	if !ok {
		return pkgsettings.CommitResult{}, apperror.PluginNotFound(plugin)
	}
	c.pendingMu.Lock()
	c.mu.RLock()
	hydrated := c.hydrated[plugin]
	c.mu.RUnlock()
	if hydrated {
		c.pendingMu.Unlock()
		return c.commit(ctx, client, values, persist)
	}
	cloned := make(map[string]any, len(values))
	for id, value := range values {
		cloned[id] = pkgsettings.CloneValue(value)
	}
	queuedCtx, cancel := context.WithTimeout(ctx, pendingChangeTimeout)
	defer cancel()
	done := make(chan commitOutcome, 1)
	c.pendingChanges[plugin] = append(c.pendingChanges[plugin], pendingChange{
		ctx:      queuedCtx,
		settings: cloned,
		persist:  persist,
		done:     done,
	})
	c.pendingMu.Unlock()
	select {
	case outcome := <-done:
		return outcome.result, outcome.err
	case <-queuedCtx.Done():
		c.pendingMu.Lock()
		for i, change := range c.pendingChanges[plugin] {
			if change.done == done {
				pending := c.pendingChanges[plugin]
				c.pendingChanges[plugin] = append(pending[:i], pending[i+1:]...)
				c.pendingMu.Unlock()
				return pkgsettings.CommitResult{}, queuedCtx.Err()
			}
		}
		c.pendingMu.Unlock()
		// A drained transaction may already be durable. Never return a false rejection.
		outcome := <-done
		return outcome.result, outcome.err
	}
}

func (c *controller) commit(
	ctx context.Context,
	client Provider,
	values map[string]any,
	persist pkgsettings.PersistFunc,
) (pkgsettings.CommitResult, error) {
	if err := ctx.Err(); err != nil {
		return pkgsettings.CommitResult{}, err
	}
	if persist == nil {
		return pkgsettings.CommitResult{}, errors.New("settings persistence unavailable")
	}
	return client.CommitSettings(ctx, values, persist)
}

// Snapshot projects saved values through authoritative plugin schema. Unknown
// persisted values remain secret, including when no plugin connection exists.
func (c *controller) Snapshot(pluginID string) (pkgsettings.Category, error) {
	c.tryHydrate(context.Background(), pluginID)
	c.mu.RLock()
	schema := c.schemaCache[pluginID]
	baseline := c.baseline[pluginID]
	c.mu.RUnlock()
	projected := make(map[string]pkgsettings.Setting, len(schema))
	for id, setting := range schema {
		projected[id] = setting
	}
	if c.store != nil {
		saved, err := c.store.LoadPluginSettings(pluginID)
		if err != nil {
			return pkgsettings.Category{}, err
		}
		for id, value := range saved {
			setting, known := projected[id]
			if !known {
				setting = pkgsettings.Setting{ID: id}
			}
			setting.Value = pkgsettings.CloneValue(value)
			projected[id] = setting
		}
	}
	if len(projected) == 0 && schema == nil {
		return pkgsettings.Category{}, apperror.PluginNotFound(pluginID)
	}
	for id, setting := range projected {
		authoritative, known := schema[id]
		setting.RequiresRestart = known && authoritative.RequiresRestart
		initial, hasBaseline := baseline[id]
		setting.PendingRestart = setting.RequiresRestart && hasBaseline && !sameValue(initial, setting.Value)
		setting.Value = pkgsettings.CloneValue(setting.Value)
		setting.Default = pkgsettings.CloneValue(setting.Default)
		if !known || authoritative.Sensitive || authoritative.Type == pkgsettings.Password {
			setting.Sensitive = true
		}
		projected[id] = setting
	}
	return pkgsettings.Category{
		ID:          "plugin",
		Label:       "Plugin",
		Description: "",
		Icon:        "",
		Settings:    RedactSettingsSchema(projected),
	}, nil
}

func sameValue(left, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftJSON, rightJSON)
}
