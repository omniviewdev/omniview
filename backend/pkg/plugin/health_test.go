package plugin

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// testNoopEmitter is a no-op EventEmitter for tests.
type testNoopEmitter struct{}

func (testNoopEmitter) Emit(string, ...any) {}

type healthManagedServers struct {
	transactionDevServers
	observations int
}

func (*healthManagedServers) LifecycleGeneration(string, string) string { return "generation" }
func (*healthManagedServers) RuntimeGeneration(string, string) string   { return "generation" }
func (s *healthManagedServers) NotifyPluginLifecycle(string, string, string, bool, bool, error) bool {
	s.observations++
	return true
}

type healthDispenseBackend struct {
	plugintypes.PluginBackend
	dispense func()
}

func (b *healthDispenseBackend) Dispense(string) (interface{}, error) {
	b.dispense()
	return nil, errors.New("unavailable")
}

func newTestHealthChecker(t *testing.T) (*HealthChecker, *pluginManager) {
	t.Helper()
	// Recovery can register after the state observer fires. Tie it to the test.
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
		ctx:     t.Context(),
		emitter: testNoopEmitter{},
	}
	hc := NewHealthChecker(testLogger(t), pm)
	return hc, pm
}

func TestHealthChecker_HealthyBackend_NoRecovery(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
		Providers: map[string]interface{}{"resource": "mock"},
	})

	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:      "test-plugin",
		Phase:   lifecycle.PhaseRunning,
		Backend: backend,
	}

	assert.True(t, hc.checkPlugin("test-plugin", "", pm.records["test-plugin"], backend))
}

func TestHealthChecker_UnhealthyBackend(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	_ = backend.Stop() // mark as stopped → unhealthy

	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:      "test-plugin",
		Phase:   lifecycle.PhaseRunning,
		Backend: backend,
	}

	assert.False(t, hc.checkPlugin("test-plugin", "", pm.records["test-plugin"], backend))
}

func TestHealthChecker_NoRecord(t *testing.T) {
	hc, _ := newTestHealthChecker(t)

	// No record for this plugin → unhealthy.
	assert.False(t, hc.checkPlugin("nonexistent", "", nil, nil))
}

func TestHealthChecker_NoBackend(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:    "test-plugin",
		Phase: lifecycle.PhaseRunning,
		// Backend is nil.
	}

	assert.False(t, hc.checkPlugin("test-plugin", "", pm.records["test-plugin"], nil))
}

func TestHealthChecker_CustomHealthFunc(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	healthy := true
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
		HealthCheck: func() bool { return healthy },
	})

	pm.records["test-plugin"] = &plugintypes.PluginRecord{
		ID:      "test-plugin",
		Phase:   lifecycle.PhaseRunning,
		Backend: backend,
	}

	assert.True(t, hc.checkPlugin("test-plugin", "", pm.records["test-plugin"], backend))

	healthy = false
	assert.False(t, hc.checkPlugin("test-plugin", "", pm.records["test-plugin"], backend))
}

