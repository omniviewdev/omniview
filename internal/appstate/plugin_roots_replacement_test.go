package appstate

import (
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The service caches one scoped root per plugin ID for the plugin's store and
// data directories, and a holder may keep a root for as long as it likes: the
// resource controller's authority resolver holds its root for the life of the
// process. Two rules follow.
//
// A lookup never closes or replaces a cached root. An archive replacement keeps
// the plugin's state directories (it moves them, inode and all, into the new
// plugin directory), and for a moment between publishing the new directory and
// moving them in, the plugin directory exists without them. A lookup that
// answered by closing the root and creating an empty directory there would make
// the move fail and the update with it.
//
// Only the plugin manager, once an uninstall has disposed of the installation,
// releases a plugin's roots (ReleasePluginRoots). From then on a lookup creates
// nothing until the plugin directory exists again, so a late caller cannot
// resurrect an uninstalled plugin, and a reinstall of the same ID gets roots on
// its own, new directories.

// cachePluginRoots opens and keeps the store and data roots of a plugin, the
// way the controllers do while the plugin is installed.
func cachePluginRoots(t *testing.T, svc *Service, id string) (*ScopedRoot, *ScopedRoot) {
	t.Helper()
	store, err := svc.PluginStore(id)
	require.NoError(t, err)
	data, err := svc.PluginData(id)
	require.NoError(t, err)
	return store, data
}

// uninstallPluginDir removes a plugin directory the way an uninstall does:
// stage it by rename, then delete the staged tree.
func uninstallPluginDir(t *testing.T, svc *Service, id string) string {
	t.Helper()
	pluginDir := filepath.Join(svc.Root(), "plugins", id)
	staged := pluginDir + ".uninstall"
	require.NoError(t, os.Rename(pluginDir, staged), "stage rename")
	require.NoError(t, os.RemoveAll(staged), "remove staged")
	return pluginDir
}

// requireKeptRoots fails unless every lookup answers with the roots the caller
// already holds.
func requireKeptRoots(t *testing.T, svc *Service, id string, store, data *ScopedRoot, when string) {
	t.Helper()
	root, err := svc.PluginStore(id)
	require.NoError(t, err, "PluginStore %s", when)
	require.Same(t, store, root, "PluginStore %s must answer with the kept root", when)
	root, err = svc.PluginData(id)
	require.NoError(t, err, "PluginData %s", when)
	require.Same(t, data, root, "PluginData %s must answer with the kept root", when)
	root, ok, err := svc.PluginDataIfExists(id)
	require.NoError(t, err, "PluginDataIfExists %s", when)
	require.True(t, ok, "PluginDataIfExists %s must report the kept root", when)
	require.Same(t, data, root, "PluginDataIfExists %s must answer with the kept root", when)
}

func TestPluginStore_SurvivesUninstallAndReinstall(t *testing.T) {
	SkipIfOpenRootBlocksRename(t)
	svc := NewTestService(t)
	const id = "reinstall-plugin"

	first, err := svc.PluginStore(id)
	require.NoError(t, err)
	require.NoError(t, first.WriteFile("a.json", []byte("one"), 0o600))

	// Uninstall: stage by rename, delete the staged tree, and the plugin manager
	// releases the roots once that is durable.
	pluginDir := uninstallPluginDir(t, svc, id)
	svc.ReleasePluginRoots(id)
	// Reinstall: the plugin directory is recreated.
	require.NoError(t, os.MkdirAll(pluginDir, 0o700))

	second, err := svc.PluginStore(id)
	require.NoError(t, err)
	assert.NotSame(t, first, second, "the root of the deleted directory must not be reused")
	require.NoError(t, second.WriteFile("b.json", []byte("two"), 0o600), "write after reinstall")
	got, err := os.ReadFile(filepath.Join(pluginDir, "store", "b.json"))
	require.NoError(t, err, "the file must be on disk after the reinstall's write")
	assert.Equal(t, "two", string(got))
	assert.NoFileExists(t, filepath.Join(pluginDir, "store", "a.json"), "the first installation's file must not be visible")
}

func TestPluginData_SurvivesUninstallAndReinstall(t *testing.T) {
	SkipIfOpenRootBlocksRename(t)
	svc := NewTestService(t)
	const id = "reinstall-plugin"

	first, err := svc.PluginData(id)
	require.NoError(t, err)
	require.NoError(t, first.WriteFile("a.json", []byte("one"), 0o600))
	// A read-only caller holds the same cached root.
	ifExists, ok, err := svc.PluginDataIfExists(id)
	require.NoError(t, err)
	require.True(t, ok)
	require.Same(t, first, ifExists)

	pluginDir := uninstallPluginDir(t, svc, id)
	svc.ReleasePluginRoots(id)
	require.NoError(t, os.MkdirAll(filepath.Join(pluginDir, "data"), 0o700))

	second, ok, err := svc.PluginDataIfExists(id)
	require.NoError(t, err)
	require.True(t, ok, "the reinstalled plugin has a data directory")
	assert.NotSame(t, first, second, "PluginDataIfExists must not return the root of the deleted directory")
	third, err := svc.PluginData(id)
	require.NoError(t, err)
	assert.Same(t, second, third)
	require.NoError(t, third.WriteFile("b.json", []byte("two"), 0o600), "write after reinstall")
	got, err := os.ReadFile(filepath.Join(pluginDir, "data", "b.json"))
	require.NoError(t, err)
	assert.Equal(t, "two", string(got))
	assert.NoFileExists(t, filepath.Join(pluginDir, "data", "a.json"), "the first installation's file must not be visible")
}

func TestPluginRoots_LookupsDuringAnArchiveReplacementKeepTheirRootsAndCreateNothing(t *testing.T) {
	SkipIfOpenRootBlocksRename(t)
	svc := NewTestService(t)
	const id = "update-plugin"
	store, data := cachePluginRoots(t, svc, id)
	require.NoError(t, store.WriteFile("retained", []byte("store"), 0o600))
	require.NoError(t, data.WriteFile("retained", []byte("data"), 0o600))

	// An archive replacement stages the previous installation, publishes the
	// candidate, a plugin directory with no store and no data directory because a
	// package cannot contain them, and only then moves the state directories in.
	pluginDir := filepath.Join(svc.Root(), "plugins", id)
	previous := pluginDir + ".previous"
	require.NoError(t, os.Rename(pluginDir, previous))
	require.NoError(t, os.Mkdir(pluginDir, 0o700))

	// A lookup in that window must neither close the cached roots nor create the
	// directories the move is about to rename into place.
	requireKeptRoots(t, svc, id, store, data, "in the window")
	for _, name := range []string{"store", "data"} {
		require.NoDirExists(t, filepath.Join(pluginDir, name), "a lookup created %s in the window", name)
	}

	for _, name := range []string{"data", "store"} {
		require.NoError(t, os.Rename(filepath.Join(previous, name), filepath.Join(pluginDir, name)),
			"the move of %s must find its destination free", name)
	}
	// The roots held across the whole replacement address the live directories.
	require.NoError(t, store.WriteFile("after", []byte("store"), 0o600))
	require.NoError(t, data.WriteFile("after", []byte("data"), 0o600))
	for _, name := range []string{"store", "data"} {
		assert.FileExists(t, filepath.Join(pluginDir, name, "retained"))
		assert.FileExists(t, filepath.Join(pluginDir, name, "after"))
	}
	requireKeptRoots(t, svc, id, store, data, "after the move")
}

func TestPluginRoots_KeptWhilePluginDirectoryIsMissing(t *testing.T) {
	SkipIfOpenRootBlocksRename(t)
	svc := NewTestService(t)
	const id = "rollback-plugin"
	store, data := cachePluginRoots(t, svc, id)

	// An uninstall stages the plugin directory by rename, and until its disposal
	// begins it can still roll back by renaming the directory home.
	pluginDir := filepath.Join(svc.Root(), "plugins", id)
	staged := pluginDir + ".uninstall"
	require.NoError(t, os.Rename(pluginDir, staged))

	requireKeptRoots(t, svc, id, store, data, "while staged")
	// A lookup must not resurrect the plugin directory the transaction moved
	// away: the rollback needs the canonical path to be free.
	assert.NoDirExists(t, pluginDir, "a lookup recreated the plugin directory")

	// The rollback renames the directory home; the roots were kept and are live.
	require.NoError(t, os.Rename(staged, pluginDir))
	for name, held := range map[string]*ScopedRoot{"store": store, "data": data} {
		require.NoError(t, held.WriteFile("rolled-back.json", []byte("ok"), 0o600), "%s: write through the kept root", name)
		assert.FileExists(t, filepath.Join(pluginDir, name, "rolled-back.json"), "%s: the write must land in the restored directory", name)
	}
	requireKeptRoots(t, svc, id, store, data, "after the rollback")
}

func TestPluginRoots_ReuseTheRootsWhenOnlyTheStateDirectoriesMoved(t *testing.T) {
	SkipIfOpenRootBlocksRename(t)
	svc := NewTestService(t)
	const id = "update-plugin"
	store, data := cachePluginRoots(t, svc, id)

	// An archive replacement installs the new plugin directory and moves the old
	// one's state directories into it without copying: the same directories, at
	// the same paths, in a new parent.
	pluginDir := filepath.Join(svc.Root(), "plugins", id)
	previous := pluginDir + ".previous"
	require.NoError(t, os.Rename(pluginDir, previous))
	require.NoError(t, os.Mkdir(pluginDir, 0o700))
	for _, name := range []string{"store", "data"} {
		require.NoError(t, os.Rename(filepath.Join(previous, name), filepath.Join(pluginDir, name)))
	}

	requireKeptRoots(t, svc, id, store, data, "after the move")
	require.NoError(t, store.WriteFile("kept.json", []byte("kept"), 0o600))
	assert.FileExists(t, filepath.Join(pluginDir, "store", "kept.json"), "the write through the kept root must land in the live directory")
}

func TestReleasePluginRoots_LookupsCreateNothingUntilThePluginDirectoryExists(t *testing.T) {
	SkipIfOpenRootBlocksRename(t)
	svc := NewTestService(t)
	const id = "uninstalled-plugin"
	cachePluginRoots(t, svc, id)
	pluginDir := uninstallPluginDir(t, svc, id)
	svc.ReleasePluginRoots(id)

	// Late callers of a plugin that is gone: no root, and no plugin directory
	// appears for the next installation to trip over ("refusing to adopt an
	// existing canonical plugin without previous inventory").
	_, err := svc.PluginStore(id)
	require.ErrorIs(t, err, fs.ErrNotExist)
	_, err = svc.PluginData(id)
	require.ErrorIs(t, err, fs.ErrNotExist)
	root, ok, err := svc.PluginDataIfExists(id)
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Nil(t, root)
	assert.NoDirExists(t, pluginDir, "a lookup recreated the uninstalled plugin directory")

	// The reinstall brings the directory back, and the lookups work again. The
	// first lookup that finds the directory forgets the release, so the service
	// remembers nothing about a plugin that is installed again.
	require.NoError(t, os.MkdirAll(pluginDir, 0o700))
	assert.Contains(t, svc.released, id, "precondition: the release is remembered until a lookup finds the directory")
	store, err := svc.PluginStore(id)
	require.NoError(t, err)
	require.NoError(t, store.WriteFile("new.json", []byte("new"), 0o600))
	data, err := svc.PluginData(id)
	require.NoError(t, err)
	require.NoError(t, data.WriteFile("new.json", []byte("new"), 0o600))
	for _, name := range []string{"store", "data"} {
		assert.FileExists(t, filepath.Join(pluginDir, name, "new.json"))
	}
	assert.Empty(t, svc.released, "the release is forgotten once the plugin directory exists again")
}

func TestReleasePluginRoots_RefusesToCreateForAnIDThatHadNoCachedRoots(t *testing.T) {
	svc := NewTestService(t)
	const id = "never-cached"

	svc.ReleasePluginRoots(id)

	_, err := svc.PluginStore(id)
	require.ErrorIs(t, err, fs.ErrNotExist)
	_, err = svc.PluginData(id)
	require.ErrorIs(t, err, fs.ErrNotExist)
	assert.NoDirExists(t, filepath.Join(svc.Root(), "plugins", id))
}

func TestReleasePluginRoots_ClosesBothRootsAndLeavesOtherPluginsAlone(t *testing.T) {
	svc := NewTestService(t)
	store, data := cachePluginRoots(t, svc, "gone-plugin")
	otherStore, otherData := cachePluginRoots(t, svc, "other-plugin")

	svc.ReleasePluginRoots("gone-plugin")

	for name, root := range map[string]*ScopedRoot{"store": store, "data": data} {
		_, err := root.Stat(".")
		require.ErrorIs(t, err, os.ErrClosed, "%s root of the released plugin must be closed", name)
	}
	requireKeptRoots(t, svc, "other-plugin", otherStore, otherData, "after another plugin was released")
	require.NoError(t, otherStore.WriteFile("still.json", []byte("ok"), 0o600))
	// Releasing twice, or an ID nobody holds, closes nothing else and does not fail.
	svc.ReleasePluginRoots("gone-plugin")
	svc.ReleasePluginRoots("unknown-plugin")
	requireKeptRoots(t, svc, "other-plugin", otherStore, otherData, "after more releases")
}

func TestReleasePluginRoots_IgnoresAnInvalidIDAndAClosedService(t *testing.T) {
	svc, err := New(WithRoot(t.TempDir()), WithFlock(false))
	require.NoError(t, err)
	store, _ := cachePluginRoots(t, svc, "p1")

	for _, id := range []string{"", ".", "..", "a/b", `a\b`} {
		svc.ReleasePluginRoots(id)
	}
	_, statErr := store.Stat(".")
	require.NoError(t, statErr, "an invalid ID must release nothing")
	assert.Empty(t, svc.released, "an invalid ID is not remembered either")

	require.NoError(t, svc.Close())
	assert.NotPanics(t, func() { svc.ReleasePluginRoots("p1") }, "releasing after Close must be a no-op")
}

func TestReleasePluginRoots_LateHolderGetsAClearErrorAndNeverActsOnTheNewDirectory(t *testing.T) {
	SkipIfOpenRootBlocksRename(t)
	svc := NewTestService(t)
	const id = "reinstall-plugin"
	oldStore, oldData := cachePluginRoots(t, svc, id)
	require.NoError(t, oldStore.WriteFile("victim.json", []byte("old"), 0o600))
	pluginDir := uninstallPluginDir(t, svc, id)
	svc.ReleasePluginRoots(id)
	require.NoError(t, os.MkdirAll(pluginDir, 0o700))
	newStore, newData := cachePluginRoots(t, svc, id)
	for _, root := range []*ScopedRoot{newStore, newData} {
		require.NoError(t, root.WriteFile("victim.json", []byte("new"), 0o600))
		require.NoError(t, root.MkdirAll("subdir", 0o700))
	}

	// Every operation of a holder that kept a root from before the uninstall
	// fails with os.ErrClosed: none panics, and none reaches the directories now
	// at the same paths, whether the method goes through the handle or the path.
	for name, root := range map[string]*ScopedRoot{"store": oldStore, "data": oldData} {
		operations := map[string]func() error{
			"ReadFile":  func() error { _, err := root.ReadFile("victim.json"); return err },
			"WriteFile": func() error { return root.WriteFile("late.json", []byte("late"), 0o600) },
			"OpenFile": func() error {
				file, err := root.OpenFile("late.json", os.O_CREATE|os.O_WRONLY, 0o600)
				if err == nil {
					_ = file.Close()
				}
				return err
			},
			"MkdirAll": func() error { return root.MkdirAll("late-dir", 0o700) },
			"OpenRoot": func() error {
				child, err := root.OpenRoot("subdir")
				if err == nil {
					_ = child.Close()
				}
				return err
			},
			"Remove":    func() error { return root.Remove("victim.json") },
			"RemoveAll": func() error { return root.RemoveAll("victim.json") },
			"Stat":      func() error { _, err := root.Stat("."); return err },
			"Rename":    func() error { return root.Rename("victim.json", "renamed.json") },
			"ReadDir":   func() error { _, err := root.ReadDir("."); return err },
			"FS": func() error {
				file, err := root.FS().Open("victim.json")
				if err == nil {
					_ = file.Close()
				}
				return err
			},
			"DirectoryIdentity": func() error { _, err := root.DirectoryIdentity("subdir"); return err },
			"OpenPrivateFile": func() error {
				file, _, err := root.OpenPrivateFile("victim.json", os.O_RDONLY)
				if err == nil {
					_ = file.Close()
				}
				return err
			},
			"RenameDirectoryNoReplace": func() error { return root.RenameDirectoryNoReplace("subdir", "moved") },
			"MkdirTemp": func() error {
				_, err := root.MkdirTemp("late-")
				return err
			},
		}
		for operation, run := range operations {
			require.ErrorIs(t, run(), os.ErrClosed, "%s: %s on a released root must fail with os.ErrClosed", name, operation)
		}
		require.NoError(t, root.Close(), "%s: closing an already closed root", name)
	}

	for _, name := range []string{"store", "data"} {
		dir := filepath.Join(pluginDir, name)
		got, err := os.ReadFile(filepath.Join(dir, "victim.json"))
		require.NoError(t, err, "%s: a late holder must not delete a file of the new installation", name)
		assert.Equal(t, "new", string(got))
		assert.DirExists(t, filepath.Join(dir, "subdir"))
		assert.NoFileExists(t, filepath.Join(dir, "late.json"))
		assert.NoFileExists(t, filepath.Join(dir, "renamed.json"))
		assert.NoDirExists(t, filepath.Join(dir, "late-dir"))
		assert.NoDirExists(t, filepath.Join(dir, "moved"))
	}
	// The service does not close a root it forgot a second time.
	require.NoError(t, svc.Close())
}

// lookRootsUp looks the roots of a plugin up, and uses them, until done closes.
// A root is closed under its holder while the plugin is released: every outcome
// but a panic or a data race is fine.
func lookRootsUp(svc *Service, id string, done <-chan struct{}) {
	for {
		select {
		case <-done:
			return
		default:
		}
		if root, err := svc.PluginStore(id); err == nil {
			_, _ = root.ReadDir(".")
		}
		if root, err := svc.PluginData(id); err == nil {
			_, _ = root.ReadDir(".")
		}
		if root, ok, err := svc.PluginDataIfExists(id); err == nil && ok {
			_, _ = root.ReadDir(".")
		}
	}
}

func TestReleasePluginRoots_ConcurrentWithLookups(t *testing.T) {
	SkipIfOpenRootBlocksRename(t)
	svc := NewTestService(t)
	const (
		id      = "busy-plugin"
		readers = 4
		cycles  = 40
	)
	pluginDir := filepath.Join(svc.Root(), "plugins", id)
	require.NoError(t, os.MkdirAll(pluginDir, 0o700))

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
			lookRootsUp(svc, id, done)
		}()
	}
	for range cycles {
		// An uninstall stages the directory by rename and deletes the staged tree;
		// the plugin manager then releases the roots, and a reinstall follows.
		uninstallPluginDir(t, svc, id)
		svc.ReleasePluginRoots(id)
		require.NoError(t, os.MkdirAll(pluginDir, 0o700))
	}
	stopReaders()

	// Once the last reinstall is in place, the lookups answer with working roots.
	store, err := svc.PluginStore(id)
	require.NoError(t, err)
	require.NoError(t, store.WriteFile("final.json", []byte("ok"), 0o600))
	assert.FileExists(t, filepath.Join(pluginDir, "store", "final.json"))
}
