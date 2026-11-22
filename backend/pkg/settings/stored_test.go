package settings

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

const storedText = "hunter2-very-private"

// storedDefinitions has secrets whose default is empty, so "unset" is reachable.
func storedDefinitions() []pkgsettings.Category {
	return []pkgsettings.Category{{ID: "core", Label: "Core", Settings: map[string]pkgsettings.Setting{
		"name":      {ID: "name", Type: pkgsettings.Text, Default: "initial"},
		"secret":    {ID: "secret", Type: pkgsettings.Password, Default: "", Sensitive: true},
		"password":  {ID: "password", Type: pkgsettings.Password, Default: ""},
		"token":     {ID: "token", Type: pkgsettings.Text, Default: "", Sensitive: true},
		"defaulted": {ID: "defaulted", Type: pkgsettings.Text, Default: "shipped", Sensitive: true},
	}}}
}

func storedService(t *testing.T) *Service {
	t.Helper()
	s, err := Initialize(Options{Store: openStore(t), Categories: storedDefinitions()})
	require.NoError(t, err)
	return s
}

func hostScope() Scope { return Scope{Kind: "host"} }

func hostSnapshot(t *testing.T, s *Service) Snapshot {
	t.Helper()
	snapshot, err := s.GetSnapshot(hostScope())
	require.NoError(t, err)
	return snapshot
}

func TestStoredFreshServiceAndMembership(t *testing.T) {
	snapshot := hostSnapshot(t, storedService(t))
	require.Equal(t, map[string]bool{
		"core.secret":    false,
		"core.password":  false,
		"core.token":     false,
		"core.defaulted": true,
	}, snapshot.Stored)
	require.NotContains(t, snapshot.Stored, "core.name")
}

func TestStoredFollowsSetClearSetToEmptySet(t *testing.T) {
	s := storedService(t)
	set := func(value any) CommitResult {
		result, err := s.Commit(hostScope(), map[string]any{"core.secret": value})
		require.NoError(t, err)
		return result
	}
	// The service has no nil commit; the provider's reset puts the default (empty) back.
	clearSecret := func() {
		reset, ok := s.Provider().(interface{ ResetSetting(string) error })
		require.True(t, ok)
		require.NoError(t, reset.ResetSetting("core.secret"))
	}
	check := func(step string, want bool, result *CommitResult) {
		t.Helper()
		if result != nil {
			require.Equal(t, want, result.Snapshot.Stored["core.secret"], step+": commit result")
			require.Contains(t, result.Snapshot.Stored, "core.secret", step+": commit result")
		}
		require.Equal(t, want, hostSnapshot(t, s).Stored["core.secret"], step+": next snapshot")
	}
	first := set("x")
	check("set", true, &first)
	clearSecret()
	check("clear", false, nil)
	second := set("y")
	check("set again", true, &second)
	empty := set("")
	check("set to empty", false, &empty)
	third := set("z")
	check("set once more", true, &third)
	clearSecret()
	check("clear again", false, nil)
}

func TestStoredFollowsAnotherCommit(t *testing.T) {
	s := storedService(t)
	before := hostSnapshot(t, s)
	require.False(t, before.Stored["core.token"])
	_, err := s.Commit(hostScope(), map[string]any{"core.token": storedText})
	require.NoError(t, err)
	require.False(t, before.Stored["core.token"], "an earlier snapshot is a copy")
	require.True(t, hostSnapshot(t, s).Stored["core.token"])
	_, err = s.Commit(hostScope(), map[string]any{"core.token": ""})
	require.NoError(t, err)
	require.False(t, hostSnapshot(t, s).Stored["core.token"])
}

func TestStoredAfterHydration(t *testing.T) {
	store := openStore(t)
	require.NoError(t, store.SaveCategory("core", map[string]any{"secret": storedText, "defaulted": ""}))
	s, err := Initialize(Options{Store: store, Categories: storedDefinitions()})
	require.NoError(t, err)
	stored := hostSnapshot(t, s).Stored
	require.True(t, stored["core.secret"])
	require.False(t, stored["core.defaulted"], "a persisted empty value replaces the default")
	require.False(t, stored["core.token"])
}

func TestStoredWithoutAStore(t *testing.T) {
	s, err := Initialize(Options{Categories: storedDefinitions()})
	require.NoError(t, err)
	stored := hostSnapshot(t, s).Stored
	require.False(t, stored["core.secret"])
	require.Contains(t, stored, "core.secret")
	require.True(t, stored["core.defaulted"])
}

func TestStoredCoversPasswordTypeWithoutSensitiveFlag(t *testing.T) {
	s := storedService(t)
	require.False(t, hostSnapshot(t, s).Stored["core.password"])
	result, err := s.Commit(hostScope(), map[string]any{"core.password": "p"})
	require.NoError(t, err)
	require.True(t, result.Snapshot.Stored["core.password"])
	require.True(t, result.Snapshot.Categories["core"].Settings["password"].Sensitive)
}

func TestStoredSnapshotNeverCarriesTheValue(t *testing.T) {
	s := storedService(t)
	result, err := s.Commit(hostScope(), map[string]any{
		"core.secret": storedText, "core.password": storedText, "core.token": storedText,
	})
	require.NoError(t, err)
	for name, snapshot := range map[string]Snapshot{"commit": result.Snapshot, "get": hostSnapshot(t, s)} {
		raw, marshalErr := json.Marshal(snapshot)
		require.NoError(t, marshalErr)
		require.NotContains(t, string(raw), storedText, name)
		require.NotContains(t, string(raw), "shipped", name)
		for _, id := range []string{"secret", "password", "token", "defaulted"} {
			setting := snapshot.Categories["core"].Settings[id]
			require.Nil(t, setting.Value, name+" "+id)
			require.Nil(t, setting.Default, name+" "+id)
			require.Empty(t, setting.Options, name+" "+id)
			require.Nil(t, setting.FileSelection, name+" "+id)
			require.True(t, setting.Sensitive, name+" "+id)
		}
		require.Equal(t, "initial", snapshot.Categories["core"].Settings["name"].Default)
	}
}

func TestStoredIsEmptyForPluginScope(t *testing.T) {
	s := storedService(t)
	s.AttachPlugins(&uncertainPlugin{value: "v"})
	snapshot, err := s.GetSnapshot(Scope{Kind: "plugin", PluginID: "plugin.with.dots"})
	require.NoError(t, err)
	require.Empty(t, snapshot.Stored)
	result, err := s.Commit(Scope{Kind: "plugin", PluginID: "plugin.with.dots"}, map[string]any{"raw.dotted.id": "w"})
	require.NoError(t, err)
	require.Empty(t, result.Snapshot.Stored)
}

func TestStoredIsEmptyWhenNoSettingIsSensitive(t *testing.T) {
	s, err := Initialize(Options{Store: openStore(t), Categories: []pkgsettings.Category{{
		ID: "plain", Settings: map[string]pkgsettings.Setting{"a": {ID: "a", Type: pkgsettings.Text, Default: "a"}},
	}}})
	require.NoError(t, err)
	require.Empty(t, hostSnapshot(t, s).Stored)
}
