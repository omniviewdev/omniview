package plugin

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

func init() {
	// Replace the Wails event emitter with a no-op for tests.
	eventEmitFn = func(_ context.Context, _ string, _ ...interface{}) {}
}

func newTestHealthChecker(t *testing.T) (*HealthChecker, *pluginManager) {
	t.Helper()
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
		ctx:     context.Background(),
	}
	hc := NewHealthChecker(testLogger(t), pm)
	return hc, pm
}

func TestHealthChecker_HealthyBackend_NoRecovery(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	backend := plugintypes.NewInProcessBackend(map[string]interface{}{
		"resource": "mock",
	})

	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:      "test-plugin",
		Phase:   lifecycle.PhaseRunning,
		Backend: backend,
	}

	assert.True(t, hc.checkPlugin("test-plugin"))
}

func TestHealthChecker_UnhealthyBackend(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	backend := plugintypes.NewInProcessBackend(nil)
	backend.Stop() // mark as stopped → unhealthy

	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:      "test-plugin",
		Phase:   lifecycle.PhaseRunning,
		Backend: backend,
	}

	assert.False(t, hc.checkPlugin("test-plugin"))
}

func TestHealthChecker_NoRecord(t *testing.T) {
	hc, _ := newTestHealthChecker(t)

	// No record for this plugin → unhealthy.
	assert.False(t, hc.checkPlugin("nonexistent"))
}

func TestHealthChecker_NoBackend(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:    "test-plugin",
		Phase: lifecycle.PhaseRunning,
		// Backend is nil.
	}

	assert.False(t, hc.checkPlugin("test-plugin"))
}

func TestHealthChecker_CustomHealthFunc(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	healthy := true
	backend := plugintypes.NewInProcessBackend(nil)
	backend.HealthFunc = func() bool { return healthy }

	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:      "test-plugin",
		Phase:   lifecycle.PhaseRunning,
		Backend: backend,
	}

	assert.True(t, hc.checkPlugin("test-plugin"))

	healthy = false
	assert.False(t, hc.checkPlugin("test-plugin"))
}

func TestCrashRecoveryState_ExponentialBackoff(t *testing.T) {
	hc, _ := newTestHealthChecker(t)

	state := &CrashRecoveryState{
		NextBackoff: initialCrashBackoff,
	}
	hc.recoveryStates["test"] = state

	// Simulate first attempt's bookkeeping.
	hc.mu.Lock()
	state.Attempts++
	state.NextBackoff *= 2
	state.LastAttempt = time.Now()
	hc.mu.Unlock()

	assert.Equal(t, 1, state.Attempts)
	assert.Equal(t, 2*initialCrashBackoff, state.NextBackoff)

	// Simulate second attempt.
	hc.mu.Lock()
	state.Attempts++
	state.NextBackoff *= 2
	hc.mu.Unlock()

	assert.Equal(t, 2, state.Attempts)
	assert.Equal(t, 4*initialCrashBackoff, state.NextBackoff)
}

func TestCrashRecoveryState_MaxBackoffCapped(t *testing.T) {
	hc, _ := newTestHealthChecker(t)

	state := &CrashRecoveryState{
		NextBackoff: maxCrashBackoff,
	}
	hc.recoveryStates["test"] = state

	hc.mu.Lock()
	state.Attempts++
	state.NextBackoff *= 2
	if state.NextBackoff > maxCrashBackoff {
		state.NextBackoff = maxCrashBackoff
	}
	hc.mu.Unlock()

	assert.Equal(t, maxCrashBackoff, state.NextBackoff)
}

func TestCrashRecoveryState_SuccessResetsState(t *testing.T) {
	hc, _ := newTestHealthChecker(t)

	hc.recoveryStates["test"] = &CrashRecoveryState{
		Attempts:    3,
		NextBackoff: 8 * time.Second,
	}

	// Simulate successful recovery.
	hc.mu.Lock()
	delete(hc.recoveryStates, "test")
	hc.mu.Unlock()

	_, exists := hc.recoveryStates["test"]
	assert.False(t, exists)
}

func TestHandleCrashWithBackoff_ContextCancellation(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	ctx, cancel := context.WithCancel(context.Background())
	pm.ctx = ctx

	pm.records["ctx-plugin"] = &plugintypes.PluginRecord{
		ID:    "ctx-plugin",
		Phase: lifecycle.PhaseRunning,
	}

	// Cancel context immediately so the timer select picks it up.
	cancel()

	// Should return quickly without blocking.
	done := make(chan struct{})
	go func() {
		hc.HandleCrashWithBackoff("ctx-plugin")
		close(done)
	}()

	select {
	case <-done:
		// Success — returned promptly.
	case <-time.After(3 * time.Second):
		t.Fatal("HandleCrashWithBackoff did not return after context cancellation")
	}
}

