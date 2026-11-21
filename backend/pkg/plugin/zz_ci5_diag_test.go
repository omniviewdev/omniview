package plugin

import (
	"runtime"
	"time"
	"os"
	"path/filepath"
	"testing"
)

func tryMove(t *testing.T, pm *pluginManager, label string) {
	t.Helper()
	dir := pm.pluginsRoot.ResolvePath("")
	err := os.Rename(filepath.Join(dir, "flux"), filepath.Join(dir, "flux-moved"))
	t.Logf("DIAG %s: rename flux -> flux-moved: %v", label, err)
	if err == nil {
		_ = os.Rename(filepath.Join(dir, "flux-moved"), filepath.Join(dir, "flux"))
	}
}

func TestCI5DiagUninstall(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	tryMove(t, pm, "after fixture")
	_ = pm.pluginsRoot.MkdirAll(filepath.Join("flux", "assets"), 0755)
	_ = pm.pluginsRoot.WriteFile(filepath.Join("flux", "assets", "entry.js"), []byte("bundle"), 0644)
	tryMove(t, pm, "after pluginsRoot write")
	_, err := pm.LoadPlugin("flux", nil)
	t.Logf("DIAG LoadPlugin err: %v", err)
	tryMove(t, pm, "after LoadPlugin")
	_ = pm.writePluginStateJSON()
	tryMove(t, pm, "after writePluginStateJSON")
	_, err = pm.UninstallPlugin("flux")
	t.Logf("DIAG UninstallPlugin err: %v", err)
	tryMove(t, pm, "after UninstallPlugin")
}

func init() {
	if os.Getenv("CI5_GC") != "" {
		go func() {
			for {
				runtime.GC()
				time.Sleep(2 * time.Millisecond)
			}
		}()
	}
}
