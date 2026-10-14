package plugin

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type tarEntry struct {
	name string
	mode int64
	dir  bool
	body string
}

func writeTestTarball(t *testing.T, entries []tarEntry) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "plugin.tar.gz")
	f, err := os.Create(path)
	require.NoError(t, err)
	defer f.Close()

	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	for _, e := range entries {
		hdr := &tar.Header{Name: e.name, Mode: e.mode, Size: int64(len(e.body)), Typeflag: tar.TypeReg}
		if e.dir {
			hdr.Typeflag = tar.TypeDir
			hdr.Size = 0
		}
		require.NoError(t, tw.WriteHeader(hdr))
		if !e.dir {
			_, err = tw.Write([]byte(e.body))
			require.NoError(t, err)
		}
	}
	require.NoError(t, tw.Close())
	require.NoError(t, gz.Close())
	return path
}

const uiOnlyYaml = "id: flux\nversion: 0.3.0\ncapabilities:\n  - ui\n"
const backendYaml = "id: kubernetes\nversion: 0.3.2\ncapabilities:\n  - resource\n  - ui\n"

func TestCheckTarball_UIOnlyWithoutBinary(t *testing.T) {
	path := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: uiOnlyYaml},
		{name: "assets/", mode: 0755, dir: true},
		{name: "assets/entry.js", mode: 0644, body: "export default {}"},
		{name: "bin/", mode: 0755, dir: true},
	})
	assert.NoError(t, checkTarball(path))
}

func TestCheckTarball_BackendWithBinary(t *testing.T) {
	path := writeTestTarball(t, []tarEntry{
		{name: "./plugin.yaml", mode: 0644, body: backendYaml},
		{name: "./bin/plugin", mode: 0755, body: "#!/bin/sh\n"},
	})
	assert.NoError(t, checkTarball(path))
}

func TestCheckTarball_BackendMissingBinary(t *testing.T) {
	path := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: backendYaml},
	})
	err := checkTarball(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing required binary")
}

func TestCheckTarball_BinaryNotExecutable(t *testing.T) {
	path := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: backendYaml},
		{name: "bin/plugin", mode: 0644, body: "data"},
	})
	err := checkTarball(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not executable")
}

func TestCheckTarball_MissingPluginYaml(t *testing.T) {
	path := writeTestTarball(t, []tarEntry{
		{name: "bin/plugin", mode: 0755, body: "#!/bin/sh\n"},
	})
	err := checkTarball(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing required plugin.yaml")
}

func TestInstallPluginFromPath_UIOnly(t *testing.T) {
	pm := newTestManager(t)
	path := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: uiOnlyYaml},
		{name: "assets/", mode: 0755, dir: true},
		{name: "assets/entry.js", mode: 0644, body: "export default {}"},
		{name: "bin/", mode: 0755, dir: true},
	})

	meta, err := pm.InstallPluginFromPath(path)
	require.NoError(t, err)
	assert.Equal(t, "flux", meta.ID)
	assert.FileExists(t, filepath.Join(pm.pluginsRoot.ResolvePath("flux"), "assets", "entry.js"))
}