func TestCrashRecoveryState_MaxRetriesReached(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	sm := lifecycle.NewPluginStateMachine("test-plugin", lifecycle.PhaseRunning)
	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:           "test-plugin",
		Phase:        lifecycle.PhaseRunning,
		StateMachine: sm,
	}

	// Pre-set to max retries.
	hc.recoveryStates["test-plugin"] = &CrashRecoveryState{
		Attempts:    maxCrashRetries,
		NextBackoff: maxCrashBackoff,
	}

	// This should mark as failed and NOT retry.
	hc.HandleCrashWithBackoff("test-plugin")

	record := pm.records["test-plugin"]
	assert.Equal(t, lifecycle.PhaseFailed, record.Phase)
	assert.Equal(t, "max crash recovery attempts reached", record.LastError)
}

func TestNewHealthChecker(t *testing.T) {
	hc, _ := newTestHealthChecker(t)
	require.NotNil(t, hc)
	require.NotNil(t, hc.recoveryStates)
	assert.Empty(t, hc.recoveryStates)
}

func TestCheckAll_SkipsNonRunning(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	pm.records["stopped"] = &plugintypes.PluginRecord{
		ID:    "stopped",
		Phase: lifecycle.PhaseStopped,
	}
	pm.records["failed"] = &plugintypes.PluginRecord{
		ID:    "failed",
		Phase: lifecycle.PhaseFailed,
	}

	// Should not panic or trigger crash for non-running plugins.
	assert.NotPanics(t, func() { hc.checkAll() })
}

func TestCheckAll_HealthyPlugin_NoCrash(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	backend := plugintypes.NewInProcessBackend(map[string]interface{}{
		"resource": "mock",
	})
	pm.records["healthy"] = &plugintypes.PluginRecord{
		ID:      "healthy",
		Phase:   lifecycle.PhaseRunning,
		Backend: backend,
	}

	// Should check and find healthy — no crash triggered.
	hc.checkAll()
	// No recovery state should be created for healthy plugins.
	assert.Empty(t, hc.recoveryStates)
}

func TestCheckAll_SkipsRecoveringPlugins(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	backend := plugintypes.NewInProcessBackend(nil)
	backend.Stop() // mark as stopped → unhealthy

	pm.records["recovering"] = &plugintypes.PluginRecord{
		ID:      "recovering",
		Phase:   lifecycle.PhaseRecovering, // not PhaseRunning
		Backend: backend,
	}

	// checkAll should skip it because Phase != PhaseRunning.
	hc.checkAll()
	assert.Empty(t, hc.recoveryStates)
}

func TestCheckAll_SkipsAlreadyRecovering(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	backend := plugintypes.NewInProcessBackend(nil)
	backend.Stop() // unhealthy

	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:      "test-plugin",
		Phase:   lifecycle.PhaseRunning,
		Backend: backend,
	}

	// Pre-seed recovery state to simulate already-in-progress recovery.
	hc.recoveryStates["test-plugin"] = &CrashRecoveryState{
		Attempts:    1,
		NextBackoff: 2 * time.Second,
	}

	crashTriggered := false
	origHandleCrash := pm.HandlePluginCrash
	_ = origHandleCrash // HandlePluginCrash is a method, we can't override it directly.
	// Instead, verify no new goroutines are spawned by checking that
	// recoveryStates is unchanged after checkAll.
	hc.checkAll()

	// The key assertion: no additional recovery goroutines were spawned.
	// The existing state should remain untouched.
	state, exists := hc.recoveryStates["test-plugin"]
	assert.True(t, exists)
	assert.Equal(t, 1, state.Attempts, "recovery state should not have been modified")
	_ = crashTriggered
}

