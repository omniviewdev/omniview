package appstate

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Windows refuses to rename or remove a directory that has anything open beneath
// it, share mode or not. The plugin manager moves a plugin's directory to stage
// an uninstall, to publish an update and to roll either back, and the service
// holds roots open on the plugin's store and data directories. So the plugins
// root closes the roots under a directory while it moves or removes it: a moved
// root is opened again where its directory went, and a removed one is gone.
// The tests below hold the process to that on every OS, where the descriptor
// table shows the handles that Windows would turn into "Access is denied".

// openDescriptors counts the process's open file descriptors through /dev/fd.
// ok is false where the system cannot list them (Windows).
func openDescriptors() (count int, ok bool) {
	entries, err := os.ReadDir("/dev/fd")
	return len(entries), err == nil
}

func pluginDirectory(svc *Service, id string) string {
	return filepath.Join(svc.Root(), "plugins", id)
}

// relocationFixture caches the roots of a plugin that has files in both of its
// state directories.
func relocationFixture(t *testing.T, svc *Service, id string) (store, data *ScopedRoot) {
	t.Helper()
	store, data = cachePluginRoots(t, svc, id)
	require.NoError(t, store.WriteFile("kept", []byte("store"), 0o600))
	require.NoError(t, data.WriteFile("kept", []byte("data"), 0o600))
	return store, data
}

func TestRelocate_NoHandleIsOpenOnTheDirectoryWhileItMoves(t *testing.T) {
	svc := NewTestService(t)
	const id = "moving-plugin"
	relocationFixture(t, svc, id)
	other, otherData := relocationFixture(t, svc, "other-plugin")
	pluginDir := pluginDirectory(svc, id)
	staged := pluginDir + ".staged"
	before, listed := openDescriptors()

	var during int
	err := svc.relocate(id, id+".staged", func() error {
		during, _ = openDescriptors()
		// What Windows refuses while a handle is open anywhere beneath the directory.
		return os.Rename(pluginDir, staged)
	})

	require.NoError(t, err, "the directory must be free to move: nothing may hold it open")
	if listed {
		assert.Equal(t, before-2, during, "the store and data roots of the moving plugin are closed during the move, and no other root is")
	}
	for name, held := range map[string]*ScopedRoot{"store": other, "data": otherData} {
		require.NoError(t, held.WriteFile("still", []byte(name), 0o600), "%s: another plugin's root is left alone", name)
	}
}

func TestRelocate_RootsFollowTheirDirectory(t *testing.T) {
	svc := NewTestService(t)
	const id = "following-plugin"
	store, data := relocationFixture(t, svc, id)
	pluginDir := pluginDirectory(svc, id)
	staged := pluginDir + ".staged"
	plugins := svc.Plugins()

	// An uninstall stages the plugin directory, and a rollback brings it home.
	require.NoError(t, plugins.RenameDirectoryNoReplace(id, id+".staged"))
	require.Equal(t, filepath.Join(staged, "store"), store.ResolvePath(""), "the root's path follows its directory")
	for name, held := range map[string]*ScopedRoot{"store": store, "data": data} {
		require.NoError(t, held.WriteFile("while-staged", []byte(name), 0o600), "%s: write while staged", name)
		assert.FileExists(t, filepath.Join(staged, name, "while-staged"), "%s: the root addresses the staged directory", name)
	}
	requireKeptRoots(t, svc, id, store, data, "while staged")
	assert.NoDirExists(t, pluginDir, "a lookup must not recreate the directory the transaction moved away")

	require.NoError(t, plugins.RenameDirectoryNoReplace(id+".staged", id))
	require.Equal(t, filepath.Join(pluginDir, "store"), store.ResolvePath(""))
	for name, held := range map[string]*ScopedRoot{"store": store, "data": data} {
		require.NoError(t, held.WriteFile("after-rollback", []byte(name), 0o600), "%s: write after the rollback", name)
		assert.FileExists(t, filepath.Join(pluginDir, name, "after-rollback"), "%s: the root addresses the restored directory", name)
		assert.FileExists(t, filepath.Join(pluginDir, name, "kept"))
	}
	requireKeptRoots(t, svc, id, store, data, "after the rollback")
}

