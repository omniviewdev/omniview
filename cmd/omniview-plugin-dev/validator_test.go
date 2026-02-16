package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidatePlugin_FullPlugin(t *testing.T) {
	dir := t.TempDir()

	require.NoError(t, os.MkdirAll(filepath.Join(dir, "pkg"), 0755))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "ui"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(`
id: test-plugin
name: Test Plugin
version: 1.0.0
capabilities:
  - resource
  - ui
`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "pkg", "main.go"), []byte("package main"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "vite.config.ts"), []byte("export default {}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "package.json"), []byte("{}"), 0644))

	meta, err := ValidatePlugin(dir)
	require.NoError(t, err)
	assert.Equal(t, "test-plugin", meta.ID)
	assert.Equal(t, "Test Plugin", meta.Name)
	assert.Equal(t, "1.0.0", meta.Version)
	assert.True(t, meta.HasBackend)
	assert.True(t, meta.HasUI)
}

func TestValidatePlugin_MissingPluginYaml(t *testing.T) {
	dir := t.TempDir()
	_, err := ValidatePlugin(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "plugin.yaml not found")
}

func TestValidatePlugin_MissingID(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(`
version: 1.0.0
capabilities:
  - ui
`), 0644))

	_, err := ValidatePlugin(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "'id' field is required")
}

func TestValidatePlugin_MissingMainGo(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(`
id: test
version: 1.0.0
capabilities:
  - resource
`), 0644))

	_, err := ValidatePlugin(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "pkg/main.go")
}

func TestValidatePlugin_UIOnly(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "ui"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(`
id: ui-plugin
name: UI Plugin
version: 1.0.0
capabilities:
  - ui
`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "vite.config.ts"), []byte("export default {}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "package.json"), []byte("{}"), 0644))

	meta, err := ValidatePlugin(dir)
	require.NoError(t, err)
	assert.Equal(t, "ui-plugin", meta.ID)
	assert.False(t, meta.HasBackend)
	assert.True(t, meta.HasUI)
}

func TestValidatePlugin_NoCapabilities(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(`
id: empty
version: 1.0.0
`), 0644))

	_, err := ValidatePlugin(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no capabilities")
}

func TestValidatePlugin_NameDefaultsToID(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "ui"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(`
id: my-plugin
version: 1.0.0
capabilities:
  - ui
`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "vite.config.ts"), []byte("export default {}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "package.json"), []byte("{}"), 0644))

	meta, err := ValidatePlugin(dir)
	require.NoError(t, err)
	assert.Equal(t, "my-plugin", meta.Name)
}
