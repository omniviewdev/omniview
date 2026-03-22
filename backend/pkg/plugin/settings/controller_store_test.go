package settings

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
)

// pluginMeta returns a minimal config.PluginMeta for testing.
func pluginMeta(id string) config.PluginMeta {
	return config.PluginMeta{ID: id}
}

// mockSettingsProvider implements SettingsProvider for testing.
type mockSettingsProvider struct {
	settings   map[string]pkgsettings.Setting
	setErr     error
	getErr     error
	listReturn map[string]pkgsettings.Setting // if non-nil, overrides settings for ListSettings
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

func (m *mockSettingsProvider) GetSettingValue(id string) (any, error) {
	s, err := m.GetSetting(id)
	if err != nil {
		return nil, err
	}
	return s.Value, nil
}

func (m *mockSettingsProvider) SetSetting(id string, value any) error {
	if m.setErr != nil {
		return m.setErr
	}
	if s, ok := m.settings[id]; ok {
		s.Value = value
		m.settings[id] = s
	}
	return nil
}

func (m *mockSettingsProvider) SetSettings(vals map[string]any) error {
	if m.setErr != nil {
		return m.setErr
	}
	for k, v := range vals {
		if s, ok := m.settings[k]; ok {
			s.Value = v
			m.settings[k] = s
		}
	}
	return nil
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
		clients:        map[string]SettingsProvider{"testplugin": mock},
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
		clients:        map[string]SettingsProvider{"testplugin": mock},
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

func TestSetSetting_PersistsToBbolt(t *testing.T) {
	store := openTestStore(t)

	mock := newMockProvider(map[string]pkgsettings.Setting{
		"theme": {ID: "theme", Value: "light", Default: "light"},
	})

	ctrl := &controller{
		logger:         logging.NewNop().Named("test"),
		store:          store,
		clients:        map[string]SettingsProvider{"testplugin": mock},
		hydrated:       map[string]bool{"testplugin": true},
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	err := ctrl.SetSetting("testplugin", "theme", "dark")
	require.NoError(t, err)

	// Verify value was persisted to bbolt
	vals, err := store.LoadPluginSettings("testplugin")
	require.NoError(t, err)
	assert.Equal(t, "dark", vals["theme"])
}

func TestSetSetting_GRPCFails_NoPersistence(t *testing.T) {
	store := openTestStore(t)

	mock := newMockProvider(map[string]pkgsettings.Setting{
		"theme": {ID: "theme", Value: "light", Default: "light"},
	})
	mock.setErr = assert.AnError // gRPC will fail

	ctrl := &controller{
		logger:         logging.NewNop().Named("test"),
		store:          store,
		clients:        map[string]SettingsProvider{"testplugin": mock},
		hydrated:       map[string]bool{"testplugin": true},
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	err := ctrl.SetSetting("testplugin", "theme", "dark")
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
		clients:        make(map[string]SettingsProvider),
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

	// bbolt fallback should work via ListSettings
	settings := ctrl.ListSettings("testplugin")
	require.NotNil(t, settings)
	assert.Equal(t, "dark", settings["theme"].Value)
	assert.Equal(t, "en", settings["lang"].Value)
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
		clients:        make(map[string]SettingsProvider),
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

func TestStaleClient_ReturnsBboltFallback(t *testing.T) {
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
		clients:        map[string]SettingsProvider{"testplugin": mock},
		hydrated:       map[string]bool{"testplugin": true},
		schemaCache:    make(map[string]map[string]pkgsettings.Setting),
		pendingChanges: make(map[string][]pendingChange),
	}

	settings := ctrl.ListSettings("testplugin")
	require.NotNil(t, settings)
	assert.Equal(t, "dark", settings["theme"].Value)
	assert.Equal(t, "en", settings["lang"].Value)
}
