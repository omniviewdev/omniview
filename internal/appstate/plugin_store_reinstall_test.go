package appstate

import (
	"os"
	"path/filepath"
	"testing"
)

// B-38: stale cached plugin store handle after uninstall and reinstall.
//
// Defect: Service.PluginStore caches the ScopedRoot (an open os.Root
// descriptor) per plugin ID and never evicts it before Service.Close. When a
// plugin directory is removed (uninstall stages it by rename, then deletes
// it) and recreated (reinstall of the same ID in the same session), the
// cached descriptor still points at the deleted directory, so writes fail
// with "openat ...: no such file or directory" and nothing lands on disk.
//
// Fixed looks like: after the plugin directory is replaced, PluginStore(id)
// returns a root bound to the live directory, and a write succeeds and is
// visible at <root>/plugins/<id>/store/<name>.
func TestPluginStore_SurvivesUninstallAndReinstall(t *testing.T) {
	svc := NewTestService(t)
	const id = "reinstall-plugin"

	first, err := svc.PluginStore(id)
	if err != nil {
		t.Fatalf("PluginStore: %v", err)
	}
	if err = first.WriteFile("a.json", []byte("one"), 0o600); err != nil {
		t.Fatalf("initial write: %v", err)
	}

	// Uninstall: stage by rename, then delete the staged tree.
	pluginDir := filepath.Join(svc.Root(), "plugins", id)
	staged := pluginDir + ".uninstall"
	if err = os.Rename(pluginDir, staged); err != nil {
		t.Fatalf("stage rename: %v", err)
	}
	if err = os.RemoveAll(staged); err != nil {
		t.Fatalf("remove staged: %v", err)
	}
	// Reinstall: the plugin directory is recreated.
	if err = os.MkdirAll(pluginDir, 0o700); err != nil {
		t.Fatalf("recreate plugin dir: %v", err)
	}

	second, err := svc.PluginStore(id)
	if err != nil {
		t.Fatalf("PluginStore after reinstall: %v", err)
	}
	if err = second.WriteFile("b.json", []byte("two"), 0o600); err != nil {
		t.Fatalf("write after reinstall: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(pluginDir, "store", "b.json"))
	if err != nil {
		t.Fatalf("file not on disk after reinstall write: %v", err)
	}
	if string(got) != "two" {
		t.Fatalf("on-disk content = %q, want %q", got, "two")
	}
}