func TestHealthChecker_ManagedFailureFencedByProbePair(t *testing.T) {
	for _, replace := range []bool{false, true} {
		t.Run(fmt.Sprintf("replace=%t", replace), func(t *testing.T) {
			hc, pm := newTestHealthChecker(t)
			servers := &healthManagedServers{}
			pm.devServerMgr = servers
			backend := &healthDispenseBackend{
				PluginBackend: plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{}),
				dispense: func() {
					if replace {
						pm.recordsMu.Lock()
						pm.records["plugin"] = &plugintypes.PluginRecord{
							ID: "plugin", Phase: lifecycle.PhaseRunning,
							Backend: plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{}),
						}
						pm.recordsMu.Unlock()
					}
				},
			}
			record := &plugintypes.PluginRecord{
				ID: "plugin", Phase: lifecycle.PhaseRunning, DevPath: "source", Backend: backend,
			}
			pm.records["plugin"] = record

			require.False(t, hc.checkPlugin("plugin", "source", record, backend))
			if replace {
				require.Zero(t, servers.observations)
			} else {
				require.Equal(t, 1, servers.observations)
			}
		})
	}
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

	rec := &testRecordingEmitter{}
	pm.emitter = rec

	// This should mark as failed and NOT retry.
	hc.HandleCrashWithBackoff("test-plugin")

	record := pm.records["test-plugin"]
	assert.Equal(t, lifecycle.PhaseFailed, record.Phase)
	assert.Equal(t, "max crash recovery attempts reached", record.LastError)

	// The payload must be the type registered for the event, or Wails drops it.
	events := rec.getEvents()
	require.Len(t, events, 1)
	assert.Equal(t, EventCrashRecoveryFailed, events[0].event)
	require.Len(t, events[0].data, 1)
	assert.Equal(t, PluginErrorPayload{
		PluginID: "test-plugin",
		Error:    "max crash recovery attempts reached",
	}, events[0].data[0])
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

	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
		Providers: map[string]interface{}{"resource": "mock"},
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

func TestCheckAll_ProbesCollectedBackendAcrossReplacement(t *testing.T) {
	for _, staleHealthy := range []bool{true, false} {
		for _, replaceRecord := range []bool{true, false} {
			t.Run(fmt.Sprintf("staleHealthy=%t/replaceRecord=%t", staleHealthy, replaceRecord), func(t *testing.T) {
				hc, pm := newTestHealthChecker(t)
				pm.healthChecker = hc
				triggered := make(chan struct{}, 1)
				var target string
				var unlock func()
				oldProbes, replacementProbes := 0, 0

				for _, id := range []string{"one", "two"} {
					id := id
					backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
						HealthCheck: func() bool {
							oldProbes++
							if target != "" {
								return id != target || staleHealthy
							}
							target = "one"
							if id == target {
								target = "two"
							}
							lock := pm.pluginOpsLock(target)
							lock.Lock()
							unlock = lock.Unlock
							sm := lifecycle.NewPluginStateMachine(target, lifecycle.PhaseRunning)
							sm.AddObserver(func(_ string, tr lifecycle.Transition) {
								if tr.To == lifecycle.PhaseRecovering {
									select {
									case triggered <- struct{}{}:
									default:
									}
								}
							})
							replacement := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
								HealthCheck: func() bool {
									replacementProbes++
									return false
								},
							})
							pm.recordsMu.Lock()
							if replaceRecord {
								pm.records[target] = &plugintypes.PluginRecord{
									ID: target, Phase: lifecycle.PhaseRunning,
									Backend: replacement, StateMachine: sm,
								}
							} else {
								pm.records[target].Backend = replacement
								pm.records[target].StateMachine = sm
							}
							pm.recordsMu.Unlock()
							return true
						},
					})
					pm.records[id] = &plugintypes.PluginRecord{
						ID: id, Phase: lifecycle.PhaseRunning, Backend: backend,
					}
				}
				defer func() {
					if unlock != nil {
						unlock()
					}
				}()

				hc.checkAll()
				require.NotEmpty(t, target)
				require.Equal(t, 1, oldProbes)
				require.Equal(t, 1, replacementProbes)
				unlock()
				unlock = nil

				select {
				case <-triggered:
				case <-time.After(3 * time.Second):
					t.Fatal("unhealthy replacement did not enter recovery")
				}
			})
		}
	}
}

