package settings

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// pluginMeta returns a minimal config.PluginMeta for testing.
func pluginMeta(id string) config.PluginMeta {
	return config.PluginMeta{ID: id}
}

// mockSettingsProvider implements Provider for testing.
type mockSettingsProvider struct {
	settings   map[string]pkgsettings.Setting
	setErr     error
	getErr     error
	listReturn map[string]pkgsettings.Setting // if non-nil, overrides settings for ListSettings
	uncertain  bool
}

func newMockProvider(settings map[string]pkgsettings.Setting) *mockSettingsProvider {
	return &mockSettingsProvider{
		settings: settings,
	}
}

func (m *mockSettingsProvider) ListSettings() map[string]pkgsettings.Setting {
	if m.listReturn != nil {
		return m.listReturn
	}
	return m.settings
}

func (m *mockSettingsProvider) GetSetting(id string) (pkgsettings.Setting, error) {
	if m.getErr != nil {
		return pkgsettings.Setting{}, m.getErr
	}
	s, ok := m.settings[id]
	if !ok {
		return pkgsettings.Setting{}, assert.AnError
	}
	return s, nil
}

func (m *mockSettingsProvider) ValidateSetting(id string, value any) (pkgsettings.ValidationResult, error) {
	setting, err := m.GetSetting(id)
	if err != nil {
		return pkgsettings.ValidationResult{}, err
	}
	return setting.Validation(value), nil
}

func (m *mockSettingsProvider) GetSettingValue(id string) (any, error) {
	s, err := m.GetSetting(id)
	if err != nil {
		return nil, err
	}
	return s.Value, nil
}

func (m *mockSettingsProvider) CommitSettings(
	ctx context.Context,
	vals map[string]any,
	persist pkgsettings.PersistFunc,
) (pkgsettings.CommitResult, error) {
	if err := ctx.Err(); err != nil {
		return pkgsettings.CommitResult{}, err
	}
	if m.setErr != nil {
		return pkgsettings.CommitResult{}, m.setErr
	}
	if persist != nil {
		if err := persist(vals); err != nil {
			return pkgsettings.CommitResult{}, err
		}
	}
	if m.uncertain {
		return pkgsettings.CommitResult{Committed: true, Uncertain: true}, nil
	}
	for k, v := range vals {
		if s, ok := m.settings[k]; ok {
			s.Value = v
			m.settings[k] = s
		}
	}
	return pkgsettings.CommitResult{Committed: true, Applied: true}, nil
}

func openTestStore(t *testing.T) *settingsstore.Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test-settings.db")
	s, err := settingsstore.Open(dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return s
}

