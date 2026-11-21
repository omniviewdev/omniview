package plugin

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/appstate"
)

// TestReinstallWithoutAStateReleaserWritesThroughTheOldRoots shows what the
// application's call of SetPluginStateReleaser prevents: the manager disposes of
// the plugin's directory, and nothing tells the state service to let go of the
// roots it opened in it, so the host's writes for the reinstalled plugin go to the
// deleted directory. The wiring in main.go is pinned by
// TestPluginManagerReleasesTheStateRootsOfAnUninstalledPlugin; the fixture of the
// other uninstall tests wires the releaser the way main.go does.
func TestReinstallWithoutAStateReleaserWritesThroughTheOldRoots(t *testing.T) {
	appstate.SkipIfOpenRootBlocksRename(t)
	f := newCredentialFixture(t)
	f.pm.SetPluginStateReleaser(nil)
	f.install(t)
	first, err := f.svc.PluginStore("flux")
	require.NoError(t, err)

	_, err = f.pm.UninstallPlugin("flux")
	require.NoError(t, err)
	f.install(t)

	second, err := f.svc.PluginStore("flux")
	require.NoError(t, err)
	assert.Same(t, first, second, "without the releaser the service still answers with the root of the deleted directory")
	require.Error(t, second.WriteFile("late.json", []byte("x"), 0o600), "the host's write lands in a directory that no longer exists")
}