func TestCheckAll_StaleProbeDoesNotAffectReplacement(t *testing.T) {
	for _, staleHealthy := range []bool{true, false} {
		for _, replaceRecord := range []bool{true, false} {
			t.Run(fmt.Sprintf("staleHealthy=%t/replaceRecord=%t", staleHealthy, replaceRecord), func(t *testing.T) {
				hc, pm := newTestHealthChecker(t)
				pm.healthChecker = hc
				triggered := make(chan struct{}, 1)
				sm := lifecycle.NewPluginStateMachine("plugin", lifecycle.PhaseRunning)
				sm.AddObserver(func(_ string, tr lifecycle.Transition) {
					if tr.To == lifecycle.PhaseRecovering {
						select {
						case triggered <- struct{}{}:
						default:
						}
					}
				})
				replacement := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
					HealthCheck: func() bool { return false },
				})
				var old *plugintypes.PluginRecord
				backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{
					HealthCheck: func() bool {
						pm.recordsMu.Lock()
						if replaceRecord {
							pm.records["plugin"] = &plugintypes.PluginRecord{
								ID: "plugin", Phase: lifecycle.PhaseRunning,
								Backend: replacement, StateMachine: sm,
							}
						} else {
							old.Backend = replacement
							old.StateMachine = sm
						}
						pm.recordsMu.Unlock()
						return staleHealthy
					},
				})
				old = &plugintypes.PluginRecord{ID: "plugin", Phase: lifecycle.PhaseRunning, Backend: backend}
				pm.records["plugin"] = old

				hc.checkAll()
				// Complete the stale-result path synchronously as well, so the
				// assertion does not depend on scheduling the spawned goroutine.
				pm.handleProbedCrash("plugin", old, backend)
				select {
				case <-triggered:
					t.Fatal("stale probe affected replacement")
				default:
				}
				hc.checkAll()
				select {
				case <-triggered:
				case <-time.After(3 * time.Second):
					t.Fatal("unhealthy replacement did not enter recovery")
				}
			})
		}
	}
}

func TestCheckAll_SkipsRecoveringPlugins(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	_ = backend.Stop() // mark as stopped → unhealthy

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

	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	_ = backend.Stop() // unhealthy

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

	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	_ = backend.Stop() // unhealthy

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
		return
	case <-time.After(3 * time.Second):
		t.Fatal("HandlePluginCrash was not triggered for unhealthy plugin")
	}
}

func TestHandleCrashWithBackoff_NilContext(t *testing.T) {
	pm := &pluginManager{
		logger:  testLogger(t),
		records: make(map[string]*plugintypes.PluginRecord),
		emitter: testNoopEmitter{},
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

// checkAll and the crash-recovery paths run concurrently with the loader,
// which writes pm.records under pm.recordsMu. The health checker must take the
// same lock, or -race reports the map access (and Go can fault on it).
func TestHealthChecker_ConcurrentWithRecordWrites(t *testing.T) {
	hc, pm := newTestHealthChecker(t)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := range 200 {
			id := fmt.Sprintf("plugin-%d", i%5)
			pm.recordsMu.Lock()
			pm.records[id] = &plugintypes.PluginRecord{
				ID:      id,
				Phase:   lifecycle.PhaseRunning,
				Backend: &mockBackend{},
			}
			pm.recordsMu.Unlock()
		}
	}()

	for range 200 {
		hc.checkAll()
		hc.mu.Lock()
		hc.markFailedLocked("plugin-0", "boom", "test")
		hc.mu.Unlock()
	}
	<-done
}

func TestProbedCrashRetriesFailedReload(t *testing.T) {
	for _, succeeds := range []bool{true, false} {
		t.Run(fmt.Sprintf("eventual_success_%t", succeeds), func(t *testing.T) {
			starts := 0
			entry := CatalogEntry{
				Metadata: config.PluginMeta{ID: "native", Version: "1.0.0", Capabilities: []string{"resource"}},
				NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
					starts++
					if starts > 1 && (!succeeds || starts == 2) {
						return nil, errors.New("transient start failure")
					}
					return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{}), nil
				},
			}
			pm := catalogManager(t, []CatalogEntry{entry})
			require.NoError(t, pm.Initialize(t.Context()))
			_, err := pm.LoadPlugin("native", nil)
			require.NoError(t, err)
			hc := NewHealthChecker(testLogger(t), pm)
			pm.healthChecker = hc
			events := &testRecordingEmitter{}
			pm.emitter = events
			record := pm.records["native"]
			record.Phase = lifecycle.PhaseRecovering
			hc.recoveryStates["native"] = &CrashRecoveryState{NextBackoff: time.Millisecond}

			hc.handleCrashWithBackoff("native", &probedCrash{record: record, backend: record.Backend})

			require.Empty(t, hc.recoveryStates)
			require.Empty(t, hc.recoveryCancels)
			recorded := events.getEvents()
			require.NotEmpty(t, recorded)
			if succeeds {
				require.Equal(t, 3, starts)
				require.Equal(t, lifecycle.PhaseRunning, pm.records["native"].Phase)
				require.Equal(t, EventRecovered, recorded[len(recorded)-1].event)
			} else {
				require.Equal(t, 1+maxCrashRetries, starts)
				require.Equal(t, lifecycle.PhaseFailed, pm.records["native"].Phase)
				require.Equal(t, "max crash recovery attempts reached", pm.records["native"].LastError)
				require.Equal(t, EventCrashRecoveryFailed, recorded[len(recorded)-1].event)
			}
		})
	}
}