// An archive replacement stages the previous installation, publishes the
// candidate, which has no state directories, and moves the old ones in.
func TestRelocate_RootsFollowStateDirectoriesMovedIntoANewPluginDirectory(t *testing.T) {
	svc := NewTestService(t)
	const id = "updating-plugin"
	store, data := relocationFixture(t, svc, id)
	pluginDir := pluginDirectory(svc, id)
	plugins := svc.Plugins()

	require.NoError(t, plugins.RenameDirectoryNoReplace(id, ".archive-"+id))
	require.NoError(t, plugins.MkdirAll(id, 0o700))
	requireKeptRoots(t, svc, id, store, data, "in the window")
	for _, name := range []string{"store", "data"} {
		require.NoDirExists(t, filepath.Join(pluginDir, name), "a lookup created %s in the window", name)
	}
	for _, name := range []string{"data", "store"} {
		require.NoError(t, plugins.RenameDirectoryNoReplace(filepath.Join(".archive-"+id, name), filepath.Join(id, name)))
	}

	require.Equal(t, filepath.Join(pluginDir, "store"), store.ResolvePath(""))
	require.Equal(t, filepath.Join(pluginDir, "data"), data.ResolvePath(""))
	for name, held := range map[string]*ScopedRoot{"store": store, "data": data} {
		require.NoError(t, held.WriteFile("after", []byte(name), 0o600))
		assert.FileExists(t, filepath.Join(pluginDir, name, "kept"))
		assert.FileExists(t, filepath.Join(pluginDir, name, "after"))
	}
	// The previous installation, now without state directories, is deleted.
	require.NoError(t, plugins.RemoveAll(".archive-"+id))
	requireKeptRoots(t, svc, id, store, data, "after the previous installation was removed")
	require.NoError(t, store.WriteFile("final", []byte("ok"), 0o600))
}

func TestRelocate_LeavesPluginsWithASimilarNameAlone(t *testing.T) {
	svc := NewTestService(t)
	relocationFixture(t, svc, "flux")
	extraStore, extraData := relocationFixture(t, svc, "flux-extra")
	before, listed := openDescriptors()

	var during int
	require.NoError(t, svc.relocate("flux", "flux.staged", func() error {
		during, _ = openDescriptors()
		return os.Rename(pluginDirectory(svc, "flux"), pluginDirectory(svc, "flux.staged"))
	}))

	if listed {
		assert.Equal(t, before-2, during, "only the two roots under flux close, not those under flux-extra")
	}
	requireKeptRoots(t, svc, "flux-extra", extraStore, extraData, "after flux moved")
	require.NoError(t, extraStore.WriteFile("still", []byte("ok"), 0o600))
}

func TestRelocate_AFailedMoveOpensTheRootsAgainWhereTheyWere(t *testing.T) {
	svc := NewTestService(t)
	const id = "unmoved-plugin"
	store, data := relocationFixture(t, svc, id)
	pluginDir := pluginDirectory(svc, id)
	moveFailed := errors.New("the move failed")

	err := svc.relocate(id, id+".staged", func() error { return moveFailed })

	require.ErrorIs(t, err, moveFailed)
	requireKeptRoots(t, svc, id, store, data, "after the failed move")
	for name, held := range map[string]*ScopedRoot{"store": store, "data": data} {
		require.NoError(t, held.WriteFile("after-failure", []byte(name), 0o600), "%s: the root is open again", name)
		assert.FileExists(t, filepath.Join(pluginDir, name, "after-failure"))
	}
}

