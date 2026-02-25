package plugin

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// newTestManager creates a pluginManager suitable for unit tests with
// a backendFactory seam and a temp plugin directory.
func newTestManager(t *testing.T) *pluginManager {
	t.Helper()
	dir := t.TempDir()
	old := pluginDirOverride
	pluginDirOverride = dir
	t.Cleanup(func() { pluginDirOverride = old })

	return &pluginManager{
		logger:              testLogger(t),
		records:             make(map[string]*plugintypes.PluginRecord),
		connlessControllers: make(map[sdktypes.Capability]plugintypes.Controller),
		connfullControllers: make(map[sdktypes.Capability]plugintypes.ConnectedController),
		managers:            make(map[string]plugintypes.PluginManager),
		pidTracker:          NewPluginPIDTracker(),
	}
}

// installPluginFixture creates a plugin directory with plugin.yaml and optional binary.
func installPluginFixture(t *testing.T, id string, caps []string, withBinary bool) {
	t.Helper()
	dir := filepath.Join(getPluginDir(), id)
	require.NoError(t, os.MkdirAll(dir, 0755))

	content := "id: " + id + "\nname: " + id + "\nversion: 1.0.0\n"
	if len(caps) > 0 {
		content += "capabilities:\n"
		for _, c := range caps {
			content += "  - " + c + "\n"
		}
	}
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(content), 0644))

	if withBinary {
		binDir := filepath.Join(dir, "bin")
		require.NoError(t, os.MkdirAll(binDir, 0755))
		require.NoError(t, os.WriteFile(filepath.Join(binDir, "plugin"), []byte("#!/bin/sh\n"), 0755))
	}
}

func TestLoadPlugin_NotFound(t *testing.T) {
	pm := newTestManager(t)

	_, err := pm.LoadPlugin("nonexistent", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestLoadPlugin_MetadataMissing(t *testing.T) {
	pm := newTestManager(t)
	dir := filepath.Join(getPluginDir(), "no-meta")
	require.NoError(t, os.MkdirAll(dir, 0755))

	_, err := pm.LoadPlugin("no-meta", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "metadata")
}

func TestLoadPlugin_AlreadyRunning_Idempotent(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, "running-plugin", []string{"ui"}, false)

	// Pre-populate a running record.
	pm.records["running-plugin"] = &plugintypes.PluginRecord{
		ID:    "running-plugin",
		Phase: lifecycle.PhaseRunning,
		Metadata: config.PluginMeta{
			ID:      "running-plugin",
			Name:    "running-plugin",
			Version: "1.0.0",
		},
		Enabled: true,
	}

	info, err := pm.LoadPlugin("running-plugin", nil)
	require.NoError(t, err)
	assert.Equal(t, "running-plugin", info.ID)
}

func TestLoadPlugin_AlreadyStarting_Returns409(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, "starting-plugin", []string{"ui"}, false)

	pm.records["starting-plugin"] = &plugintypes.PluginRecord{
		ID:    "starting-plugin",
		Phase: lifecycle.PhaseStarting,
	}

	_, err := pm.LoadPlugin("starting-plugin", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "starting")
}

func TestLoadPlugin_UIOnly_Succeeds(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, "ui-plugin", []string{"ui"}, false)

	// UI plugins need assets directory.
	require.NoError(t, os.MkdirAll(filepath.Join(getPluginDir(), "ui-plugin", "assets"), 0755))

	info, err := pm.LoadPlugin("ui-plugin", nil)
	require.NoError(t, err)
	assert.Equal(t, "ui-plugin", info.ID)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	assert.True(t, info.Enabled)
}

func TestLoadPlugin_BackendPlugin_ViaFactory(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, "backend-plugin", []string{"resource"}, true)

	factoryCalled := false
	pm.backendFactory = func(meta config.PluginMeta, location string) (plugintypes.PluginBackend, error) {
		factoryCalled = true
		return plugintypes.NewInProcessBackend(map[string]interface{}{
			"resource": "mock",
		}), nil
	}

	info, err := pm.LoadPlugin("backend-plugin", nil)
	require.NoError(t, err)
	assert.True(t, factoryCalled)
	assert.Equal(t, "backend-plugin", info.ID)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
}

func TestLoadPlugin_NoBinary_FailsValidation(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, "no-binary", []string{"resource"}, false)

	_, err := pm.LoadPlugin("no-binary", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "validation")
}

func TestLoadPlugin_DevMode_SkipsUIValidation(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, "dev-plugin", []string{"resource", "ui"}, true)

	pm.backendFactory = func(meta config.PluginMeta, location string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(nil), nil
	}

	// Dev mode only validates binary, not UI assets.
	info, err := pm.LoadPlugin("dev-plugin", &LoadPluginOptions{
		DevMode:     true,
		DevModePath: "/dev/src",
	})
	require.NoError(t, err)
	assert.True(t, info.DevMode)
	assert.Equal(t, "/dev/src", info.DevPath)
}

func TestReloadPlugin_NotLoaded_Error(t *testing.T) {
	pm := newTestManager(t)

	_, err := pm.ReloadPlugin("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not currently loaded")
}

