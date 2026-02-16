package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewBuilder(t *testing.T) {
	log := NewLogger(false)
	meta := &PluginMetaCLI{ID: "test", Version: "1.0.0"}
	b := NewBuilder("/tmp/test-plugin", meta, log)

	require.NotNil(t, b)
	assert.Equal(t, "/tmp/test-plugin", b.pluginDir)
	assert.Equal(t, meta, b.meta)
	assert.Equal(t, log, b.log)
}

func TestBuilder_BinaryPath(t *testing.T) {
	log := NewLogger(false)
	meta := &PluginMetaCLI{ID: "test"}

	tests := []struct {
		name      string
		pluginDir string
		expected  string
	}{
		{
			name:      "simple path",
			pluginDir: "/home/user/plugins/my-plugin",
			expected:  "/home/user/plugins/my-plugin/build/bin/plugin",
		},
		{
			name:      "nested path",
			pluginDir: "/opt/omniview/dev/plugins/kubernetes",
			expected:  "/opt/omniview/dev/plugins/kubernetes/build/bin/plugin",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := NewBuilder(tt.pluginDir, meta, log)
			assert.Equal(t, tt.expected, b.BinaryPath())
		})
	}
}

func TestBuilder_TransferToInstall(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	pluginDir := t.TempDir()
	meta := &PluginMetaCLI{ID: "test-plugin", Version: "1.0.0"}
	log := NewLogger(false)
	b := NewBuilder(pluginDir, meta, log)

	// Create the source binary.
	buildDir := filepath.Join(pluginDir, "build", "bin")
	require.NoError(t, os.MkdirAll(buildDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(buildDir, "plugin"), []byte("fake-binary"), 0755))

	// Create plugin.yaml.
	require.NoError(t, os.WriteFile(filepath.Join(pluginDir, "plugin.yaml"), []byte("id: test-plugin\nversion: 1.0.0"), 0644))

	err := b.TransferToInstall()
	require.NoError(t, err)

	// Verify binary was copied.
	installBin := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin", "bin", "plugin")
	data, err := os.ReadFile(installBin)
	require.NoError(t, err)
	assert.Equal(t, "fake-binary", string(data))

	// Verify plugin.yaml was copied.
	installMeta := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin", "plugin.yaml")
	metaData, err := os.ReadFile(installMeta)
	require.NoError(t, err)
	assert.Contains(t, string(metaData), "test-plugin")
}

func TestBuilder_TransferToInstall_MissingBinary(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	pluginDir := t.TempDir()
	meta := &PluginMetaCLI{ID: "test-plugin"}
	log := NewLogger(false)
	b := NewBuilder(pluginDir, meta, log)

	err := b.TransferToInstall()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to read built binary")
}

func TestBuilder_TransferToInstall_MissingPluginYaml(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	pluginDir := t.TempDir()
	meta := &PluginMetaCLI{ID: "test-plugin"}
	log := NewLogger(false)
	b := NewBuilder(pluginDir, meta, log)

	// Create only the binary, not plugin.yaml.
	buildDir := filepath.Join(pluginDir, "build", "bin")
	require.NoError(t, os.MkdirAll(buildDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(buildDir, "plugin"), []byte("fake"), 0755))

	err := b.TransferToInstall()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to read plugin.yaml")
}
