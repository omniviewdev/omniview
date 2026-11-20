package plugin

import (
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Defect (plan item H3, uninstall hook): the OnPluginDestroy hook, the
// "last chance to clean up when the plugin is removed from the system" step
// of every controller and manager, has no production caller. uninstallPlugin
// (installer.go) unloads the plugin, which only runs OnPluginShutdown, then
// renames the plugin directory away and rewrites the inventory. State a
// controller keeps outside the plugin directory is never removed; in
// particular the plugin's persisted settings, including Password/Sensitive
// values (stored as plain JSON in the settings bbolt store), survive an
// uninstall and are inherited by any later install under the same ID.
//
// Fixed looks like: the production uninstall path calls OnPluginDestroy on
// every registered controller and manager (the same fan-out shutdownPlugin
// uses for OnPluginShutdown), so the settings controller deletes the plugin's
// bucket entry and the destroy recorder below sees the call.

// destroyRecordingController counts OnPluginDestroy calls and nothing else.
type destroyRecordingController struct {
	*trackingController
	destroyMu sync.Mutex
	destroyed []string
}

func (c *destroyRecordingController) OnPluginDestroy(pluginID string, _ config.PluginMeta) error {
	c.destroyMu.Lock()
	defer c.destroyMu.Unlock()
	c.destroyed = append(c.destroyed, pluginID)
	return nil
}

var _ plugintypes.Controller = (*destroyRecordingController)(nil)

func TestUninstallRemovesPersistedPluginSettings(t *testing.T) {
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })

	pm := newTestManager(t)
	pm.connlessControllers[sdktypes.CapabilitySettings] = settings.NewController(pm.logger, store)
	recorder := &destroyRecordingController{trackingController: &trackingController{}}
	pm.connlessControllers[sdktypes.CapabilityExec] = recorder

	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll(filepath.Join("flux", "assets"), 0o755))
	require.NoError(t, pm.pluginsRoot.WriteFile(filepath.Join("flux", "assets", "entry.js"), []byte("bundle"), 0o644))
	_, err = pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())

	// What the settings controller persists for a Password / Sensitive setting.
	require.NoError(t, store.SavePluginSettings("flux", map[string]any{
		"apiToken": "s3cret-token-value",
		"theme":    "dark",
	}))

	_, err = pm.UninstallPlugin("flux")
	require.NoError(t, err)

	// Precondition: the plugin directory itself is gone, so this is a real uninstall.
	_, statErr := pm.pluginsRoot.ReadFile("flux/plugin.yaml")
	require.Error(t, statErr, "plugin directory must be removed by uninstall")

	vals, err := store.LoadPluginSettings("flux")
	require.NoError(t, err)
	if len(vals) != 0 {
		t.Errorf("H3: uninstall left the plugin's persisted settings in the settings store (OnPluginDestroy is never called): %v", vals)
	}

	recorder.destroyMu.Lock()
	defer recorder.destroyMu.Unlock()
	if len(recorder.destroyed) == 0 {
		t.Error("H3: uninstall never invoked OnPluginDestroy on a registered controller")
	}
}
