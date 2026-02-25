package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

func withTempStateFile(t *testing.T) func() {
	t.Helper()
	dir := t.TempDir()
	old := stateFilePathOverride
	stateFilePathOverride = filepath.Join(dir, "plugin_state.json")
	return func() {
		stateFilePathOverride = old
	}
}

func TestWriteAndReadJSON_RoundTrip(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	pm := &pluginManager{
		logger: testLogger(t),
		records: map[string]*types.PluginRecord{
			"test-plugin": {
				ID:          "test-plugin",
				Phase:       lifecycle.PhaseRunning,
				Metadata:    config.PluginMeta{ID: "test-plugin", Name: "Test", Version: "1.0"},
				Enabled:     true,
				DevMode:     true,
				DevPath:     "/dev/path",
				InstalledAt: time.Now().Truncate(time.Second),
			},
		},
	}

	require.NoError(t, pm.writePluginStateJSON())

	records, err := readPluginStateJSON()
	require.NoError(t, err)
	require.Len(t, records, 1)

	r := records[0]
	assert.Equal(t, "test-plugin", r.ID)
	assert.Equal(t, lifecycle.PhaseRunning, r.Phase)
	assert.Equal(t, true, r.Enabled)
	assert.Equal(t, true, r.DevMode)
	assert.Equal(t, "/dev/path", r.DevPath)
}

func TestReadJSON_EmptyFile(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	// Write empty JSON array.
	require.NoError(t, os.MkdirAll(filepath.Dir(stateFilePathOverride), 0755))
	require.NoError(t, os.WriteFile(stateFilePathOverride, []byte("[]"), 0644))

	records, err := readPluginStateJSON()
	require.NoError(t, err)
	assert.Empty(t, records)
}

func TestReadJSON_NonexistentFile(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	records, err := readPluginStateJSON()
	require.NoError(t, err)
	assert.Nil(t, records)
}

func TestReadJSON_CorruptJSON(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	require.NoError(t, os.MkdirAll(filepath.Dir(stateFilePathOverride), 0755))
	require.NoError(t, os.WriteFile(stateFilePathOverride, []byte("{invalid json"), 0644))

	_, err := readPluginStateJSON()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parsing state file")
}

func TestWriteJSON_AtomicDoesNotCorrupt(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	pm := &pluginManager{
		logger: testLogger(t),
		records: map[string]*types.PluginRecord{
			"plugin-a": {
				ID:       "plugin-a",
				Phase:    lifecycle.PhaseRunning,
				Metadata: config.PluginMeta{ID: "plugin-a"},
				Enabled:  true,
			},
		},
	}

	// Write initial state.
	require.NoError(t, pm.writePluginStateJSON())

	// Verify the temp file was cleaned up.
	_, err := os.Stat(stateFilePathOverride + ".tmp")
	assert.True(t, os.IsNotExist(err))

	// Read and verify the file is valid JSON.
	data, err := os.ReadFile(stateFilePathOverride)
	require.NoError(t, err)
	assert.True(t, json.Valid(data))
}

func TestMergeAndWrite_DropsGhostEntries(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	// Create a plugin directory for "alive-plugin" only — "ghost-plugin" has no directory.
	pluginDir := t.TempDir()
	old := pluginDirOverride
	pluginDirOverride = pluginDir
	defer func() { pluginDirOverride = old }()

	require.NoError(t, os.MkdirAll(filepath.Join(pluginDir, "alive-plugin"), 0755))

	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*types.PluginRecord),
	}

	persisted := []types.PluginStateRecord{
		{ID: "ghost-plugin", Phase: lifecycle.PhaseRunning, Enabled: true},
		{ID: "alive-plugin", Phase: lifecycle.PhaseRunning, Enabled: true},
	}

	require.NoError(t, pm.mergeAndWritePluginState(persisted))

	records, err := readPluginStateJSON()
	require.NoError(t, err)
	require.Len(t, records, 1, "ghost entry should have been dropped")
	assert.Equal(t, "alive-plugin", records[0].ID)
}

func TestMergeAndWrite_PreservesNotLoadedWithDirectory(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	pluginDir := t.TempDir()
	old := pluginDirOverride
	pluginDirOverride = pluginDir
	defer func() { pluginDirOverride = old }()

	// Both plugins have directories on disk.
	require.NoError(t, os.MkdirAll(filepath.Join(pluginDir, "loaded-plugin"), 0755))
	require.NoError(t, os.MkdirAll(filepath.Join(pluginDir, "unloaded-plugin"), 0755))

	pm := &pluginManager{
		logger: testLogger(t),
		records: map[string]*types.PluginRecord{
			"loaded-plugin": {
				ID:       "loaded-plugin",
				Phase:    lifecycle.PhaseRunning,
				Metadata: config.PluginMeta{ID: "loaded-plugin"},
				Enabled:  true,
			},
		},
	}

	persisted := []types.PluginStateRecord{
		{ID: "loaded-plugin", Phase: lifecycle.PhaseRunning, Enabled: true},
		{ID: "unloaded-plugin", Phase: lifecycle.PhaseStopped, Enabled: false, DevMode: true, DevPath: "/some/path"},
	}

	require.NoError(t, pm.mergeAndWritePluginState(persisted))

	records, err := readPluginStateJSON()
	require.NoError(t, err)
	require.Len(t, records, 2, "not-loaded entry with directory should be preserved")

	byID := make(map[string]types.PluginStateRecord)
	for _, r := range records {
		byID[r.ID] = r
	}
	assert.True(t, byID["unloaded-plugin"].DevMode)
	assert.Equal(t, "/some/path", byID["unloaded-plugin"].DevPath)
}

func TestWriteJSON_MultipleRecords(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	pm := &pluginManager{
		logger: testLogger(t),
		records: map[string]*types.PluginRecord{
			"a": {ID: "a", Phase: lifecycle.PhaseRunning, Metadata: config.PluginMeta{ID: "a"}, Enabled: true},
			"b": {ID: "b", Phase: lifecycle.PhaseStopped, Metadata: config.PluginMeta{ID: "b"}, Enabled: false},
		},
	}

	require.NoError(t, pm.writePluginStateJSON())

	records, err := readPluginStateJSON()
	require.NoError(t, err)
	assert.Len(t, records, 2)

	byID := make(map[string]types.PluginStateRecord)
	for _, r := range records {
		byID[r.ID] = r
	}
	assert.True(t, byID["a"].Enabled)
	assert.False(t, byID["b"].Enabled)
	assert.Equal(t, lifecycle.PhaseStopped, byID["b"].Phase)
}