// The service never re-points a root at whatever it finds. A directory that is
// not where the move said it went, or is not the directory the root was open on,
// ends the root, and a later lookup creates nothing until the plugin directory is
// back.
func TestRelocate_ARootWhoseDirectoryIsNotWhereTheMoveWentIsClosedForGood(t *testing.T) {
	cases := map[string]func(t *testing.T, svc *Service, id string) error{
		"the directory is gone": func(t *testing.T, svc *Service, id string) error {
			return os.RemoveAll(pluginDirectory(svc, id))
		},
		"a foreign directory took the new path": func(t *testing.T, svc *Service, id string) error {
			if err := os.RemoveAll(pluginDirectory(svc, id)); err != nil {
				return err
			}
			return os.MkdirAll(filepath.Join(pluginDirectory(svc, id+".staged"), "store"), 0o700)
		},
	}
	for name, move := range cases {
		t.Run(name, func(t *testing.T) {
			svc := NewTestService(t)
			const id = "lost-plugin"
			store, data := relocationFixture(t, svc, id)

			require.NoError(t, svc.relocate(id, id+".staged", func() error { return move(t, svc, id) }))

			for rootName, held := range map[string]*ScopedRoot{"store": store, "data": data} {
				_, err := held.Stat(".")
				require.ErrorIs(t, err, os.ErrClosed, "%s: the root must not be re-pointed", rootName)
			}
			assert.Contains(t, svc.released, id, "the service remembers it must create nothing for the plugin")
			_, err := svc.PluginStore(id)
			require.ErrorIs(t, err, fs.ErrNotExist)
			_, err = svc.PluginData(id)
			require.ErrorIs(t, err, fs.ErrNotExist)
			assert.NoDirExists(t, filepath.Join(pluginDirectory(svc, id), "store"), "a lookup recreated the directory")

			// The plugin is installed again, and its roots are new ones.
			require.NoError(t, os.MkdirAll(pluginDirectory(svc, id), 0o700))
			fresh, err := svc.PluginStore(id)
			require.NoError(t, err)
			assert.NotSame(t, store, fresh)
			require.NoError(t, fresh.WriteFile("new", []byte("new"), 0o600))
		})
	}
}

// Removing the directory closes the roots under it: nothing may hold the tree
// open while it goes, and nothing may write into a deleted directory. Forgetting
// them is the plugin manager's call (ReleasePluginRoots), once the uninstall is
// durable.
func TestRemoveAll_ClosesTheRootsUnderTheTree(t *testing.T) {
	svc := NewTestService(t)
	const id = "removed-plugin"
	store, data := relocationFixture(t, svc, id)
	otherStore, otherData := relocationFixture(t, svc, "other-plugin")
	pluginDir := pluginDirectory(svc, id)
	plugins := svc.Plugins()
	require.NoError(t, plugins.RenameDirectoryNoReplace(id, id+".uninstall"))
	before, listed := openDescriptors()

	require.NoError(t, plugins.RemoveAll(id+".uninstall"))

	require.NoDirExists(t, pluginDir+".uninstall")
	if listed {
		after, _ := openDescriptors()
		assert.Equal(t, before-2, after, "the removed plugin's two roots are closed")
	}
	for name, held := range map[string]*ScopedRoot{"store": store, "data": data} {
		_, err := held.Stat(".")
		require.ErrorIs(t, err, os.ErrClosed, "%s: a late holder gets os.ErrClosed", name)
		require.ErrorIs(t, held.WriteFile("late", []byte("late"), 0o600), os.ErrClosed, "%s: a late write", name)
	}
	// Until the plugin manager releases the plugin the service still answers with
	// the closed roots, and a lookup creates nothing.
	cached, err := svc.PluginStore(id)
	require.NoError(t, err)
	assert.Same(t, store, cached)
	assert.NoDirExists(t, pluginDir)
	svc.ReleasePluginRoots(id)
	_, err = svc.PluginStore(id)
	require.ErrorIs(t, err, fs.ErrNotExist)
	assert.NoDirExists(t, pluginDir)
	requireKeptRoots(t, svc, "other-plugin", otherStore, otherData, "after another plugin's tree was removed")
}

