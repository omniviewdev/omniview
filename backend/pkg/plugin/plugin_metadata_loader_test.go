package plugin

import (
	"os"
	"path/filepath"
	"runtime/debug"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// The host reads every plugin.yaml through the SDK's types.LoadPluginMetadata. Two promises
// it relies on were held by the host's own copy of the loader (internal/pluginmeta, deleted
// when the pin reached the SDK that closes the file) and are held here now.

// A plugin directory without plugin.yaml is reported as 404 "Plugin metadata missing", not
// as a 500: the loader tells a missing manifest from a bad one by errors.Is(os.ErrNotExist),
// which holds only while the SDK wraps the open error with %w.
func TestLoadPlugin_MissingManifestIsReportedAsNotFound(t *testing.T) {
	pm := newTestManager(t)
	require.NoError(t, pm.pluginsRoot.MkdirAll("no-meta", 0755))

	_, err := pm.LoadPlugin("no-meta", nil)

	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	require.Equal(t, 404, app.Status)
	require.Equal(t, "Plugin metadata missing", app.Title)
}

// The SDK's loader closes plugin.yaml before it returns, on every path. Windows refuses to
// rename or remove a directory that holds an open file, and the host renames and removes a
// plugin's directory to update or uninstall the plugin, so an open file fails those with
// "Access is denied" until the garbage collector finalizes it. Where the system lists a
// process's descriptors the test counts them; everywhere it makes the move the host makes.
// The SDK's own tests run in the SDK's CI, whose Windows leg does not run its types package.
func TestPinnedSDKLoaderClosesTheManifestOnEveryPath(t *testing.T) {
	descriptors := func() (int, bool) {
		entries, err := os.ReadDir("/dev/fd")
		return len(entries), err == nil
	}
	for name, files := range map[string]map[string]string{
		"a manifest":  {"plugin.yaml": "id: flux\nversion: 1.2.3\n"},
		"an empty":    {"plugin.yaml": ""},
		"not yaml":    {"plugin.yaml": "id: [unterminated\n"},
		"no manifest": {},
	} {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join(t.TempDir(), "plugin")
			require.NoError(t, os.Mkdir(dir, 0o700))
			for file, content := range files {
				require.NoError(t, os.WriteFile(filepath.Join(dir, file), []byte(content), 0o600))
			}
			previous := debug.SetGCPercent(-1) // no finalizer may close a leaked file during the test
			t.Cleanup(func() { debug.SetGCPercent(previous) })

			before, listed := descriptors()
			for range 4 {
				_, _ = sdktypes.LoadPluginMetadata(dir)
			}
			if listed {
				after, _ := descriptors()
				require.Equal(t, before, after, "the pinned SDK's loader left a file descriptor open")
			}
			require.NoError(t, os.Rename(dir, dir+".renamed"),
				"the plugin directory cannot be renamed while a file in it is open")
		})
	}
}
