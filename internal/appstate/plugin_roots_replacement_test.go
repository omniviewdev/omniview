package appstate

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// The service caches a scoped root per plugin ID for the plugin's store and
// data directories. An uninstall stages the plugin directory by rename and
// deletes it; a reinstall of the same ID in the same session recreates it. A
// cached root would still hold the deleted directory, so writes would fail with
// "openat ...: no such file or directory" and nothing would land on disk. A root
// is therefore reused only while its directory is still the one at its path.

// uninstallPluginDir removes a plugin directory the way an uninstall does:
// stage it by rename, then delete the staged tree.
func uninstallPluginDir(t *testing.T, svc *Service, id string) string {
	t.Helper()
	pluginDir := filepath.Join(svc.Root(), "plugins", id)
	staged := pluginDir + ".uninstall"
	if err := os.Rename(pluginDir, staged); err != nil {
		t.Fatalf("stage rename: %v", err)
	}
	if err := os.RemoveAll(staged); err != nil {
		t.Fatalf("remove staged: %v", err)
	}
	return pluginDir
}

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

func TestPluginData_SurvivesUninstallAndReinstall(t *testing.T) {
	svc := NewTestService(t)
	const id = "reinstall-plugin"

	first, err := svc.PluginData(id)
	if err != nil {
		t.Fatalf("PluginData: %v", err)
	}
	if err = first.WriteFile("a.json", []byte("one"), 0o600); err != nil {
		t.Fatalf("initial write: %v", err)
	}

	pluginDir := uninstallPluginDir(t, svc, id)
	if err = os.MkdirAll(pluginDir, 0o700); err != nil {
		t.Fatalf("recreate plugin dir: %v", err)
	}

	second, err := svc.PluginData(id)
	if err != nil {
		t.Fatalf("PluginData after reinstall: %v", err)
	}
	if second == first {
		t.Fatal("PluginData returned the root of the deleted directory")
	}
	if err = second.WriteFile("b.json", []byte("two"), 0o600); err != nil {
		t.Fatalf("write after reinstall: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(pluginDir, "data", "b.json"))
	if err != nil {
		t.Fatalf("file not on disk after reinstall write: %v", err)
	}
	if string(got) != "two" {
		t.Fatalf("on-disk content = %q, want %q", got, "two")
	}
	if _, statErr := os.Stat(filepath.Join(pluginDir, "data", "a.json")); !os.IsNotExist(statErr) {
		t.Fatalf("the first installation's file is visible in the new directory: %v", statErr)
	}
}

func TestPluginDataIfExists_ReportsAndReopensReplacedDirectory(t *testing.T) {
	svc := NewTestService(t)
	const id = "reinstall-plugin"

	first, err := svc.PluginData(id)
	if err != nil {
		t.Fatalf("PluginData: %v", err)
	}
	pluginDir := uninstallPluginDir(t, svc, id)

	// The directory is gone, so a read-only caller sees no store, not a
	// handle on the deleted one.
	root, ok, err := svc.PluginDataIfExists(id)
	if err != nil || ok || root != nil {
		t.Fatalf("PluginDataIfExists after uninstall = (%v, %v, %v), want (nil, false, nil)", root, ok, err)
	}
	// Nothing says the plugin will not come back, so the root is kept, not closed.
	if _, statErr := first.Stat("."); statErr != nil {
		t.Fatalf("the cached root was closed while the plugin directory is missing: %v", statErr)
	}
	if err = os.MkdirAll(filepath.Join(pluginDir, "data"), 0o700); err != nil {
		t.Fatalf("recreate data dir: %v", err)
	}
	root, ok, err = svc.PluginDataIfExists(id)
	if err != nil || !ok {
		t.Fatalf("PluginDataIfExists after reinstall = (%v, %v, %v), want a root", root, ok, err)
	}
	if root == first {
		t.Fatal("PluginDataIfExists returned the root of the deleted directory")
	}
	if err = root.WriteFile("b.json", []byte("two"), 0o600); err != nil {
		t.Fatalf("write after reinstall: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(pluginDir, "data", "b.json")); statErr != nil {
		t.Fatalf("file not on disk after reinstall write: %v", statErr)
	}
}

func TestPluginRoots_KeptWhilePluginDirectoryIsMissing(t *testing.T) {
	svc := NewTestService(t)
	const id = "rollback-plugin"

	store, err := svc.PluginStore(id)
	if err != nil {
		t.Fatalf("PluginStore: %v", err)
	}
	data, err := svc.PluginData(id)
	if err != nil {
		t.Fatalf("PluginData: %v", err)
	}
	// An uninstall stages the plugin directory by rename, and until its
	// disposal begins it can still roll back by renaming the directory home.
	pluginDir := filepath.Join(svc.Root(), "plugins", id)
	staged := pluginDir + ".uninstall"
	if err = os.Rename(pluginDir, staged); err != nil {
		t.Fatalf("stage rename: %v", err)
	}

	requireKeptRoots(t, svc, id, store, data, "while staged")
	// A lookup must not resurrect the plugin directory the transaction moved
	// away: the rollback needs the canonical path to be free.
	if _, statErr := os.Stat(pluginDir); !os.IsNotExist(statErr) {
		t.Fatalf("a lookup recreated the plugin directory: %v", statErr)
	}
	if root, ok, ifExistsErr := svc.PluginDataIfExists(id); ifExistsErr != nil || ok || root != nil {
		t.Fatalf("PluginDataIfExists while staged = (%v, %v, %v), want (nil, false, nil)", root, ok, ifExistsErr)
	}

	// The rollback renames the directory home; the roots were kept and are live.
	if err = os.Rename(staged, pluginDir); err != nil {
		t.Fatalf("rollback rename: %v", err)
	}
	for name, held := range map[string]*ScopedRoot{"store": store, "data": data} {
		if err = held.WriteFile("rolled-back.json", []byte("ok"), 0o600); err != nil {
			t.Fatalf("%s: write through the kept root: %v", name, err)
		}
		if _, statErr := os.Stat(filepath.Join(pluginDir, name, "rolled-back.json")); statErr != nil {
			t.Fatalf("%s: write did not land in the restored directory: %v", name, statErr)
		}
	}
	requireKeptRoots(t, svc, id, store, data, "after the rollback")
}

// requireKeptRoots fails unless every lookup answers with the roots the caller
// already holds.
func requireKeptRoots(t *testing.T, svc *Service, id string, store, data *ScopedRoot, when string) {
	t.Helper()
	if root, err := svc.PluginStore(id); err != nil || root != store {
		t.Fatalf("PluginStore %s = (%v, %v), want the kept root", when, root, err)
	}
	if root, err := svc.PluginData(id); err != nil || root != data {
		t.Fatalf("PluginData %s = (%v, %v), want the kept root", when, root, err)
	}
}

func TestPluginStore_DoesNotResurrectAnUninstalledPlugin(t *testing.T) {
	svc := NewTestService(t)
	const id = "uninstalled-plugin"

	first, err := svc.PluginStore(id)
	if err != nil {
		t.Fatalf("PluginStore: %v", err)
	}
	pluginDir := uninstallPluginDir(t, svc, id)

	// Late callers of a plugin that is gone get the root they already had, and
	// no plugin directory appears for the next startup to trip over.
	again, err := svc.PluginStore(id)
	if err != nil || again != first {
		t.Fatalf("PluginStore after uninstall = (%v, %v), want the root it had", again, err)
	}
	if _, statErr := os.Stat(pluginDir); !os.IsNotExist(statErr) {
		t.Fatalf("a lookup recreated the uninstalled plugin directory: %v", statErr)
	}
	if writeErr := first.WriteFile("late.json", []byte("late"), 0o600); !errors.Is(writeErr, os.ErrNotExist) {
		t.Fatalf("late write error = %v, want a missing-directory error", writeErr)
	}

	// The reinstall brings the directory back and the root is replaced.
	if err = os.MkdirAll(pluginDir, 0o700); err != nil {
		t.Fatalf("recreate plugin dir: %v", err)
	}
	second, err := svc.PluginStore(id)
	if err != nil || second == first {
		t.Fatalf("PluginStore after reinstall = (%v, %v), want a new root", second, err)
	}
	if _, statErr := first.Stat("."); !errors.Is(statErr, os.ErrClosed) {
		t.Fatalf("the replaced root was not closed: %v", statErr)
	}
}

func TestPluginRoots_StaleRootIsClosedAndLateUseFailsCleanly(t *testing.T) {
	svc := NewTestService(t)
	const id = "reinstall-plugin"

	store, err := svc.PluginStore(id)
	if err != nil {
		t.Fatalf("PluginStore: %v", err)
	}
	data, err := svc.PluginData(id)
	if err != nil {
		t.Fatalf("PluginData: %v", err)
	}
	pluginDir := uninstallPluginDir(t, svc, id)
	if err = os.MkdirAll(pluginDir, 0o700); err != nil {
		t.Fatalf("recreate plugin dir: %v", err)
	}
	if _, err = svc.PluginStore(id); err != nil {
		t.Fatalf("PluginStore after reinstall: %v", err)
	}
	if _, err = svc.PluginData(id); err != nil {
		t.Fatalf("PluginData after reinstall: %v", err)
	}

	// A holder that kept the old roots gets os.ErrClosed: the descriptors were
	// released, and nothing acts on a directory that no path names.
	for name, root := range map[string]*ScopedRoot{"store": store, "data": data} {
		if err = root.WriteFile("late.json", []byte("late"), 0o600); !errors.Is(err, os.ErrClosed) {
			t.Errorf("%s: late write error = %v, want os.ErrClosed", name, err)
		}
		if _, err = root.ReadFile("late.json"); !errors.Is(err, os.ErrClosed) {
			t.Errorf("%s: late read error = %v, want os.ErrClosed", name, err)
		}
		if _, err = root.Stat("."); !errors.Is(err, os.ErrClosed) {
			t.Errorf("%s: late stat error = %v, want os.ErrClosed", name, err)
		}
		if closeErr := root.Close(); closeErr != nil {
			t.Errorf("%s: closing an already closed root = %v, want nil", name, closeErr)
		}
	}
	// The service does not close a root it forgot a second time.
	if err = svc.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

func TestPluginRoots_ReuseTheRootWhileItsDirectoryIsLive(t *testing.T) {
	svc := NewTestService(t)
	const id = "update-plugin"

	first, err := svc.PluginStore(id)
	if err != nil {
		t.Fatalf("PluginStore: %v", err)
	}
	if again, againErr := svc.PluginStore(id); againErr != nil || again != first {
		t.Fatalf("PluginStore returned a new root for a live directory: %v %v", again, againErr)
	}
	firstData, err := svc.PluginData(id)
	if err != nil {
		t.Fatalf("PluginData: %v", err)
	}

	// An archive replacement installs the new plugin directory and moves the old
	// one's state directories into it without copying: the same directories, at
	// the same paths, in a new parent. The roots held by the controllers stay
	// valid, so they must be kept.
	pluginDir := filepath.Join(svc.Root(), "plugins", id)
	previous := pluginDir + ".previous"
	if err = os.Rename(pluginDir, previous); err != nil {
		t.Fatalf("stage previous: %v", err)
	}
	if err = os.Mkdir(pluginDir, 0o700); err != nil {
		t.Fatalf("publish candidate: %v", err)
	}
	for _, name := range []string{"store", "data"} {
		if err = os.Rename(filepath.Join(previous, name), filepath.Join(pluginDir, name)); err != nil {
			t.Fatalf("move %s: %v", name, err)
		}
	}

	moved, err := svc.PluginStore(id)
	if err != nil || moved != first {
		t.Fatalf("PluginStore replaced a root whose directory was only moved: %v %v", moved, err)
	}
	movedData, err := svc.PluginData(id)
	if err != nil || movedData != firstData {
		t.Fatalf("PluginData replaced a root whose directory was only moved: %v %v", movedData, err)
	}
	if err = moved.WriteFile("kept.json", []byte("kept"), 0o600); err != nil {
		t.Fatalf("write through the kept root: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(pluginDir, "store", "kept.json")); statErr != nil {
		t.Fatalf("write through the kept root did not land in the live directory: %v", statErr)
	}
}

func TestPluginRoots_ConcurrentLookupsDuringReplacement(t *testing.T) {
	svc := NewTestService(t)
	const (
		id      = "busy-plugin"
		readers = 4
		cycles  = 40
	)
	if _, err := svc.PluginData(id); err != nil {
		t.Fatalf("PluginData: %v", err)
	}
	pluginDir := filepath.Join(svc.Root(), "plugins", id)

	var wg sync.WaitGroup
	done := make(chan struct{})
	var stop sync.Once
	stopReaders := func() {
		stop.Do(func() {
			close(done)
			wg.Wait()
		})
	}
	// Registered after the service's cleanup, so it runs before the service closes.
	t.Cleanup(stopReaders)
	for range readers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-done:
					return
				default:
				}
				// A root can be closed under its holder while the directory is
				// replaced. Every outcome but a panic or a data race is acceptable.
				if root, ok, err := svc.PluginDataIfExists(id); err == nil && ok {
					_, _ = root.ReadDir(".")
				}
			}
		}()
	}
	for range cycles {
		if err := os.RemoveAll(pluginDir); err != nil {
			t.Fatalf("remove: %v", err)
		}
		if err := os.MkdirAll(filepath.Join(pluginDir, "data"), 0o700); err != nil {
			t.Fatalf("recreate: %v", err)
		}
	}
	stopReaders()
}
