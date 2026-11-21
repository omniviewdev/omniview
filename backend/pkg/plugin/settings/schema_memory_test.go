package settings

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// The host remembers which settings each plugin declared as ordinary preferences,
// the last time the plugin started. An uninstall classifies the plugin's stored
// values with the schema of the running session when there is one, and with that
// memory otherwise, so that a plugin that did not start in the session in which
// it is uninstalled (disabled, failed to start, host restarted) still loses its
// credentials and keeps its preferences.

// remembersBeforePersist is a settings provider that records whether the host
// had already remembered its schema when the host first stored a value for it.
type remembersBeforePersist struct {
	store    *settingsstore.Store
	schema   map[string]pkgsettings.Setting
	pluginID string
	seen     *bool
}

func (p remembersBeforePersist) ListSettings() map[string]pkgsettings.Setting { return p.schema }

func (remembersBeforePersist) ValidateSetting(string, any) (pkgsettings.ValidationResult, error) {
	return pkgsettings.ValidationResult{Valid: true}, nil
}

func (p remembersBeforePersist) CommitSettings(
	_ context.Context, values map[string]any, persist pkgsettings.PersistFunc,
) (pkgsettings.CommitResult, error) {
	_, remembered, err := p.store.LoadPluginSchema(p.pluginID)
	*p.seen = err == nil && remembered
	if persist != nil {
		if persistErr := persist(values); persistErr != nil {
			return pkgsettings.CommitResult{}, persistErr
		}
	}
	return pkgsettings.CommitResult{Committed: true, Applied: true}, nil
}

func TestHydrateRemembersTheSchemaBeforeAnyValueIsStored(t *testing.T) {
	store := openTestStore(t)
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	var seen bool
	provider := remembersBeforePersist{store: store, schema: uninstallSchema(), pluginID: "fixture", seen: &seen}
	ctrl.clients["fixture"] = provider

	ctrl.hydratePlugin(context.Background(), "fixture", provider, ctrl.logger)

	assert.True(t, seen, "a crash between the two writes must never leave values with no schema to classify them")
	ordinary, remembered, err := store.LoadPluginSchema("fixture")
	require.NoError(t, err)
	assert.True(t, remembered)
	assert.Equal(t, []string{"retries", "theme"}, ordinary, "only the declared ordinary settings: no secret, default or option")
}

// The plugin did not run in this session (disabled, failed to start, host
// restarted): only what an earlier start remembered can classify its values.
func TestOnPluginUninstalledKeepsDeclaredValuesWhenTheSchemaIsOnlyRemembered(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.RememberPluginSchema("fixture", []string{"theme", "retries"}))
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{
		"password": "pw-value", "token": "tok-value", "theme": "dark", "retries": 3, "legacyKey": "old-secret",
	}))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	saved, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark", "retries": float64(3)}, saved)
}

func TestOnPluginUninstalledAfterAStartThatReportedNoSchemaKeepsDeclaredValues(t *testing.T) {
	store := openTestStore(t)
	ctrl := hydratedController(t, store, map[string]any{"password": "pw-value", "token": "tok", "theme": "dark", "retries": 3})
	provider, ok := ctrl.clients["fixture"].(*mockSettingsProvider)
	require.True(t, ok)
	require.NoError(t, ctrl.OnPluginStop("fixture", config.PluginMeta{}))
	// The next start clears the session schema, then the plugin reports none.
	ctrl.mu.Lock()
	delete(ctrl.schemaCache, "fixture")
	delete(ctrl.baseline, "fixture")
	ctrl.clients["fixture"] = provider
	ctrl.mu.Unlock()
	provider.settings = nil
	ctrl.hydratePlugin(context.Background(), "fixture", provider, ctrl.logger)

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	saved, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark", "retries": float64(3)}, saved)
}

func TestHydrateReplacesTheRememberedSchemaWithTheLatestOne(t *testing.T) {
	store := openTestStore(t)
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	v1 := newMockProvider(map[string]pkgsettings.Setting{
		"endpoint": {ID: "endpoint", Type: pkgsettings.Text},
		"theme":    {ID: "theme", Type: pkgsettings.Text},
	})
	ctrl.clients["fixture"] = v1
	ctrl.hydratePlugin(context.Background(), "fixture", v1, ctrl.logger)
	require.NoError(t, store.PatchPluginSettings("fixture", map[string]any{"endpoint": "https://user:pw@host", "theme": "dark"}))

	// The next version declares the endpoint Sensitive.
	v2 := newMockProvider(map[string]pkgsettings.Setting{
		"endpoint": {ID: "endpoint", Type: pkgsettings.Text, Sensitive: true},
		"theme":    {ID: "theme", Type: pkgsettings.Text},
	})
	ctrl.clients["fixture"] = v2
	ctrl.hydratePlugin(context.Background(), "fixture", v2, ctrl.logger)
	// A restarted host has no session schema, only what was remembered.
	fresh, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)

	require.NoError(t, fresh.OnPluginUninstalled("fixture"))

	saved, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark"}, saved, "the value the latest schema calls sensitive does not survive")
}

