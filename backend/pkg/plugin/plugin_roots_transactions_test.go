package plugin

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/appstate"
)

// The uninstall, the update and their rollbacks move a plugin directory that has
// the roots the host holds on the plugin's store and data directories open
// beneath it, and Windows refuses to move or remove a directory with anything
// open beneath it. These tests run the transactions with such roots held, with a
// plugin that needs no binary, so that they run on every OS: the credential
// fixture's archive carries a Unix shell script as its binary and skips on Windows.

const rootsPluginID = "flux"

// rootsFixture is a manager over a state service, with the user interface only
// plugin installed and loaded, and its store and data roots held, with a file in
// each, the way the controllers hold them.
type rootsFixture struct {
	pm       *pluginManager
	svc      *appstate.Service
	store    *appstate.ScopedRoot
	data     *appstate.ScopedRoot
	released []string
}

func newRootsFixture(t *testing.T) *rootsFixture {
	t.Helper()
	pm, svc := newTestManagerWithState(t)
	f := &rootsFixture{pm: pm, svc: svc, store: nil, data: nil, released: nil}
	pm.SetPluginStateReleaser(func(id string) {
		f.released = append(f.released, id)
		svc.ReleasePluginRoots(id)
	})
	installPluginFixture(t, pm, rootsPluginID, []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll(rootsPluginID+"/assets", 0o755))
	_, err := pm.LoadPlugin(rootsPluginID, nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	f.store, err = svc.PluginStore(rootsPluginID)
	require.NoError(t, err)
	f.data, err = svc.PluginData(rootsPluginID)
	require.NoError(t, err)
	for name, root := range f.roots() {
		require.NoError(t, root.WriteFile("retained", []byte(name), 0o600))
	}
	return f
}

func (f *rootsFixture) roots() map[string]*appstate.ScopedRoot {
	return map[string]*appstate.ScopedRoot{"store": f.store, "data": f.data}
}

func (f *rootsFixture) pluginDir() string {
	return f.pm.pluginsRoot.ResolvePath(rootsPluginID)
}

// requireRootsLive fails unless the service still answers with the roots held and
// they write into the live plugin directory.
func (f *rootsFixture) requireRootsLive(t *testing.T, marker string) {
	t.Helper()
	store, err := f.svc.PluginStore(rootsPluginID)
	require.NoError(t, err)
	assert.Same(t, f.store, store)
	data, err := f.svc.PluginData(rootsPluginID)
	require.NoError(t, err)
	assert.Same(t, f.data, data)
	for name, root := range f.roots() {
		require.NoError(t, root.WriteFile(marker, []byte(name), 0o600), "%s: write through the held root", name)
		assert.FileExists(t, filepath.Join(f.pluginDir(), name, "retained"), "%s: what the plugin kept is still there", name)
		assert.FileExists(t, filepath.Join(f.pluginDir(), name, marker), "%s: the write landed in the live directory", name)
	}
}

func rootsArchive(t *testing.T, version string) string {
	t.Helper()
	return writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0o644, body: "id: " + rootsPluginID + "\nversion: " + version + "\ncapabilities: [ui]\n"},
		{name: "assets/", mode: 0o755, dir: true},
		{name: "assets/entry.js", mode: 0o644, body: "bundle " + version},
	})
}

func (f *rootsFixture) installedVersion(t *testing.T) string {
	t.Helper()
	info, err := f.pm.GetPlugin(rootsPluginID)
	require.NoError(t, err)
	return info.Metadata.Version
}

// An uninstall stages the plugin directory by rename and deletes the staged tree:
// the held roots must neither stop the rename nor the deletion.
func TestUninstallPlugin_WithHeldStateRootsStagesAndDeletesTheDirectory(t *testing.T) {
	f := newRootsFixture(t)

	_, err := f.pm.UninstallPlugin(rootsPluginID)

	require.NoError(t, err)
	assert.NoDirExists(t, f.pluginDir())
	assert.Equal(t, []string{rootsPluginID}, f.released, "the roots are released once the uninstall is durable")
	for name, root := range f.roots() {
		_, statErr := root.Stat(".")
		require.ErrorIs(t, statErr, os.ErrClosed, "%s: a late holder gets os.ErrClosed", name)
	}
	_, err = f.svc.PluginStore(rootsPluginID)
	require.ErrorIs(t, err, fs.ErrNotExist, "a late lookup of a plugin that is gone finds nothing")
	assert.NoDirExists(t, f.pluginDir(), "a late lookup must not resurrect the plugin directory")
	entries, err := f.pm.pluginsRoot.ReadDir(".")
	require.NoError(t, err)
	assert.Empty(t, entries, "no staging is left behind")
}