func TestOnPluginStart_HydratesFromBbolt(t *testing.T) {
	store := openTestStore(t)

	// Pre-persist values in bbolt
	require.NoError(t, store.SavePluginSettings("testplugin", map[string]any{
		"theme": "dark",
		"lang":  "en",
	}))

	// Create a mock provider with schema that includes the persisted keys
	mock := newMockProvider(map[string]pkgsettings.Setting{
		"theme": {ID: "theme", Value: "light", Default: "light"},
		"lang":  {ID: "lang", Value: nil, Default: "en-US"},
		"size":  {ID: "size", Value: nil, Default: 12},
	})

	ctrl := &controller{
		logger:         logging.NewNop().Named("test"),
		store:          store,
		clients:        map[string]Provider{"testplugin": mock},
		hydrated:       make(map[string]bool),
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	ctrl.hydratePlugin(context.Background(), "testplugin", mock, ctrl.logger)

	// Verify hydration: persisted values should override defaults
	assert.True(t, ctrl.hydrated["testplugin"])
	assert.Equal(t, "dark", mock.settings["theme"].Value) // from bbolt
	assert.Equal(t, "en", mock.settings["lang"].Value)    // from bbolt
	assert.Equal(t, 12, mock.settings["size"].Value)      // default (not in bbolt)

	// Verify bbolt was updated with merged values
	vals, err := store.LoadPluginSettings("testplugin")
	require.NoError(t, err)
	assert.Equal(t, "dark", vals["theme"])
	assert.Equal(t, "en", vals["lang"])
	assert.InDelta(t, 12, vals["size"], 0) // JSON round-trips integers as float64
}

func TestOnPluginStart_NoPersisted(t *testing.T) {
	store := openTestStore(t)

	// No pre-persisted values — first-time plugin
	mock := newMockProvider(map[string]pkgsettings.Setting{
		"theme": {ID: "theme", Value: "light", Default: "light"},
		"lang":  {ID: "lang", Value: nil, Default: "en-US"},
	})

	ctrl := &controller{
		logger:         logging.NewNop().Named("test"),
		store:          store,
		clients:        map[string]Provider{"testplugin": mock},
		hydrated:       make(map[string]bool),
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	ctrl.hydratePlugin(context.Background(), "testplugin", mock, ctrl.logger)

	assert.True(t, ctrl.hydrated["testplugin"])
	assert.Equal(t, "light", mock.settings["theme"].Value) // from Value field
	assert.Equal(t, "en-US", mock.settings["lang"].Value)  // from Default (Value was nil)

	// Verify bbolt now has defaults
	vals, err := store.LoadPluginSettings("testplugin")
	require.NoError(t, err)
	assert.Equal(t, "light", vals["theme"])
	assert.Equal(t, "en-US", vals["lang"])
}

func TestCommitSettings_PersistsToBbolt(t *testing.T) {
	store := openTestStore(t)

	mock := newMockProvider(map[string]pkgsettings.Setting{
		"theme": {ID: "theme", Value: "light", Default: "light"},
	})

	ctrl := &controller{
		logger:         logging.NewNop().Named("test"),
		store:          store,
		clients:        map[string]Provider{"testplugin": mock},
		hydrated:       map[string]bool{"testplugin": true},
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	_, err := ctrl.CommitSettings(
		context.Background(), "testplugin", map[string]any{"theme": "dark"},
		func(values map[string]any) error {
			return store.PatchPluginSettings("testplugin", values)
		},
	)
	require.NoError(t, err)

	// Verify value was persisted to bbolt
	vals, err := store.LoadPluginSettings("testplugin")
	require.NoError(t, err)
	assert.Equal(t, "dark", vals["theme"])
}

func TestCommitSettings_GRPCFails_NoPersistence(t *testing.T) {
	store := openTestStore(t)

	mock := newMockProvider(map[string]pkgsettings.Setting{
		"theme": {ID: "theme", Value: "light", Default: "light"},
	})
	mock.setErr = assert.AnError // gRPC will fail

	ctrl := &controller{
		logger:         logging.NewNop().Named("test"),
		store:          store,
		clients:        map[string]Provider{"testplugin": mock},
		hydrated:       map[string]bool{"testplugin": true},
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	_, err := ctrl.CommitSettings(
		context.Background(), "testplugin", map[string]any{"theme": "dark"},
		func(values map[string]any) error {
			return store.PatchPluginSettings("testplugin", values)
		},
	)
	require.Error(t, err)

	// Verify bbolt was NOT updated
	vals, err := store.LoadPluginSettings("testplugin")
	require.NoError(t, err)
	assert.Empty(t, vals) // nothing persisted
}

func TestPluginCrash_SettingsPreserved(t *testing.T) {
	store := openTestStore(t)

	// Simulate a plugin that was running and had persisted settings
	require.NoError(t, store.SavePluginSettings("testplugin", map[string]any{
		"theme": "dark",
		"lang":  "en",
	}))

	ctrl := &controller{
		logger:         logging.NewNop().Named("test"),
		store:          store,
		clients:        make(map[string]Provider),
		hydrated:       make(map[string]bool),
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	// After crash, client is removed (OnPluginStop)
	// Settings should still be in bbolt
	vals, err := store.LoadPluginSettings("testplugin")
	require.NoError(t, err)
	assert.Equal(t, "dark", vals["theme"])
	assert.Equal(t, "en", vals["lang"])

	// A disconnected plugin retains the last authoritative schema for safe reads.
	ctrl.schemaCache["testplugin"] = map[string]pkgsettings.Setting{
		"theme": {ID: "theme"}, "lang": {ID: "lang"},
	}
	snapshot, err := ctrl.Snapshot("testplugin")
	require.NoError(t, err)
	assert.Equal(t, "dark", snapshot.Settings["theme"].Value)
	assert.Equal(t, "en", snapshot.Settings["lang"].Value)
}

func TestUninstall_DeletesFromBbolt(t *testing.T) {
	store := openTestStore(t)

	// Pre-persist
	require.NoError(t, store.SavePluginSettings("testplugin", map[string]any{
		"theme": "dark",
	}))

	ctrl := &controller{
		logger:         logging.NewNop().Named("test"),
		store:          store,
		clients:        make(map[string]Provider),
		hydrated:       make(map[string]bool),
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	err := ctrl.OnPluginDestroy("testplugin", pluginMeta("testplugin"))
	require.NoError(t, err)

	// Verify bbolt no longer has the plugin
	vals, err := store.LoadPluginSettings("testplugin")
	require.NoError(t, err)
	assert.Empty(t, vals)
}

func TestSnapshot_UsesSavedValuesWithoutRemoteRead(t *testing.T) {
	store := openTestStore(t)

	// Pre-persist values
	require.NoError(t, store.SavePluginSettings("testplugin", map[string]any{
		"theme": "dark",
		"lang":  "en",
	}))

	// Mock provider returns nil from ListSettings (simulating stale gRPC)
	mock := newMockProvider(nil)
	mock.listReturn = nil // explicitly nil

	ctrl := &controller{
		logger:         logging.NewNop().Named("test"),
		store:          store,
		clients:        map[string]Provider{"testplugin": mock},
		hydrated:       map[string]bool{"testplugin": true},
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	ctrl.schemaCache["testplugin"] = map[string]pkgsettings.Setting{
		"theme": {ID: "theme"}, "lang": {ID: "lang"},
	}
	snapshot, err := ctrl.Snapshot("testplugin")
	require.NoError(t, err)
	assert.Equal(t, "dark", snapshot.Settings["theme"].Value)
	assert.Equal(t, "en", snapshot.Settings["lang"].Value)
}

func TestValidateSettingRequiresLivePluginAndPreservesFeedback(t *testing.T) {
	ctrl, ok := NewController(logging.NewNop(), openTestStore(t)).(*controller)
	require.True(t, ok)
	ctrl.clients["fixture"] = newMockProvider(map[string]pkgsettings.Setting{
		"tool": {ID: "tool", Type: pkgsettings.Text, Value: "saved", Validator: func(value any) pkgsettings.ValidationResult {
			return pkgsettings.ValidationResult{Valid: value == "good", Code: "tool_check", Message: "Tool check completed."}
		}},
	})
	result, err := ctrl.ValidateSetting("fixture", "tool", "bad")
	require.NoError(t, err)
	require.False(t, result.Valid)
	require.Equal(t, "tool_check", result.Code)
	require.Equal(t, "saved", ctrl.clients["fixture"].ListSettings()["tool"].Value)
	result, err = ctrl.ValidateSetting("fixture", "tool", "good")
	require.NoError(t, err)
	require.True(t, result.Valid)
	_, err = ctrl.ValidateSetting("missing", "tool", "good")
	require.Error(t, err)
}