func TestUnloadPlugin_NotLoaded_Idempotent(t *testing.T) {
	pm := newTestManager(t)

	err := pm.UnloadPlugin("nonexistent")
	assert.NoError(t, err)
}

func TestUnloadPlugin_Running_Stops(t *testing.T) {
	pm := newTestManager(t)

	backend := plugintypes.NewInProcessBackend(nil)
	pm.records["test"] = &plugintypes.PluginRecord{
		ID:       "test",
		Phase:    lifecycle.PhaseRunning,
		Metadata: config.PluginMeta{ID: "test"},
		Backend:  backend,
	}

	err := pm.UnloadPlugin("test")
	assert.NoError(t, err)
	assert.NotContains(t, pm.records, "test")
}

func TestLoadPlugin_ExistingState_Applied(t *testing.T) {
	pm := newTestManager(t)
	// Dev mode with backend caps requires a binary.
	installPluginFixture(t, "state-plugin", []string{"resource"}, true)

	pm.backendFactory = func(meta config.PluginMeta, location string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(nil), nil
	}

	info, err := pm.LoadPlugin("state-plugin", &LoadPluginOptions{
		ExistingState: &plugintypes.PluginStateRecord{
			ID:      "state-plugin",
			Enabled: true,
			DevMode: true,
			DevPath: "/existing/path",
		},
	})
	require.NoError(t, err)
	assert.True(t, info.DevMode)
	assert.Equal(t, "/existing/path", info.DevPath)
}

func TestLoadPlugin_PreviousFailedRecord_Removed(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, "failed-plugin", []string{"ui"}, false)
	require.NoError(t, os.MkdirAll(filepath.Join(getPluginDir(), "failed-plugin", "assets"), 0755))

	// Pre-populate a failed record.
	pm.records["failed-plugin"] = &plugintypes.PluginRecord{
		ID:    "failed-plugin",
		Phase: lifecycle.PhaseFailed,
	}

	info, err := pm.LoadPlugin("failed-plugin", nil)
	require.NoError(t, err)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
}

func TestReloadPlugin_ReloadsSuccessfully(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, "reload-test", []string{"ui"}, false)
	require.NoError(t, os.MkdirAll(filepath.Join(getPluginDir(), "reload-test", "assets"), 0755))

	// First load.
	_, err := pm.LoadPlugin("reload-test", nil)
	require.NoError(t, err)

	// Reload.
	info, err := pm.ReloadPlugin("reload-test")
	require.NoError(t, err)
	assert.Equal(t, "reload-test", info.ID)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
}

func TestCreateBackend_UsesFactory(t *testing.T) {
	pm := newTestManager(t)

	called := false
	pm.backendFactory = func(meta config.PluginMeta, location string) (plugintypes.PluginBackend, error) {
		called = true
		assert.Equal(t, "test-meta", meta.ID)
		assert.Equal(t, "/some/location", location)
		return plugintypes.NewInProcessBackend(nil), nil
	}

	backend, err := pm.createBackend("test", config.PluginMeta{ID: "test-meta"}, "/some/location")
	require.NoError(t, err)
	assert.True(t, called)
	assert.NotNil(t, backend)
}

func TestInitPlugin_NilRecord(t *testing.T) {
	pm := newTestManager(t)

	err := pm.initPlugin(nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "nil")
}

func TestStartPlugin_NilRecord(t *testing.T) {
	pm := newTestManager(t)

	err := pm.startPlugin(nil, nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "nil")
}

func TestStopPlugin_NilRecord(t *testing.T) {
	pm := newTestManager(t)

	err := pm.stopPlugin(nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "nil")
}

func TestShutdownPlugin_NilRecord(t *testing.T) {
	pm := newTestManager(t)

	err := pm.shutdownPlugin("test", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "nil")
}

// ---------------------------------------------------------------------------
// Dev plugin state persistence tests
// ---------------------------------------------------------------------------

func TestDevInstall_StatePersistsDevModeFields(t *testing.T) {
	pm := newTestManager(t)
	cleanup := withTempStateFile(t)
	defer cleanup()

	installPluginFixture(t, "dev-persist", []string{"resource", "ui"}, true)

	pm.backendFactory = func(meta config.PluginMeta, location string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(nil), nil
	}

	// Simulate what InstallInDevMode does: load with dev mode opts.
	_, err := pm.LoadPlugin("dev-persist", &LoadPluginOptions{
		DevMode:     true,
		DevModePath: "/dev/src",
	})
	require.NoError(t, err)

	// Write state (InstallInDevMode calls this after LoadPlugin).
	require.NoError(t, pm.writePluginStateJSON())

	// Read it back and verify dev fields survived serialization.
	records, err := readPluginStateJSON()
	require.NoError(t, err)
	require.Len(t, records, 1)

	r := records[0]
	assert.Equal(t, "dev-persist", r.ID)
	assert.True(t, r.DevMode, "DevMode should be persisted as true")
	assert.Equal(t, "/dev/src", r.DevPath, "DevPath should be persisted")
	assert.True(t, r.Enabled, "Enabled should be true")
}

