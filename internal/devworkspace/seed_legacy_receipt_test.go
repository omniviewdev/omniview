package devworkspace

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devbaseline"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/stretchr/testify/require"
)

func TestSeedResumePreservesOlderExplanatoryReceiptBytes(t *testing.T) {
	for _, markerPresent := range []bool{false, true} {
		t.Run(map[bool]string{false: "pending-intent", true: "completed-import"}[markerPresent], func(t *testing.T) {
			s := supervisorEdgeFixture(t)
			source, err := filepath.EvalSymlinks(t.TempDir())
			require.NoError(t, err)
			store, err := settingsstore.Open(filepath.Join(source, "settings.db"))
			require.NoError(t, err)
			require.NoError(t, store.SaveCategory("general", map[string]any{"language": "es"}))
			require.NoError(t, store.Close())
			s.options.BaselineSource = source
			require.NoError(t, s.seed(context.Background()))
			path := filepath.Join(s.workspace.StateRoot, "baseline.json")
			raw, err := os.ReadFile(path)
			require.NoError(t, err)
			var baseline devbaseline.Baseline
			require.NoError(t, json.Unmarshal(raw, &baseline))
			baseline.Exclusions = []string{"unknown-setting-keys", "sensitive-settings", "plugin-settings-and-data", "credentials", "connections-and-autoconnect", "sessions-and-terminals", "telemetry-enablement-auth-and-export", "runtime-locks-pids-pgids", "devinfo-discovery-control-and-tokens", "logs-caches-and-temporary-files", "native-and-browser-storage", "source-dev-paths", "executables-and-artifacts"}
			old, err := json.Marshal(baseline)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(path, old, 0600))
			require.NoError(t, saveLaunchJSON(launchPath(s.workspace, "baseline-intent.json"), map[string]any{"source": source, "baseline": baseline}))
			if markerPresent {
				require.NoError(t, saveLaunchJSON(launchPath(s.workspace, "baseline-seeded.json"), map[string]string{"source": source, "digest": digestGenerated(old)}))
			} else {
				require.NoError(t, os.Remove(launchPath(s.workspace, "baseline-seeded.json")))
			}
			require.NoError(t, s.seed(context.Background()))
			require.NotNil(t, s.status.Seed)
			require.Contains(t, s.status.Seed.Exclusions, "metric-bindings-and-configuration")
			after, err := os.ReadFile(path)
			require.NoError(t, err)
			require.Equal(t, old, after)
			require.NoError(t, s.seed(context.Background()))
			_, err = inspectWorkspaceSeed(context.Background(), s.workspace)
			require.NoError(t, err)
		})
	}
}
