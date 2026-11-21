package pluginmeta

import (
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// pluginDirectory returns a directory holding the named files.
func pluginDirectory(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "plugin")
	require.NoError(t, os.Mkdir(dir, 0o700))
	for name, content := range files {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600))
	}
	return dir
}

// openDescriptors counts the process's open file descriptors through /dev/fd.
// ok is false where the system cannot list them (Windows).
func openDescriptors() (count int, ok bool) {
	entries, err := os.ReadDir("/dev/fd")
	return len(entries), err == nil
}

// holdTheCollectorOff stops the garbage collector from starting, so that no
// finalizer closes a leaked file while a test looks for it.
func holdTheCollectorOff(t *testing.T) {
	t.Helper()
	previous := debug.SetGCPercent(-1)
	t.Cleanup(func() { debug.SetGCPercent(previous) })
}

const manifest = `id: flux
version: 1.2.3
name: Flux
capabilities: [resource, ui]
requires:
  connections:
    - plugin: kubernetes
`

// Load is a drop-in for the SDK's loader: the same manifest, the same error text.
func TestLoadReturnsWhatTheSDKLoaderReturns(t *testing.T) {
	cases := map[string]map[string]string{
		"a manifest":     {"plugin.yaml": manifest},
		"an empty file":  {"plugin.yaml": ""},
		"not yaml":       {"plugin.yaml": "id: [unterminated\n"},
		"a wrong type":   {"plugin.yaml": "id: flux\ncapabilities: {a: b}\n"},
		"no manifest":    {},
		"only a README":  {"README.md": "# Flux\n"},
		"a manifest dir": nil,
	}
	for name, files := range cases {
		t.Run(name, func(t *testing.T) {
			dir := pluginDirectory(t, files)
			if files == nil {
				require.NoError(t, os.Mkdir(filepath.Join(dir, "plugin.yaml"), 0o700))
			}

			got, gotErr := Load(dir)
			want, wantErr := sdktypes.LoadPluginMetadata(dir)

			require.Equal(t, want, got)
			if wantErr == nil {
				require.NoError(t, gotErr)
				return
			}
			require.EqualError(t, gotErr, wantErr.Error())
			require.Equal(t, errors.Is(wantErr, os.ErrNotExist), errors.Is(gotErr, os.ErrNotExist))
		})
	}
}

func TestLoadReadsTheManifest(t *testing.T) {
	meta, err := Load(pluginDirectory(t, map[string]string{"plugin.yaml": manifest}))

	require.NoError(t, err)
	require.Equal(t, "flux", meta.ID)
	require.Equal(t, "1.2.3", meta.Version)
	require.Equal(t, []string{"resource", "ui"}, meta.Capabilities)
	require.NotNil(t, meta.Requires)
	require.Equal(t, "kubernetes", meta.Requires.Connections[0].Plugin)
}

func TestLoadMissingManifestIsNotExist(t *testing.T) {
	_, err := Load(pluginDirectory(t, nil))

	require.ErrorIs(t, err, os.ErrNotExist, "the loader tells a missing manifest from a bad one by this")
}

// The host renames and removes a plugin's directory to update or uninstall the
// plugin. Windows refuses both while a file inside is open, so Load must have
// closed its file when it returns, whichever way it returns, and never leave that
// to the garbage collector.
func TestLoadClosesItsFileOnEveryPath(t *testing.T) {
	cases := map[string]map[string]string{
		"a manifest":  {"plugin.yaml": manifest},
		"an empty":    {"plugin.yaml": ""},
		"not yaml":    {"plugin.yaml": "id: [unterminated\n"},
		"no manifest": {},
	}
	for name, files := range cases {
		t.Run(name, func(t *testing.T) {
			dir := pluginDirectory(t, files)
			holdTheCollectorOff(t)

			before, listed := openDescriptors()
			for range 4 {
				_, _ = Load(dir)
			}

			if listed {
				after, _ := openDescriptors()
				require.Equal(t, before, after, "Load left a file descriptor open after it returned")
			}
			require.NoError(t, os.Rename(dir, dir+".renamed"),
				"the plugin directory cannot be renamed while a file in it is open")
		})
	}
}

