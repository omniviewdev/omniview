package devbaseline

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/stretchr/testify/require"
)

func TestImportDisclosureUsesAuthoritativePolicyAndExclusions(t *testing.T) {
	home, source, profile := fixture(t)
	before := sourceSettings(t, source)
	stores := map[string][]byte{
		"builtin/grafana/connections.json": []byte(`{"fixture":{"public":{"id":"fixture","url":"https://fixture.invalid"},"secret":"fixture-credential"}}`),
		"metrics/configuration.json":       []byte(`{"binding":"fixture-metric-binding"}`),
	}
	for name, data := range stores {
		require.NoError(t, os.MkdirAll(filepath.Dir(filepath.Join(source, name)), 0700))
		require.NoError(t, os.WriteFile(filepath.Join(source, name), data, 0600))
	}
	baseline, err := Snapshot(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.NoError(t, err)
	baseline.Exclusions = []string{"untrusted-claim"}
	result, err := Import(context.Background(), baseline, ImportOptions{Destination: profile, Home: home})
	require.NoError(t, err)
	require.Equal(t, Policy, result.Policy)
	require.Equal(t, exclusions(), result.Exclusions)
	require.Contains(t, result.Exclusions, "grafana-connections-and-credentials")
	require.Contains(t, result.Exclusions, "metric-bindings-and-configuration")
	require.Equal(t, []string{"allowlisted-safe-preferences", "inactive-unverified-plugin-inventory"}, result.CopiedScope)
	encoded, err := json.Marshal(result)
	require.NoError(t, err)
	for _, private := range []string{source, "fixture-credential", "fixture-metric-binding", "https://fixture.invalid", "untrusted-claim"} {
		require.NotContains(t, string(encoded), private)
	}
	for name, data := range stores {
		after, err := os.ReadFile(filepath.Join(source, name))
		require.NoError(t, err)
		require.Equal(t, data, after)
		_, err = os.Lstat(filepath.Join(result.StateRoot, name))
		require.True(t, os.IsNotExist(err))
	}
	after, err := os.ReadFile(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.Equal(t, before, after)
	inspected, err := InspectImport(context.Background(), result.StateRoot, true)
	require.NoError(t, err)
	require.Equal(t, result, inspected)
	store, err := settingsstore.Open(filepath.Join(result.StateRoot, "settings.db"))
	require.NoError(t, err)
	require.NoError(t, store.SaveCategory("general", map[string]any{"language": "en"}))
	require.NoError(t, store.Close())
	_, err = InspectImport(context.Background(), result.StateRoot, true)
	require.Error(t, err)
	_, err = InspectImport(context.Background(), result.StateRoot, false)
	require.NoError(t, err)
	require.NoError(t, os.Remove(filepath.Join(result.StateRoot, "settings.db")))
	_, err = InspectImport(context.Background(), result.StateRoot, false)
	require.Error(t, err)
}
