package settings

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	boltErrors "go.etcd.io/bbolt/errors"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// queuedChangeWait bounds how long a test waits for a queued change to be rejected.
const queuedChangeWait = 5 * time.Second

// uninstallSchema declares one setting of each class the uninstall tells apart.
func uninstallSchema() map[string]pkgsettings.Setting {
	return map[string]pkgsettings.Setting{
		"password": {ID: "password", Type: pkgsettings.Password},
		"token":    {ID: "token", Type: pkgsettings.Text, Sensitive: true},
		"theme":    {ID: "theme", Type: pkgsettings.Text},
		"retries":  {ID: "retries", Type: pkgsettings.Integer},
	}
}

// hydratedController returns a controller that has started and hydrated a
// plugin with uninstallSchema, over a store that already holds saved values.
func hydratedController(t *testing.T, store *settingsstore.Store, saved map[string]any) *controller {
	t.Helper()
	require.NoError(t, store.SavePluginSettings("fixture", saved))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	provider := newMockProvider(uninstallSchema())
	ctrl.clients["fixture"] = provider
	ctrl.hydratePlugin(context.Background(), "fixture", provider, ctrl.logger)
	require.True(t, ctrl.hydrated["fixture"], "precondition: the plugin hydrated")
	require.NotEmpty(t, ctrl.schemaCache["fixture"])
	require.NotEmpty(t, ctrl.baseline["fixture"])
	return ctrl
}

func TestOnPluginUninstalledErasesOnlyCredentialClassValues(t *testing.T) {
	store := openTestStore(t)
	ctrl := hydratedController(t, store, map[string]any{
		"password": "pw-value", "token": "tok-value", "theme": "dark", "retries": 3,
	})
	require.NoError(t, store.SavePluginSettings("neighbour", map[string]any{"password": "keep-me"}))

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	saved, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark", "retries": float64(3)}, saved)
	neighbour, err := store.LoadPluginSettings("neighbour")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"password": "keep-me"}, neighbour, "another plugin's settings are never touched")
}

func TestOnPluginUninstalledDropsInMemoryCopies(t *testing.T) {
	ctrl := hydratedController(t, openTestStore(t), map[string]any{"password": "pw-value", "theme": "dark"})

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	// baseline holds every merged value, the credentials among them.
	assert.NotContains(t, ctrl.baseline, "fixture")
	assert.NotContains(t, ctrl.schemaCache, "fixture")
	assert.NotContains(t, ctrl.clients, "fixture")
	assert.NotContains(t, ctrl.hydrated, "fixture")
}

func TestOnPluginUninstalledTreatsUndeclaredValuesAsCredentials(t *testing.T) {
	store := openTestStore(t)
	ctrl := hydratedController(t, store, map[string]any{"theme": "dark", "retries": 3})
	// A value the schema no longer declares may have been a credential in an
	// earlier version of the plugin, so it does not survive.
	require.NoError(t, store.PatchPluginSettings("fixture", map[string]any{"legacyKey": "old-secret"}))

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	saved, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"theme": "dark", "retries": float64(3)}, saved)
}

func TestOnPluginUninstalledWithoutSchemaErasesEveryValue(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{"password": "pw-value", "theme": "dark"}))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	saved, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Empty(t, saved, "with no schema nothing proves a value is not a credential")
}

func TestOnPluginUninstalledForPluginWithoutEntryChangesNothing(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.SavePluginSettings("neighbour", map[string]any{"theme": "dark"}))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)

	require.NoError(t, ctrl.OnPluginUninstalled("never-seen"))

	all, err := store.LoadAllPluginSettings()
	require.NoError(t, err)
	assert.Equal(t, map[string]map[string]any{"neighbour": {"theme": "dark"}}, all)
}

func TestOnPluginUninstalledWithoutStoreOnlyDropsMemory(t *testing.T) {
	ctrl, ok := NewController(logging.NewNop(), nil).(*controller)
	require.True(t, ok)
	ctrl.baseline["fixture"] = map[string]any{"password": "pw-value"}
	ctrl.schemaCache["fixture"] = uninstallSchema()

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	assert.NotContains(t, ctrl.baseline, "fixture")
	assert.NotContains(t, ctrl.schemaCache, "fixture")
}

func TestOnPluginUninstalledReportsStoreFailureAndStillDropsMemory(t *testing.T) {
	store := openTestStore(t)
	ctrl := hydratedController(t, store, map[string]any{"password": "pw-value", "theme": "dark"})
	require.NoError(t, store.Close())

	err := ctrl.OnPluginUninstalled("fixture")

	require.ErrorIs(t, err, boltErrors.ErrDatabaseNotOpen)
	assert.NotContains(t, ctrl.baseline, "fixture", "the credentials do not stay in memory")
	assert.NotContains(t, ctrl.schemaCache, "fixture")
}

func TestOnPluginUninstalledFailsQueuedChanges(t *testing.T) {
	ctrl := hydratedController(t, openTestStore(t), map[string]any{"theme": "dark"})
	done := make(chan commitOutcome, 1)
	ctrl.pendingChanges["fixture"] = []pendingChange{{ctx: context.Background(), done: done}}

	require.NoError(t, ctrl.OnPluginUninstalled("fixture"))

	// A bounded wait: a change that is not rejected must fail this test, not hang it.
	select {
	case outcome := <-done:
		require.Error(t, outcome.err, "a change queued for a plugin that is gone is rejected, not left waiting")
	case <-time.After(queuedChangeWait):
		t.Fatal("a change queued for an uninstalled plugin was left waiting instead of being rejected")
	}
	assert.NotContains(t, ctrl.pendingChanges, "fixture")
}
