package settings

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func definitions() []pkgsettings.Category {
	return []pkgsettings.Category{{ID: "core", Label: "Core", Settings: map[string]pkgsettings.Setting{
		"name":    {ID: "name", Type: pkgsettings.Text, Default: "initial", RequiresRestart: true},
		"sibling": {ID: "sibling", Type: pkgsettings.Text, Default: "sibling"},
		"secret":  {ID: "secret", Type: pkgsettings.Password, Default: "private", Sensitive: true},
	}}}
}
func openStore(t *testing.T) *settingsstore.Store {
	t.Helper()
	s, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	return s
}
func TestCommitHydrationAndRestartBaseline(t *testing.T) {
	store := openStore(t)
	require.NoError(t, store.SaveCategory("core", map[string]any{"name": "saved", "sibling": "preserved"}))
	s, err := Initialize(Options{Store: store, Categories: definitions()})
	require.NoError(t, err)
	scope := Scope{Kind: "host"}
	snapshot, err := s.GetSnapshot(scope)
	require.NoError(t, err)
	require.Equal(t, "Core", snapshot.Categories["core"].Label)
	require.False(t, snapshot.Categories["core"].Settings["name"].PendingRestart)
	require.Nil(t, snapshot.Categories["core"].Settings["secret"].Value)
	require.Equal(t, "private", s.CategoryValues("core")["secret"])
	result, err := s.Commit(scope, map[string]any{"core.name": "next"})
	require.NoError(t, err)
	require.True(t, result.Applied)
	require.False(t, result.Uncertain)
	require.True(t, result.Snapshot.Categories["core"].Settings["name"].RequiresRestart)
	require.True(t, result.Snapshot.Categories["core"].Settings["name"].PendingRestart)
	values, err := store.LoadCategory("core")
	require.NoError(t, err)
	require.Equal(t, "preserved", values["sibling"])
	_, err = s.Commit(scope, map[string]any{"core.name": "saved"})
	require.NoError(t, err)
	snapshot, err = s.GetSnapshot(scope)
	require.NoError(t, err)
	require.False(t, snapshot.Categories["core"].Settings["name"].PendingRestart)
}
func TestDurableApplyFailureAndRejectedPersistence(t *testing.T) {
	store := openStore(t)
	s, err := Initialize(Options{Store: store, Categories: definitions()})
	require.NoError(t, err)
	s.SetApplyHandler(func(string, map[string]any) error { return errors.New("private credentials") })
	result, err := s.Commit(Scope{Kind: "host"}, map[string]any{"core.name": "durable"})
	require.NoError(t, err)
	require.False(t, result.Applied)
	require.NotContains(t, result.Message, "credentials")
	values, err := store.LoadCategory("core")
	require.NoError(t, err)
	require.Equal(t, "durable", values["name"])
	require.NoError(t, store.Close())
	_, err = s.Commit(Scope{Kind: "host"}, map[string]any{"core.name": "rejected"})
	require.Error(t, err)
	value, err := s.Provider().GetString("core.name")
	require.NoError(t, err)
	require.Equal(t, "durable", value)
}
func TestUnavailableStoreAndScopeValidation(t *testing.T) {
	s, err := Initialize(Options{Categories: definitions()})
	require.NoError(t, err)
	require.NotEmpty(t, s.Diagnostics())
	_, err = s.Commit(Scope{Kind: "host"}, map[string]any{"core.name": "new"})
	require.ErrorIs(t, err, settingsstore.ErrUnavailable)
	for _, scope := range []Scope{{}, {Kind: "host", PluginID: "bad"}, {Kind: "plugin"}} {
		_, err = s.GetSnapshot(scope)
		require.Error(t, err)
	}
}
func TestMigrationAndInvalidHydration(t *testing.T) {
	store := openStore(t)
	require.NoError(t, store.SaveCategory("core", map[string]any{"name": false, "unknown": "ignored"}))
	s, err := Initialize(Options{
		Store: store, Categories: definitions(),
		Migrations: map[string]Migration{
			"core": func(values map[string]any) (map[string]any, bool) {
				values["sibling"] = "migrated"
				return values, true
			},
		},
	})
	require.NoError(t, err)
	require.Contains(t, s.RejectedSettingIDs(), "core.name")
	require.Equal(t, "initial", s.CategoryValues("core")["name"])
	require.Equal(t, "migrated", s.CategoryValues("core")["sibling"])
}