// A lookup, and an operation on a root, that arrive while the directory moves
// wait for the move to end, and then see the plugin where it went. Neither opens
// a handle that would block the move, nor creates a directory in its way.
func TestRelocate_LookupsAndOperationsWaitForTheMove(t *testing.T) {
	svc := NewTestService(t)
	const id = "waiting-plugin"
	store, _ := relocationFixture(t, svc, id)
	const unlistedID = "never-cached"
	require.NoError(t, os.MkdirAll(pluginDirectory(svc, unlistedID), 0o700))
	pluginDir := pluginDirectory(svc, id)

	moving := make(chan struct{})
	proceed := make(chan struct{})
	var proceedOnce sync.Once
	letTheMoveProceed := func() { proceedOnce.Do(func() { close(proceed) }) }
	// Registered after the service's cleanup, so it runs before the service closes:
	// a failure below must not leave the move holding the roots' locks.
	t.Cleanup(letTheMoveProceed)
	moved := make(chan error, 1)
	go func() {
		moved <- svc.relocate(id, id+".staged", func() error {
			close(moving)
			<-proceed
			return os.Rename(pluginDir, pluginDir+".staged")
		})
	}()
	<-moving

	type outcome struct {
		name string
		err  error
	}
	results := make(chan outcome, 3)
	var wg sync.WaitGroup
	attempt := func(name string, run func() error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- outcome{name, run()}
		}()
	}
	attempt("operation on the held root", func() error { return store.WriteFile("late", []byte("late"), 0o600) })
	attempt("lookup of the held root", func() error { _, err := svc.PluginStore(id); return err })
	attempt("lookup of a root nobody holds", func() error { _, err := svc.PluginStore(unlistedID); return err })

	select {
	case blocked := <-results:
		t.Fatalf("%s returned while the directory was moving: %v", blocked.name, blocked.err)
	case <-time.After(150 * time.Millisecond):
	}
	letTheMoveProceed()
	require.NoError(t, <-moved)
	wg.Wait()
	close(results)
	for result := range results {
		require.NoError(t, result.err, result.name)
	}
	assert.FileExists(t, filepath.Join(pluginDir+".staged", "store", "late"), "the waiting write lands where the directory went")
}

// Operations and lookups run in a loop while the directory moves back and forth:
// every operation either waits for a move or runs between two, so none fails.
func TestRelocate_OperationsAndLookupsNeverFailWhileTheDirectoryMoves(t *testing.T) {
	svc := NewTestService(t)
	const (
		id      = "busy-plugin"
		workers = 4
		moves   = 60
	)
	store, data := relocationFixture(t, svc, id)
	plugins := svc.Plugins()

	var failures sync.Map
	done := make(chan struct{})
	var wg sync.WaitGroup
	for worker := range workers {
		wg.Add(1)
		// One file per worker: concurrent creation and truncation of one file
		// fails transiently on some file systems, with no directory moving.
		busy := fmt.Sprintf("busy-%d", worker)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-done:
					return
				default:
				}
				for name, run := range map[string]func() error{
					"write":        func() error { return store.WriteFile(busy, []byte("x"), 0o600) },
					"read":         func() error { _, err := data.ReadFile("kept"); return err },
					"list":         func() error { _, err := store.ReadDir("."); return err },
					"lookup store": func() error { _, err := svc.PluginStore(id); return err },
					"lookup data":  func() error { _, _, err := svc.PluginDataIfExists(id); return err },
				} {
					if err := run(); err != nil {
						failures.Store(name, err)
					}
				}
			}
		}()
	}
	for range moves {
		require.NoError(t, plugins.RenameDirectoryNoReplace(id, id+".staged"))
		require.NoError(t, plugins.RenameDirectoryNoReplace(id+".staged", id))
	}
	close(done)
	wg.Wait()

	failures.Range(func(name, err any) bool {
		t.Errorf("%v failed while the directory moved: %v", name, err)
		return true
	})
	require.NoError(t, store.WriteFile("final", []byte("ok"), 0o600))
	assert.FileExists(t, filepath.Join(pluginDirectory(svc, id), "store", "final"))
}

func TestScopedRoot_FSFollowsTheDirectory(t *testing.T) {
	svc := NewTestService(t)
	const id = "fs-plugin"
	store, _ := relocationFixture(t, svc, id)
	view := store.FS()
	require.NoError(t, svc.Plugins().RenameDirectoryNoReplace(id, id+".staged"))

	file, err := view.Open("kept")

	require.NoError(t, err, "an fs.FS taken before the move reads the directory where it is now")
	require.NoError(t, file.Close())
}