func TestDevPlugin_SurvivesRestart(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	// --- Session 1: install a dev plugin and persist state ---
	pm1 := newTestManager(t)
	installPluginFixture(t, "dev-restart", []string{"resource", "ui"}, true)

	pm1.backendFactory = func(meta config.PluginMeta, location string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(nil), nil
	}

	_, err := pm1.LoadPlugin("dev-restart", &LoadPluginOptions{
		DevMode:     true,
		DevModePath: "/dev/restart/src",
	})
	require.NoError(t, err)
	require.NoError(t, pm1.writePluginStateJSON())

	// --- Session 2: simulate restart with a new manager ---
	pm2 := &pluginManager{
		logger:              testLogger(t),
		records:             make(map[string]*plugintypes.PluginRecord),
		connlessControllers: make(map[sdktypes.Capability]plugintypes.Controller),
		connfullControllers: make(map[sdktypes.Capability]plugintypes.ConnectedController),
		managers:            make(map[string]plugintypes.PluginManager),
		pidTracker:          NewPluginPIDTracker(),
	}
	// Use the same plugin dir as pm1.
	pm2.backendFactory = func(meta config.PluginMeta, location string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(nil), nil
	}

	// Replay what Initialize does: read state, build lookup, load with ExistingState.
	states, err := readPluginStateJSON()
	require.NoError(t, err)
	require.Len(t, states, 1)

	stateByID := make(map[string]plugintypes.PluginStateRecord)
	for _, s := range states {
		stateByID[s.ID] = s
	}

	state, ok := stateByID["dev-restart"]
	require.True(t, ok, "dev-restart should be in persisted state")
	assert.True(t, state.DevMode)
	assert.Equal(t, "/dev/restart/src", state.DevPath)

	info, err := pm2.LoadPlugin("dev-restart", &LoadPluginOptions{
		ExistingState: &state,
	})
	require.NoError(t, err)
	assert.True(t, info.DevMode, "DevMode should survive restart")
	assert.Equal(t, "/dev/restart/src", info.DevPath, "DevPath should survive restart")
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
}

func TestInitialize_DoesNotLoseFailedPluginState(t *testing.T) {
	cleanup := withTempStateFile(t)
	defer cleanup()

	pm := newTestManager(t)
	pm.ctx = context.Background()

	// Persisted state: a dev plugin that was previously running.
	persistedStates := []plugintypes.PluginStateRecord{
		{
			ID:      "dev-lost",
			Phase:   lifecycle.PhaseRunning,
			Enabled: true,
			DevMode: true,
			DevPath: "/dev/lost/src",
		},
	}

	// Create the plugin directory with metadata but NO binary.
	// This causes LoadPlugin to fail validation for dev mode.
	installPluginFixture(t, "dev-lost", []string{"resource", "ui"}, false)

	// Replay what Initialize does: read state, build lookup, attempt load.
	stateByID := make(map[string]plugintypes.PluginStateRecord)
	for _, s := range persistedStates {
		stateByID[s.ID] = s
	}

	state := stateByID["dev-lost"]
	_, err := pm.LoadPlugin("dev-lost", &LoadPluginOptions{ExistingState: &state})
	assert.Error(t, err, "LoadPlugin should fail (missing binary)")

	// Now call mergeAndWritePluginState — this is what Initialize does.
	// It should preserve the failed plugin's state.
	require.NoError(t, pm.mergeAndWritePluginState(persistedStates))

	// Read state file after merge.
	records, err := readPluginStateJSON()
	require.NoError(t, err)

	// The dev-lost plugin failed to load, but its state should still be preserved.
	found := false
	for _, r := range records {
		if r.ID == "dev-lost" {
			found = true
			assert.True(t, r.DevMode, "DevMode should be preserved for failed plugin")
			assert.Equal(t, "/dev/lost/src", r.DevPath, "DevPath should be preserved for failed plugin")
			break
		}
	}
	assert.True(t, found, "Failed plugin state should still be in the state file")
}

func TestCapStringsToCapabilities_TableDriven(t *testing.T) {
	tests := []struct {
		name     string
		input    []string
		expected []sdktypes.Capability
	}{
		{
			name:     "known capabilities",
			input:    []string{"resource", "exec", "log"},
			expected: []sdktypes.Capability{sdktypes.CapabilityResource, sdktypes.CapabilityExec, sdktypes.CapabilityLog},
		},
		{
			name:     "settings filtered out",
			input:    []string{"resource", "settings"},
			expected: []sdktypes.Capability{sdktypes.CapabilityResource},
		},
		{
			name:     "unknown ignored",
			input:    []string{"resource", "unknown_cap"},
			expected: []sdktypes.Capability{sdktypes.CapabilityResource},
		},
		{
			name:     "empty input",
			input:    []string{},
			expected: nil,
		},
		{
			name:     "all known",
			input:    []string{"resource", "exec", "networker", "log", "metric", "ui"},
			expected: []sdktypes.Capability{sdktypes.CapabilityResource, sdktypes.CapabilityExec, sdktypes.CapabilityNetworker, sdktypes.CapabilityLog, sdktypes.CapabilityMetric, sdktypes.CapabilityUI},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := capStringsToCapabilities(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}
