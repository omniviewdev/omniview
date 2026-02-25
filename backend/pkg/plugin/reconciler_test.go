package plugin

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// writePluginYAML creates a minimal plugin.yaml in the given directory.
func writePluginYAML(t *testing.T, dir string, meta config.PluginMeta) {
	t.Helper()
	content := "id: " + meta.ID + "\nname: " + meta.Name + "\nversion: " + meta.Version + "\n"
	if len(meta.Capabilities) > 0 {
		content += "capabilities:\n"
		for _, cap := range meta.Capabilities {
			content += "  - " + cap + "\n"
		}
	}
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(content), 0644))
}

// createPluginDir creates a plugin directory with a plugin.yaml.
func createPluginDir(t *testing.T, pluginDir, id string, caps []string) string {
	t.Helper()
	dir := filepath.Join(pluginDir, id)
	require.NoError(t, os.MkdirAll(dir, 0755))
	writePluginYAML(t, dir, config.PluginMeta{
		ID:           id,
		Name:         id,
		Version:      "1.0.0",
		Capabilities: caps,
	})
	return dir
}

func TestReconciler_EmptyDirectory(t *testing.T) {
	dir := t.TempDir()
	r := NewReconciler(testLogger(t))

	result, err := r.Reconcile(dir, nil)
	require.NoError(t, err)
	assert.Empty(t, result.Records)
	assert.Empty(t, result.Orphans)
	assert.Empty(t, result.Ghosts)
}

func TestReconciler_ValidPluginAdoptedAsOrphan(t *testing.T) {
	dir := t.TempDir()
	createPluginDir(t, dir, "test-plugin", []string{"ui"})

	r := NewReconciler(testLogger(t))
	result, err := r.Reconcile(dir, nil)
	require.NoError(t, err)

	assert.Len(t, result.Records, 1)
	assert.Contains(t, result.Records, "test-plugin")
	assert.Equal(t, lifecycle.PhaseInstalled, result.Records["test-plugin"].Phase)
	assert.Contains(t, result.Orphans, "test-plugin")
	assert.Empty(t, result.Ghosts)
}

func TestReconciler_DirectoryWithoutPluginYAML_Skipped(t *testing.T) {
	dir := t.TempDir()
	// Create a directory without plugin.yaml.
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "bad-plugin"), 0755))

	r := NewReconciler(testLogger(t))
	result, err := r.Reconcile(dir, nil)
	require.NoError(t, err)

	assert.Empty(t, result.Records)
	assert.Empty(t, result.Orphans)
}

func TestReconciler_PersistedStateWithNoMatchingDirectory_Ghost(t *testing.T) {
	dir := t.TempDir()
	persisted := []plugintypes.PluginStateRecord{
		{
			ID:       "ghost-plugin",
			Phase:    lifecycle.PhaseRunning,
			Enabled:  true,
			Metadata: config.PluginMeta{ID: "ghost-plugin", Capabilities: []string{"resource"}},
		},
	}

	r := NewReconciler(testLogger(t))
	result, err := r.Reconcile(dir, persisted)
	require.NoError(t, err)

	assert.Empty(t, result.Records)
	assert.Contains(t, result.Ghosts, "ghost-plugin")
}

func TestReconciler_BothPersistedAndDirectory_MergedRecord(t *testing.T) {
	dir := t.TempDir()
	plugDir := createPluginDir(t, dir, "my-plugin", []string{"ui"})

	// Create assets dir so UI validation passes.
	require.NoError(t, os.MkdirAll(filepath.Join(plugDir, "assets"), 0755))

	persisted := []plugintypes.PluginStateRecord{
		{
			ID:       "my-plugin",
			Phase:    lifecycle.PhaseRunning,
			Enabled:  true,
			DevMode:  true,
			DevPath:  "/some/path",
			Metadata: config.PluginMeta{ID: "my-plugin", Capabilities: []string{"ui"}},
		},
	}

	r := NewReconciler(testLogger(t))
	result, err := r.Reconcile(dir, persisted)
	require.NoError(t, err)

	assert.Len(t, result.Records, 1)
	record := result.Records["my-plugin"]
	assert.Equal(t, true, record.Enabled)
	assert.Equal(t, true, record.DevMode)
	assert.Equal(t, "/some/path", record.DevPath)
	assert.Empty(t, result.Orphans)
	assert.Empty(t, result.Ghosts)
}

