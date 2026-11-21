package plugin

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/appstate"
)

// The host caches one store root and one data root per plugin ID, and some
// holders keep a root for the life of the process. An archive replacement keeps
// the plugin's state directories (it moves them into the new plugin directory),
// so it must find nothing in its way: a lookup of the roots, at any moment,
// never closes one or creates a directory. Only an installation that is gone
// for good, an uninstall or a first installation that rolled back, ends them.

// TestInstallPluginFromPath_ConcurrentStateLookupsDoNotBreakReplacement updates
// a plugin whose roots are cached while goroutines look the roots up in a tight
// loop. Between publishing the new plugin directory and moving the state
// directories into it, the plugin directory exists without them; a lookup there
// that closed the cached root and created an empty directory made the move fail
// ("file exists") and the update with it ("requires recovery").
func TestInstallPluginFromPath_ConcurrentStateLookupsDoNotBreakReplacement(t *testing.T) {
	const (
		lookers = 4
		updates = 3
	)
	f := newCredentialFixture(t)
	f.install(t)
	store, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	data, err := f.svc.PluginData("flux")
	require.NoError(t, err)
	require.NoError(t, store.WriteFile("retained", []byte("store"), 0o600))
	require.NoError(t, data.WriteFile("retained", []byte("data"), 0o600))

	stop := make(chan struct{})
	var wg sync.WaitGroup
	var stopOnce sync.Once
	stopLookers := func() {
		stopOnce.Do(func() {
			close(stop)
			wg.Wait()
		})
	}
	defer stopLookers()
	for range lookers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				_, _ = f.svc.PluginStore("flux")
				_, _ = f.svc.PluginData("flux")
				_, _, _ = f.svc.PluginDataIfExists("flux")
			}
		}()
	}

	for update := 1; update <= updates; update++ {
		version := fmt.Sprintf("1.%d.0", update)
		_, err = f.pm.InstallPluginFromPath(credentialArchiveVersion(t, version))
		require.NoError(t, err, "update %d to %s failed because a state lookup overlapped it", update, version)
	}
	stopLookers()

	info, err := f.pm.GetPlugin("flux")
	require.NoError(t, err)
	assert.Equal(t, fmt.Sprintf("1.%d.0", updates), info.Metadata.Version)
	assert.Equal(t, "Running", info.Phase)
	assert.NoFileExists(t, f.pm.stateRoot.ResolvePath(archiveRecoveryName("flux")), "an update leaves no recovery marker")
	// The roots held across the updates are the ones the service still answers
	// with, and they address the live directories.
	pluginDir := f.pm.pluginsRoot.ResolvePath("flux")
	for name, held := range map[string]*appstate.ScopedRoot{"store": store, "data": data} {
		require.NoError(t, held.WriteFile("after", []byte(name), 0o600), "%s: write through the held root", name)
		assert.FileExists(t, filepath.Join(pluginDir, name, "retained"))
		assert.FileExists(t, filepath.Join(pluginDir, name, "after"))
	}
	again, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	assert.Same(t, store, again)
}

// TestFailedFirstInstallReleasesTheRootsItCached covers the other way a plugin
// directory is disposed of for good: a first installation whose plugin started,
// whose host opened its state directories, and which then rolled back. The next
// installation of the ID must get roots on its own directories.
func TestFailedFirstInstallReleasesTheRootsItCached(t *testing.T) {
	f := newCredentialFixture(t)
	var kept atomic.Pointer[appstate.ScopedRoot]
	f.onList = func() {
		// While the plugin starts the host opens its store directory, as the
		// controllers do, and keeps the root.
		if root, err := f.svc.PluginStore("flux"); err == nil {
			kept.Store(root)
		}
	}
	// A directory where the inventory's temporary file belongs makes the commit of
	// the inventory fail, after the plugin started: the installation rolls back.
	require.NoError(t, f.pm.stateRoot.MkdirAll(stateFileName+".tmp", 0o755))
	_, err := f.pm.InstallPluginFromPath(credentialArchive(t))
	require.Error(t, err)
	first := kept.Load()
	require.NotNil(t, first, "precondition: the plugin started and the host kept a root on its store")
	pluginDir := f.pm.pluginsRoot.ResolvePath("flux")
	require.NoDirExists(t, pluginDir, "precondition: the first installation was rolled back")

	// The cause is fixed and the plugin is installed again.
	require.NoError(t, f.pm.stateRoot.Remove(stateFileName+".tmp"))
	f.install(t)

	second, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	assert.NotSame(t, first, second, "the root of the rolled-back installation must not be reused")
	require.NoError(t, second.WriteFile("second.json", []byte("two"), 0o600))
	written, err := os.ReadFile(filepath.Join(pluginDir, "store", "second.json"))
	require.NoError(t, err, "the host's write must land in the new installation")
	assert.Equal(t, "two", string(written))
	require.ErrorIs(t, first.WriteFile("late.json", []byte("late"), 0o600), os.ErrClosed)
	assert.NoFileExists(t, filepath.Join(pluginDir, "store", "late.json"))
}

func TestSuccessfulUpdateReleasesNothing(t *testing.T) {
	f := newCredentialFixture(t)
	f.install(t)
	var released []string
	f.pm.SetPluginStateReleaser(func(id string) { released = append(released, id) })

	_, err := f.pm.InstallPluginFromPath(credentialArchiveVersion(t, "1.1.0"))

	require.NoError(t, err)
	assert.Empty(t, released, "an update keeps the plugin's state directories and the roots held on them")
}

func TestFailedUpdateKeepsThePluginRoots(t *testing.T) {
	f := newCredentialFixture(t)
	f.install(t)
	store, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	require.NoError(t, store.WriteFile("retained", []byte("store"), 0o600))
	var released []string
	f.pm.SetPluginStateReleaser(func(id string) { released = append(released, id) })
	// A directory where the inventory's temporary file belongs makes the commit of
	// the inventory fail after the new version started: the update rolls back.
	require.NoError(t, f.pm.stateRoot.MkdirAll(stateFileName+".tmp", 0o755))

	_, err = f.pm.InstallPluginFromPath(credentialArchiveVersion(t, "1.1.0"))

	require.Error(t, err)
	assert.Empty(t, released, "the original installation is back, with its state directories and the roots held on them")
	info, getErr := f.pm.GetPlugin("flux")
	require.NoError(t, getErr)
	assert.Equal(t, "1.0.0", info.Metadata.Version)
	again, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	assert.Same(t, store, again)
	require.NoError(t, store.WriteFile("after-rollback", []byte("store"), 0o600))
	pluginDir := f.pm.pluginsRoot.ResolvePath("flux")
	assert.FileExists(t, filepath.Join(pluginDir, "store", "retained"))
	assert.FileExists(t, filepath.Join(pluginDir, "store", "after-rollback"))
}
