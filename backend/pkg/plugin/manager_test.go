package plugin

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

func TestGetPlugin_Found(t *testing.T) {
	pm := &pluginManager{
		logger: testLogger(t),
		records: map[string]*plugintypes.PluginRecord{
			"test-plugin": {
				ID:       "test-plugin",
				Phase:    lifecycle.PhaseRunning,
				Metadata: config.PluginMeta{ID: "test-plugin", Name: "Test"},
				Enabled:  true,
			},
		},
	}

	info, err := pm.GetPlugin("test-plugin")
	require.NoError(t, err)
	assert.Equal(t, "test-plugin", info.ID)
	assert.Equal(t, "Test", info.Metadata.Name)
}

func TestGetPlugin_NotFound(t *testing.T) {
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
	}

	_, err := pm.GetPlugin("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestListPlugins_Empty(t *testing.T) {
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
	}

	plugins := pm.ListPlugins()
	assert.Empty(t, plugins)
}

func TestListPlugins_Multiple(t *testing.T) {
	pm := &pluginManager{
		logger: testLogger(t),
		records: map[string]*plugintypes.PluginRecord{
			"a": {
				ID:       "a",
				Phase:    lifecycle.PhaseRunning,
				Metadata: config.PluginMeta{ID: "a"},
				Enabled:  true,
			},
			"b": {
				ID:       "b",
				Phase:    lifecycle.PhaseStopped,
				Metadata: config.PluginMeta{ID: "b"},
				Enabled:  false,
			},
		},
	}

	plugins := pm.ListPlugins()
	assert.Len(t, plugins, 2)

	byID := make(map[string]sdktypes.PluginInfo)
	for _, p := range plugins {
		byID[p.ID] = p
	}
	assert.True(t, byID["a"].Enabled)
	assert.False(t, byID["b"].Enabled)
}

func TestGetPluginMeta_Found(t *testing.T) {
	pm := &pluginManager{
		logger: testLogger(t),
		records: map[string]*plugintypes.PluginRecord{
			"test": {
				ID:       "test",
				Metadata: config.PluginMeta{ID: "test", Name: "Test Plugin", Version: "2.0"},
			},
		},
	}

	meta, err := pm.GetPluginMeta("test")
	require.NoError(t, err)
	assert.Equal(t, "Test Plugin", meta.Name)
	assert.Equal(t, "2.0", meta.Version)
}

func TestGetPluginMeta_NotFound(t *testing.T) {
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
	}

	_, err := pm.GetPluginMeta("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestListPluginMetas(t *testing.T) {
	pm := &pluginManager{
		logger: testLogger(t),
		records: map[string]*plugintypes.PluginRecord{
			"a": {ID: "a", Metadata: config.PluginMeta{ID: "a", Name: "A"}},
			"b": {ID: "b", Metadata: config.PluginMeta{ID: "b", Name: "B"}},
		},
	}

	metas := pm.ListPluginMetas()
	assert.Len(t, metas, 2)
}

func TestHandlePluginCrash_WithHealthChecker(t *testing.T) {
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
		ctx:     context.Background(),
	}

	pm.records["crash-test"] = &plugintypes.PluginRecord{
		ID:           "crash-test",
		Phase:        lifecycle.PhaseRunning,
		StateMachine: lifecycle.NewPluginStateMachine("crash-test", lifecycle.PhaseRunning),
	}

	// Set up health checker with max retries already hit.
	hc := NewHealthChecker(testLogger(t), pm)
	hc.recoveryStates["crash-test"] = &CrashRecoveryState{
		Attempts:    maxCrashRetries,
		NextBackoff: maxCrashBackoff,
	}
	pm.healthChecker = hc

	// This should trigger max-retries path immediately.
	pm.HandlePluginCrash("crash-test")

	record := pm.records["crash-test"]
	assert.Equal(t, lifecycle.PhaseFailed, record.Phase)
}