func TestReconciler_MissingPluginDir_EmptyResult(t *testing.T) {
	r := NewReconciler(testLogger(t))
	result, err := r.Reconcile("/nonexistent/path/that/does/not/exist", nil)
	require.NoError(t, err)
	assert.Empty(t, result.Records)
}

func TestReconciler_FilesIgnored(t *testing.T) {
	dir := t.TempDir()
	// Create a file (not a directory) in the plugin dir.
	require.NoError(t, os.WriteFile(filepath.Join(dir, "not-a-dir"), []byte("hello"), 0644))

	r := NewReconciler(testLogger(t))
	result, err := r.Reconcile(dir, nil)
	require.NoError(t, err)
	assert.Empty(t, result.Records)
}

func TestDetermineInitialPhase_Disabled(t *testing.T) {
	r := NewReconciler(testLogger(t))
	phase := r.determineInitialPhase(plugintypes.PluginStateRecord{
		Enabled: false,
	}, "/nonexistent")
	assert.Equal(t, lifecycle.PhaseStopped, phase)
}

func TestDetermineInitialPhase_BackendWithBinary(t *testing.T) {
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	require.NoError(t, os.MkdirAll(binDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(binDir, "plugin"), []byte("x"), 0755))

	r := NewReconciler(testLogger(t))
	phase := r.determineInitialPhase(plugintypes.PluginStateRecord{
		Enabled:  true,
		Metadata: config.PluginMeta{ID: "test", Capabilities: []string{"resource"}},
	}, dir)
	assert.Equal(t, lifecycle.PhaseInstalled, phase)
}

func TestDetermineInitialPhase_BackendNoBinary_NotDev(t *testing.T) {
	r := NewReconciler(testLogger(t))
	phase := r.determineInitialPhase(plugintypes.PluginStateRecord{
		Enabled:  true,
		Metadata: config.PluginMeta{ID: "test", Capabilities: []string{"resource"}},
	}, t.TempDir())
	assert.Equal(t, lifecycle.PhaseFailed, phase)
}

func TestDetermineInitialPhase_BackendNoBinary_DevMode(t *testing.T) {
	r := NewReconciler(testLogger(t))
	phase := r.determineInitialPhase(plugintypes.PluginStateRecord{
		Enabled:  true,
		DevMode:  true,
		Metadata: config.PluginMeta{ID: "test", Capabilities: []string{"resource"}},
	}, t.TempDir())
	assert.Equal(t, lifecycle.PhaseBuilding, phase)
}

func TestDetermineInitialPhase_UIOnly(t *testing.T) {
	r := NewReconciler(testLogger(t))
	phase := r.determineInitialPhase(plugintypes.PluginStateRecord{
		Enabled:  true,
		Metadata: config.PluginMeta{ID: "test", Capabilities: []string{"ui"}},
	}, t.TempDir())
	assert.Equal(t, lifecycle.PhaseInstalled, phase)
}

func TestReconcileFromFilesystem(t *testing.T) {
	dir := t.TempDir()
	createPluginDir(t, dir, "plugin-a", []string{"ui"})
	createPluginDir(t, dir, "plugin-b", []string{"resource"})

	r := NewReconciler(testLogger(t))
	result, err := r.ReconcileFromFilesystem(dir)
	require.NoError(t, err)

	assert.Len(t, result.Records, 2)
	assert.Contains(t, result.Records, "plugin-a")
	assert.Contains(t, result.Records, "plugin-b")

	// plugin-b requires a binary but none exists → PhaseFailed
	assert.Equal(t, lifecycle.PhaseFailed, result.Records["plugin-b"].Phase)
	// plugin-a has UI only, no binary needed → PhaseInstalled
	assert.Equal(t, lifecycle.PhaseInstalled, result.Records["plugin-a"].Phase)
}