// A tripwire for the day this host pins an SDK whose loader closes plugin.yaml
// (plugin-sdk after v0.20.0). Until then the SDK's types.LoadPluginMetadata leaves
// the file open until the garbage collector finalizes it, and the host reads
// manifests through Load. When this fails, delete this package and this test and
// call types.LoadPluginMetadata at the places that call Load: its caller list is
// what TestNoHostCodeCallsTheLeakingSDKLoaders guarded.
func TestPinnedSDKStillLeavesTheManifestOpen(t *testing.T) {
	dir, err := os.MkdirTemp("", "pluginmeta-tripwire-")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(manifest), 0o600))
	t.Cleanup(func() {
		// Where the SDK leaks the file, Windows cannot remove the directory until the
		// collector has finalized it. Removal here is best effort: the directory is a
		// scratch directory, and a failed removal is no verdict on the pinned SDK.
		for range 20 {
			runtime.GC()
			if os.RemoveAll(dir) == nil {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	})
	holdTheCollectorOff(t)

	before, listed := openDescriptors()
	_, err = sdktypes.LoadPluginMetadata(dir)
	require.NoError(t, err)

	var leaked bool
	if listed {
		after, _ := openDescriptors()
		leaked = after > before
	} else {
		leaked = os.Rename(dir, dir+".renamed") != nil
		if !leaked {
			_ = os.Rename(dir+".renamed", dir)
		}
	}
	require.True(t, leaked,
		"the pinned SDK now closes plugin.yaml in types.LoadPluginMetadata: delete internal/pluginmeta, "+
			"call types.LoadPluginMetadata where the host calls pluginmeta.Load, and delete this test")
}

// Every host read of a manifest goes through Load while the pinned SDK leaks the
// file. A new call of the SDK's loaders would bring back "Access is denied" on
// Windows for as long as the file stays open.
func TestNoHostCodeCallsTheLeakingSDKLoaders(t *testing.T) {
	const typesPath = `"github.com/omniviewdev/plugin-sdk/pkg/types"`
	leaking := map[string]bool{"LoadPluginMetadata": true, "LoadPluginMarkdown": true}
	root := filepath.Join("..", "..")
	skipped := map[string]bool{"node_modules": true, ".git": true, "dist": true, "build": true}
	// The tripwire calls the SDK's loader on purpose.
	self := filepath.Join("internal", "pluginmeta", "pluginmeta_test.go")

	var offenders []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if skipped[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		relative, relErr := filepath.Rel(root, path)
		if relErr != nil || !strings.HasSuffix(path, ".go") || relative == self {
			return relErr
		}
		fset := token.NewFileSet()
		file, parseErr := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if parseErr != nil {
			return nil // not this test's business: the build reports it
		}
		local := ""
		for _, spec := range file.Imports {
			if spec.Path.Value != typesPath {
				continue
			}
			local = "types"
			if spec.Name != nil {
				local = spec.Name.Name
			}
		}
		if local == "" {
			return nil
		}
		file, parseErr = parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if parseErr != nil {
			return nil
		}
		ast.Inspect(file, func(node ast.Node) bool {
			selector, ok := node.(*ast.SelectorExpr)
			if !ok || !leaking[selector.Sel.Name] {
				return true
			}
			if ident, isIdent := selector.X.(*ast.Ident); isIdent && ident.Name == local {
				offenders = append(offenders, relative+":"+strconv.Itoa(fset.Position(selector.Pos()).Line)+" "+selector.Sel.Name)
			}
			return true
		})
		return nil
	})
	require.NoError(t, err)

	sort.Strings(offenders)
	if len(offenders) > 0 {
		t.Fatalf("read manifests with pluginmeta.Load: the pinned SDK's loaders leave the file open\n%s",
			strings.Join(offenders, "\n"))
	}
}