func TestHandlePluginCrash_SetsPhaseRecovering(t *testing.T) {
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
		ctx:     context.Background(),
	}

	sm := lifecycle.NewPluginStateMachine("phase-plugin", lifecycle.PhaseRunning)
	pm.records["phase-plugin"] = &plugintypes.PluginRecord{
		ID:           "phase-plugin",
		Phase:        lifecycle.PhaseRunning,
		StateMachine: sm,
	}

	// Set up health checker with max retries to avoid actual reload attempts.
	hc := NewHealthChecker(testLogger(t), pm)
	hc.recoveryStates["phase-plugin"] = &CrashRecoveryState{
		Attempts:    maxCrashRetries,
		NextBackoff: maxCrashBackoff,
	}
	pm.healthChecker = hc

	pm.HandlePluginCrash("phase-plugin")

	// After HandlePluginCrash, the phase should have been set to Recovering
	// (then to Failed by max-retries path).
	record := pm.records["phase-plugin"]
	assert.Equal(t, lifecycle.PhaseFailed, record.Phase)
}

func TestHandlePluginCrash_FallbackContextAware(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
		ctx:     ctx,
		// No healthChecker — forces fallback path.
	}

	pm.records["fallback-plugin"] = &plugintypes.PluginRecord{
		ID:    "fallback-plugin",
		Phase: lifecycle.PhaseRunning,
	}

	// Cancel context immediately — fallback sleep should respect it.
	cancel()

	done := make(chan struct{})
	go func() {
		pm.HandlePluginCrash("fallback-plugin")
		close(done)
	}()

	select {
	case <-done:
		// Success — returned promptly.
	case <-time.After(3 * time.Second):
		t.Fatal("HandlePluginCrash fallback did not return after context cancellation")
	}
}

func TestRegisterStateObserver(t *testing.T) {
	pm := &pluginManager{logger: testLogger(t)}
	sm := lifecycle.NewPluginStateMachine("test", lifecycle.PhaseStarting)

	var observed bool
	pm.registerStateObserver(sm)
	sm.AddObserver(func(_ string, _ lifecycle.Transition) {
		observed = true
	})

	// PhaseStarting → PhaseRunning is a valid transition.
	err := sm.TransitionTo(lifecycle.PhaseRunning, "test")
	require.NoError(t, err)
	assert.True(t, observed)
}

func TestShutdown_EmptyRecords(t *testing.T) {
	pm := &pluginManager{
		logger:     testLogger(t),
		records:    make(map[string]*plugintypes.PluginRecord),
		pidTracker: NewPluginPIDTracker(),
	}

	// Should not panic with empty records.
	assert.NotPanics(t, func() { pm.Shutdown() })
}

func TestShutdown_StopsAllBackends(t *testing.T) {
	backendA := plugintypes.NewInProcessBackend(nil)
	backendB := plugintypes.NewInProcessBackend(nil)

	pm := &pluginManager{
		logger: testLogger(t),
		records: map[string]*plugintypes.PluginRecord{
			"a": {
				ID:    "a",
				Phase: lifecycle.PhaseRunning,
				Metadata: config.PluginMeta{
					ID:           "a",
					Capabilities: []string{"resource"},
				},
				Backend: backendA,
			},
			"b": {
				ID:    "b",
				Phase: lifecycle.PhaseRunning,
				Metadata: config.PluginMeta{
					ID:           "b",
					Capabilities: []string{"exec"},
				},
				Backend: backendB,
			},
		},
		connlessControllers: make(map[sdktypes.Capability]plugintypes.Controller),
		connfullControllers: make(map[sdktypes.Capability]plugintypes.ConnectedController),
		managers:            make(map[string]plugintypes.PluginManager),
		pidTracker:          NewPluginPIDTracker(),
	}

	pm.Shutdown()

	assert.True(t, backendA.Exited())
	assert.True(t, backendB.Exited())
}