func TestHydrateWithoutASchemaLeavesTheRememberedOneAlone(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.RememberPluginSchema("fixture", []string{"theme"}))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	provider := newMockProvider(nil)
	ctrl.clients["fixture"] = provider

	ctrl.hydratePlugin(context.Background(), "fixture", provider, ctrl.logger)

	ordinary, remembered, err := store.LoadPluginSchema("fixture")
	require.NoError(t, err)
	assert.True(t, remembered)
	assert.Equal(t, []string{"theme"}, ordinary)
}

func TestHydrateDropsTheRememberedSchemaOfAPluginWhoseSchemaIsTooLargeToRemember(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.RememberPluginSchema("fixture", []string{"theme", "retries"}))
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{"theme": "dark", "password": "pw-value"}))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	huge := uninstallSchema()
	huge[strings.Repeat("x", 300)] = pkgsettings.Setting{ID: "huge", Type: pkgsettings.Text}
	provider := newMockProvider(huge)
	ctrl.clients["fixture"] = provider

	ctrl.hydratePlugin(context.Background(), "fixture", provider, ctrl.logger)

	_, remembered, err := store.LoadPluginSchema("fixture")
	require.NoError(t, err)
	assert.False(t, remembered, "an earlier, possibly more permissive schema must not stand in for this one")
	// The session still knows the schema, so this session's uninstall is exact; a
	// restarted host would erase every value, which is the conservative side.
	fresh, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	require.NoError(t, fresh.OnPluginUninstalled("fixture"))
	saved, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Empty(t, saved)
}

func TestOnPluginUninstalledKeepsTheRememberedSchemaWhileValuesStay(t *testing.T) {
	store := openTestStore(t)
	ctrl := hydratedController(t, store, map[string]any{"password": "pw-value", "theme": "dark"})

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	// A reinstall that never starts, uninstalled again, must keep the same values
	// the first uninstall kept.
	ordinary, remembered, err := store.LoadPluginSchema("fixture")
	require.NoError(t, err)
	assert.True(t, remembered)
	assert.Equal(t, []string{"retries", "theme"}, ordinary)
	again, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	require.NoError(t, again.OnPluginUninstalled("fixture"))
	saved, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Equal(t, "dark", saved["theme"])
	assert.NotContains(t, saved, "password")
}

func TestOnPluginUninstalledForgetsTheRememberedSchemaWhenNoValueStays(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.RememberPluginSchema("fixture", []string{"theme"}))
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{"password": "pw-value"}))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	_, remembered, err := store.LoadPluginSchema("fixture")
	require.NoError(t, err)
	assert.False(t, remembered, "nothing is left for the schema to describe")
}

func recordingController(t *testing.T, store *settingsstore.Store) (*controller, *logtest.RecordingSink) {
	t.Helper()
	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
	})
	ctrl, ok := NewController(logger, store).(*controller)
	require.True(t, ok)
	return ctrl, sink
}

// loggedErase returns the record the uninstall wrote about its erase, if any.
func loggedErase(sink *logtest.RecordingSink) (logging.Record, bool) {
	for _, record := range sink.Records() {
		if strings.HasPrefix(record.Message, "plugin uninstalled;") {
			return record, true
		}
	}
	return logging.Record{}, false
}

func TestOnPluginUninstalledSaysWhenItErasedEveryValueBecauseNoSchemaWasKnown(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{"password": "pw-secret-value", "theme": "dark"}))
	ctrl, sink := recordingController(t, store)

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	record, ok := loggedErase(sink)
	require.True(t, ok, "the erase must be logged")
	assert.Equal(t, logging.LevelWarn, record.Level, "losing ordinary values because nothing is known is worth a warning")
	assert.Contains(t, record.Message, "no known settings schema")
	fields := record.ToMap()
	assert.Equal(t, string(settingsstore.EraseBasisNone), fields["basis"])
	assert.EqualValues(t, 2, fields["erased"])
	for _, entry := range sink.Records() {
		assert.NotContains(t, fmt.Sprint(entry.Fields), "pw-secret-value", "no value is logged")
	}
}

func TestOnPluginUninstalledLogsWhichSchemaClassifiedTheValues(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.RememberPluginSchema("fixture", []string{"theme"}))
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{"password": "pw-secret-value", "theme": "dark"}))
	ctrl, sink := recordingController(t, store)

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	record, ok := loggedErase(sink)
	require.True(t, ok)
	assert.Equal(t, logging.LevelInfo, record.Level)
	fields := record.ToMap()
	assert.Equal(t, string(settingsstore.EraseBasisRemembered), fields["basis"])
	assert.EqualValues(t, 1, fields["erased"])
	assert.EqualValues(t, 1, fields["kept"])
	for _, entry := range sink.Records() {
		assert.NotContains(t, fmt.Sprint(entry.Fields), "pw-secret-value", "no value is logged")
	}
}