// An uninstall that fails after staging puts the directory back, and the roots
// the host holds stay the ones the service answers with.
func TestUninstallPlugin_RolledBackWithHeldStateRootsKeepsThemLive(t *testing.T) {
	f := newRootsFixture(t)
	// A directory where the inventory's temporary file belongs makes the inventory
	// write fail, so the uninstall rolls back after staging.
	require.NoError(t, f.pm.stateRoot.MkdirAll(stateFileName+".tmp", 0o755))

	_, err := f.pm.UninstallPlugin(rootsPluginID)

	require.Error(t, err)
	assert.Empty(t, f.released, "a rolled-back uninstall releases no root")
	assert.Equal(t, "1.0.0", f.installedVersion(t), "the plugin stays installed")
	f.requireRootsLive(t, "after-rollback")
}

// An update stages the running installation, publishes the candidate and moves
// the state directories into it: the held roots must follow, and nothing may
// stop the three renames or the deletion of the previous installation.
func TestSuccessfulUpdateWithHeldStateRootsMovesTheStateIntoTheNewDirectory(t *testing.T) {
	f := newRootsFixture(t)

	_, err := f.pm.InstallPluginFromPath(rootsArchive(t, "1.1.0"))

	require.NoError(t, err)
	assert.Equal(t, "1.1.0", f.installedVersion(t))
	assert.Empty(t, f.released, "an update keeps the plugin's state directories and the roots held on them")
	f.requireRootsLive(t, "after-update")
	assert.NoFileExists(t, f.pm.stateRoot.ResolvePath(archiveRecoveryName(rootsPluginID)), "an update leaves no recovery marker")
	entries, err := f.pm.pluginsRoot.ReadDir(".")
	require.NoError(t, err)
	require.Len(t, entries, 1, "the previous installation and the staging are gone")
	assert.Equal(t, rootsPluginID, entries[0].Name())
}

// An update that fails after the candidate started puts the original installation
// back, state directories included, and the held roots with it.
func TestFailedUpdateWithHeldStateRootsRestoresThem(t *testing.T) {
	f := newRootsFixture(t)
	// A directory where the inventory's temporary file belongs makes the commit of
	// the inventory fail after the new version started: the update rolls back.
	require.NoError(t, f.pm.stateRoot.MkdirAll(stateFileName+".tmp", 0o755))

	_, err := f.pm.InstallPluginFromPath(rootsArchive(t, "1.1.0"))

	require.Error(t, err)
	assert.Equal(t, "1.0.0", f.installedVersion(t), "the original installation is back")
	assert.Empty(t, f.released)
	f.requireRootsLive(t, "after-rollback")
	assert.NoFileExists(t, f.pm.stateRoot.ResolvePath(archiveRecoveryName(rootsPluginID)), "a completed rollback leaves no recovery marker")
}

// Lookups and operations on the held roots run in tight loops while the plugin is
// updated again and again. Each waits for a move or runs between two; none opens
// a handle that would stop a move, and none creates a directory in its way.
func TestInstallPluginFromPath_ConcurrentStateLookupsAndOperationsDuringUpdatesNeverBreakThem(t *testing.T) {
	const (
		workers = 4
		updates = 3
	)
	f := newRootsFixture(t)

	var failures sync.Map
	done := make(chan struct{})
	var wg sync.WaitGroup
	for worker := range workers {
		wg.Add(1)
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
					"lookup store":    func() error { _, err := f.svc.PluginStore(rootsPluginID); return err },
					"lookup data":     func() error { _, err := f.svc.PluginData(rootsPluginID); return err },
					"lookup if there": func() error { _, _, err := f.svc.PluginDataIfExists(rootsPluginID); return err },
					"write":           func() error { return f.store.WriteFile(busy, []byte("x"), 0o600) },
					"read":            func() error { _, err := f.data.ReadFile("retained"); return err },
				} {
					if err := run(); err != nil {
						failures.Store(name, err)
					}
				}
			}
		}()
	}
	var updateErr error
	for update := 1; update <= updates && updateErr == nil; update++ {
		_, updateErr = f.pm.InstallPluginFromPath(rootsArchive(t, fmt.Sprintf("1.%d.0", update)))
	}
	close(done)
	wg.Wait()

	require.NoError(t, updateErr, "an update failed because a lookup or an operation overlapped it")
	failures.Range(func(name, err any) bool {
		t.Errorf("%v failed while the plugin was updated: %v", name, err)
		return true
	})
	assert.Equal(t, fmt.Sprintf("1.%d.0", updates), f.installedVersion(t))
	f.requireRootsLive(t, "after-updates")
}