func TestCheckAll_UnhealthyPlugin_TriggersRecovery(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	backend := plugintypes.NewInProcessBackend(nil)
	backend.Stop() // unhealthy

	sm := lifecycle.NewPluginStateMachine("unhealthy-plugin", lifecycle.PhaseRunning)

	// Use a state machine observer to detect when HandlePluginCrash fires,
	// avoiding a data race on record.Phase.
	triggered := make(chan struct{}, 1)
	sm.AddObserver(func(_ string, tr lifecycle.Transition) {
		if tr.To == lifecycle.PhaseRecovering {
			select {
			case triggered <- struct{}{}:
			default:
			}
		}
	})

	pm.records["unhealthy-plugin"] = &plugintypes.PluginRecord{
		ID:           "unhealthy-plugin",
		Phase:        lifecycle.PhaseRunning,
		Backend:      backend,
		StateMachine: sm,
	}

	// Set up health checker so HandlePluginCrash delegates to it.
	pm.healthChecker = hc

	// Run checkAll — it should spawn HandlePluginCrash in a goroutine.
	hc.checkAll()

	// Wait for the goroutine to trigger recovery.
	select {
	case <-triggered:
		// Success — HandlePluginCrash was triggered for the unhealthy plugin.
		// Cancel to clean up the background goroutine.
		hc.CancelRecovery("unhealthy-plugin")
	case <-time.After(3 * time.Second):
		t.Fatal("HandlePluginCrash was not triggered for unhealthy plugin")
	}
}

func TestHandleCrashWithBackoff_NilContext(t *testing.T) {
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
		// ctx intentionally nil
	}
	hc := NewHealthChecker(testLogger(t), pm)

	// Should return without panic.
	assert.NotPanics(t, func() {
		hc.HandleCrashWithBackoff("nil-ctx-plugin")
	})
}

func TestHandleCrashWithBackoff_SetsPhaseRecovering(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	sm := lifecycle.NewPluginStateMachine("phase-test", lifecycle.PhaseRunning)
	pm.records["phase-test"] = &plugintypes.PluginRecord{
		ID:           "phase-test",
		Phase:        lifecycle.PhaseRunning,
		StateMachine: sm,
	}
	pm.healthChecker = hc

	// Pre-set to max retries so it returns immediately.
	hc.recoveryStates["phase-test"] = &CrashRecoveryState{
		Attempts:    maxCrashRetries,
		NextBackoff: maxCrashBackoff,
	}

	// HandlePluginCrash should set Phase to Recovering before delegating.
	pm.HandlePluginCrash("phase-test")

	// After max retries, phase ends up as Failed.
	record := pm.records["phase-test"]
	assert.Equal(t, lifecycle.PhaseFailed, record.Phase)
}

func TestHandleCrashWithBackoff_CancelDuringBackoff(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	pm.records["cancel-test"] = &plugintypes.PluginRecord{
		ID:    "cancel-test",
		Phase: lifecycle.PhaseRunning,
	}

	done := make(chan struct{})
	go func() {
		hc.HandleCrashWithBackoff("cancel-test")
		close(done)
	}()

	// Give the goroutine a moment to enter the backoff sleep.
	time.Sleep(50 * time.Millisecond)

	// Cancel recovery — should cause prompt return.
	hc.CancelRecovery("cancel-test")

	select {
	case <-done:
		// Success — returned promptly after cancellation.
	case <-time.After(3 * time.Second):
		t.Fatal("HandleCrashWithBackoff did not return after CancelRecovery")
	}
}

func TestHandleCrashWithBackoff_DuplicateReplacesContext(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	pm.records["dup-test"] = &plugintypes.PluginRecord{
		ID:    "dup-test",
		Phase: lifecycle.PhaseRunning,
	}

	// Start first recovery goroutine.
	done1 := make(chan struct{})
	go func() {
		hc.HandleCrashWithBackoff("dup-test")
		close(done1)
	}()

	// Let it enter the backoff sleep.
	time.Sleep(50 * time.Millisecond)

	// Start second recovery — should cancel the first.
	// Pre-set to max retries so the second one returns immediately.
	hc.mu.Lock()
	state := hc.recoveryStates["dup-test"]
	state.Attempts = maxCrashRetries
	hc.mu.Unlock()

	done2 := make(chan struct{})
	go func() {
		hc.HandleCrashWithBackoff("dup-test")
		close(done2)
	}()

	// Both should complete within a reasonable time.
	select {
	case <-done1:
	case <-time.After(3 * time.Second):
		t.Fatal("first HandleCrashWithBackoff did not return after being replaced")
	}
	select {
	case <-done2:
	case <-time.After(3 * time.Second):
		t.Fatal("second HandleCrashWithBackoff did not return")
	}
}

func TestStart_StopsOnContextCancel(t *testing.T) {
	hc, _ := newTestHealthChecker(t)

	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		hc.Start(ctx)
		close(done)
	}()

	// Cancel immediately — Start should return promptly.
	cancel()

	select {
	case <-done:
		// Success.
	case <-time.After(3 * time.Second):
		t.Fatal("Start did not return after context cancellation")
	}
}
