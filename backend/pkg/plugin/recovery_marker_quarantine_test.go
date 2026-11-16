package plugin

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
)

// markerQuarantineFixture persists a Running "flux" next to an unrelated plugin,
// then returns a restarted manager over the same profile.
func markerQuarantineFixture(t *testing.T) *pluginManager {
	t.Helper()
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	installPluginFixture(t, pm, "unrelated", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
	require.NoError(t, pm.pluginsRoot.MkdirAll("unrelated/assets", 0755))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())

	restarted := newTestManager(t)
	restarted.stateRoot, restarted.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	restarted.pidTracker = NewPIDTracker(pm.stateRoot)
	return restarted
}

func quarantined(t *testing.T, pm *pluginManager, name string) []string {
	t.Helper()
	entries, err := pm.stateRoot.ReadDir(".")
	require.NoError(t, err)
	var found []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), name+".invalid.") {
			found = append(found, entry.Name())
		}
	}
	return found
}

func TestInitialize_BadRecoveryMarkerIsQuarantinedNotFatal(t *testing.T) {
	cases := map[string]string{
		"uninstall-garbage":    uninstallRecoveryName("flux"),
		"archive-garbage":      archiveRecoveryName("flux"),
		"archive-wrong-suffix": archiveRecoveryPrefix + "flux.json.bad",
	}
	for name, marker := range cases {
		t.Run(name, func(t *testing.T) {
			pm := markerQuarantineFixture(t)
			evidence := []byte("not a recovery marker, may hold sensitive text")
			require.NoError(t, pm.stateRoot.WriteFile(marker, evidence, 0600))

			require.NoError(t, pm.Initialize(context.Background()), "a bad marker must not abort plugin initialization")

			unrelated, err := pm.GetPlugin("unrelated")
			require.NoError(t, err)
			assert.Equal(t, string(lifecycle.PhaseRunning), unrelated.Phase, "other plugins must still load")

			assert.NoFileExists(t, pm.stateRoot.ResolvePath(marker), "the bad marker must be moved aside")
			moved := quarantined(t, pm, marker)
			require.Len(t, moved, 1)
			kept, err := pm.stateRoot.ReadFile(moved[0])
			require.NoError(t, err)
			assert.Equal(t, evidence, kept, "the evidence must be kept, unchanged, next to the original")
			info, err := os.Stat(pm.stateRoot.ResolvePath(moved[0]))
			require.NoError(t, err)
			assert.Equal(t, os.FileMode(0600), info.Mode().Perm())

			if name != "archive-wrong-suffix" {
				flux, err := pm.GetPlugin("flux")
				require.NoError(t, err)
				assert.Equal(t, string(lifecycle.PhaseFailed), flux.Phase, "the plugin that owned the marker stays blocked this run")
				assert.Contains(t, flux.LastError, moved[0], "the user-visible error must name the quarantined file")
			}

			// A second start must not trip over its own quarantine file.
			again := newTestManager(t)
			again.stateRoot, again.pluginsRoot = pm.stateRoot, pm.pluginsRoot
			again.pidTracker = NewPIDTracker(pm.stateRoot)
			require.NoError(t, again.Initialize(context.Background()))
			assert.Len(t, quarantined(t, again, marker), 1, "a quarantine file must never be quarantined again")
		})
	}
}

func TestInitialize_BadRecoveryMarkerNeverOverwritesEarlierQuarantine(t *testing.T) {
	pm := markerQuarantineFixture(t)
	marker := uninstallRecoveryName("flux")
	for _, evidence := range []string{"first bad marker", "second bad marker"} {
		require.NoError(t, pm.stateRoot.WriteFile(marker, []byte(evidence), 0600))
		restarted := newTestManager(t)
		restarted.stateRoot, restarted.pluginsRoot = pm.stateRoot, pm.pluginsRoot
		restarted.pidTracker = NewPIDTracker(pm.stateRoot)
		require.NoError(t, restarted.Initialize(context.Background()))
	}
	moved := quarantined(t, pm, marker)
	require.Len(t, moved, 2)
	var contents []string
	for _, name := range moved {
		data, err := os.ReadFile(filepath.Join(pm.stateRoot.ResolvePath(""), name))
		require.NoError(t, err)
		contents = append(contents, string(data))
	}
	assert.ElementsMatch(t, []string{"first bad marker", "second bad marker"}, contents)
}