func TestProbedCrashDoesNotRetryReplacementAfterFailedReload(t *testing.T) {
	starts := 0
	failed := make(chan struct{})
	entry := CatalogEntry{
		Metadata: config.PluginMeta{ID: "native", Version: "1.0.0", Capabilities: []string{"resource"}},
		NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
			starts++
			if starts > 1 {
				close(failed)
				return nil, errors.New("start failed")
			}
			return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{}), nil
		},
	}
	pm := catalogManager(t, []CatalogEntry{entry})
	require.NoError(t, pm.Initialize(t.Context()))
	_, err := pm.LoadPlugin("native", nil)
	require.NoError(t, err)
	hc := NewHealthChecker(testLogger(t), pm)
	pm.healthChecker = hc
	record := pm.records["native"]
	record.Phase = lifecycle.PhaseRecovering
	hc.recoveryStates["native"] = &CrashRecoveryState{NextBackoff: 100 * time.Millisecond}
	done := make(chan struct{})
	go func() {
		defer close(done)
		hc.handleCrashWithBackoff("native", &probedCrash{record: record, backend: record.Backend})
	}()
	<-failed
	lock := pm.pluginOpsLock("native")
	lock.Lock()
	replacement := &plugintypes.PluginRecord{ID: "native", Phase: lifecycle.PhaseRunning}
	pm.recordsMu.Lock()
	pm.records["native"] = replacement
	pm.recordsMu.Unlock()
	lock.Unlock()
	<-done
	require.Equal(t, 2, starts)
	require.Same(t, replacement, pm.records["native"])
	require.Equal(t, lifecycle.PhaseRunning, replacement.Phase)
	require.Empty(t, hc.recoveryStates)
}

func TestProbedCrashFatalDuringBackoffStopsRecovery(t *testing.T) {
	hc, pm := newTestHealthChecker(t)
	pm.healthChecker = hc
	events := &testRecordingEmitter{}
	pm.emitter = events
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	record := &plugintypes.PluginRecord{ID: "native", Backend: backend, Phase: lifecycle.PhaseRecovering}
	pm.records["native"] = record
	hc.recoveryStates["native"] = &CrashRecoveryState{NextBackoff: time.Second}
	done := make(chan struct{})
	go func() {
		defer close(done)
		hc.handleCrashWithBackoff("native", &probedCrash{record: record, backend: backend})
	}()
	require.Eventually(t, func() bool {
		hc.mu.Lock()
		defer hc.mu.Unlock()
		return len(hc.recoveryCancels) != 0
	}, time.Second, time.Millisecond)
	pm.markFatalSourceTransport("native", backend, func(commit func()) bool { commit(); return true })
	<-done
	require.Equal(t, lifecycle.PhaseFailed, record.Phase)
	require.Equal(t, fatalSourceTransportMessage, record.LastError)
	require.Empty(t, hc.recoveryStates)
	require.Empty(t, hc.recoveryCancels)
	require.Empty(t, events.getEvents())
}
