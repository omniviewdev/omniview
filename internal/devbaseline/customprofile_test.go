package devbaseline

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/stretchr/testify/require"
)

func bindBaselineFixture(t *testing.T) (string, string, instance.Profile) {
	t.Helper()
	home, source, original := fixture(t)
	custom := filepath.Join(home, "custom-profile", "state")
	selected, err := devcontract.SetCustomProfile(context.Background(), *original.Workspace, custom, home)
	require.NoError(t, err)
	require.Equal(t, custom, selected.StateRoot)
	_, err = os.Lstat(custom)
	require.True(t, os.IsNotExist(err))
	profile, err := instance.Resolve(instance.Options{Workspace: selected.ManifestPath, StateRoot: custom, Home: home, Channel: "local"})
	require.NoError(t, err)
	return home, source, profile
}

func TestBoundCustomProfileSeedsPreferencesAndInactiveInventory(t *testing.T) {
	home, source, profile := bindBaselineFixture(t)
	before := sourceSettings(t, source)
	require.NoError(t, os.WriteFile(filepath.Join(source, "plugin_state.json"), []byte(`[{"id":"example","metadata":{"version":"1.2.3"},"enabled":true,"devPath":"/private/source-worktree"}]`), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(source, "plugin_pids.json"), []byte(`{"example":{"pid":1234,"pgid":1234}}`), 0600))
	ownerPath := filepath.Join(filepath.Dir(profile.Descriptor.StateRoot), ".omniview-profile.json")
	ownerBefore, err := os.ReadFile(ownerPath)
	require.NoError(t, err)
	result, err := Seed(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home}, ImportOptions{Destination: profile, Home: home})
	require.NoError(t, err)
	require.Equal(t, filepath.Join(home, "custom-profile", "state"), result.StateRoot)
	require.Equal(t, filepath.Join(home, ".omniview-dev", "profiles", testID, "runtime"), profile.RuntimeRoot)
	entries, err := os.ReadDir(result.StateRoot)
	require.NoError(t, err)
	names := []string{}
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	require.ElementsMatch(t, []string{"settings.db", "baseline.json"}, names)
	s, err := settingsstore.Open(filepath.Join(result.StateRoot, "settings.db"))
	require.NoError(t, err)
	values, err := s.LoadCategory("general")
	require.NoError(t, err)
	require.Equal(t, map[string]any{"language": "es"}, values)
	pluginValues, err := s.LoadAllPluginSettings()
	require.NoError(t, err)
	require.Empty(t, pluginValues)
	require.NoError(t, s.Close())
	var manifest Baseline
	data, err := os.ReadFile(result.ManifestPath)
	require.NoError(t, err)
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	require.NoError(t, decoder.Decode(&manifest))
	require.Equal(t, []Plugin{{ID: "example", Version: "1.2.3", Status: "inactive", Provenance: "unverified-source-inventory"}}, manifest.Plugins)
	require.NotContains(t, string(data), "/private/source-worktree")
	require.NotContains(t, string(data), "secret")
	ownerAfter, err := os.ReadFile(ownerPath)
	require.NoError(t, err)
	require.Equal(t, ownerBefore, ownerAfter)
	after, err := os.ReadFile(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.Equal(t, before, after)
	for _, path := range []string{profile.RuntimeRoot, profile.WebviewRoot, filepath.Join(result.StateRoot, "plugins"), filepath.Join(result.StateRoot, "plugin_state.json")} {
		if path != "" {
			_, err = os.Lstat(path)
			require.True(t, os.IsNotExist(err), path)
		}
	}
}

func TestCustomSeedRejectsForeignOwnerOrClaimWithoutMutation(t *testing.T) {
	for _, kind := range []string{"owner", "claim"} {
		t.Run(kind, func(t *testing.T) {
			home, source, profile := bindBaselineFixture(t)
			sourceSettings(t, source)
			foreign := map[string]any{"schemaVersion": 1, "workspaceID": "4beee3e2-2450-421c-ad44-485a704c3a65", "stateRoot": profile.Descriptor.StateRoot}
			metadata := filepath.Join(filepath.Dir(profile.Descriptor.StateRoot), ".omniview-profile.json")
			var value any = foreign
			if kind == "claim" {
				metadata = filepath.Join(home, ".omniview-dev", "custom-profiles.json")
				value = map[string]any{"schemaVersion": 1, "claims": []any{foreign}}
			}
			before, err := json.Marshal(value)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(metadata, before, 0600))
			_, err = Seed(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home}, ImportOptions{Destination: profile, Home: home})
			require.Error(t, err)
			after, err := os.ReadFile(metadata)
			require.NoError(t, err)
			require.Equal(t, before, after)
			_, err = os.Lstat(profile.Descriptor.StateRoot)
			require.True(t, os.IsNotExist(err))
			_, err = os.Lstat(filepath.Join(source, ".lock"))
			require.True(t, os.IsNotExist(err))
			stages, err := filepath.Glob(filepath.Join(filepath.Dir(profile.Descriptor.StateRoot), ".baseline-stage-*"))
			require.NoError(t, err)
			require.Empty(t, stages)
		})
	}
}
