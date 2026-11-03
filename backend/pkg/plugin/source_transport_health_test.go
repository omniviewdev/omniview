package plugin

import (
	"sync"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/stretchr/testify/require"
)

func TestFatalSourceTransportMarksOnlyOwnedBackendFailed(t *testing.T) {
	_, pm := newTestHealthChecker(t)
	pm.pluginOpsLocks = make(map[string]*sync.Mutex)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	machine := lifecycle.NewPluginStateMachine("p", lifecycle.PhaseRunning)
	record := &plugintypes.PluginRecord{ID: "p", Backend: backend, Phase: lifecycle.PhaseRunning, StateMachine: machine}
	pm.records["p"] = record
	guard := func(commit func()) bool { commit(); return true }

	pm.markFatalSourceTransport("p", backend, guard)
	require.Equal(t, lifecycle.PhaseFailed, record.Phase)
	require.Equal(t, lifecycle.PhaseFailed, machine.Phase())
	require.Equal(t, fatalSourceTransportMessage, record.LastError)
	require.False(t, backend.Exited(), "health reporting must not restart or stop the backend")
}

func TestFatalSourceTransportRejectsStaleOwnership(t *testing.T) {
	_, pm := newTestHealthChecker(t)
	pm.pluginOpsLocks = make(map[string]*sync.Mutex)
	old := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	current := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	record := &plugintypes.PluginRecord{ID: "p", Backend: current, Phase: lifecycle.PhaseRunning}
	pm.records["p"] = record
	pm.markFatalSourceTransport("p", old, func(commit func()) bool { commit(); return true })
	require.Equal(t, lifecycle.PhaseRunning, record.Phase)
	pm.markFatalSourceTransport("p", current, func(func()) bool { return false })
	require.Equal(t, lifecycle.PhaseRunning, record.Phase)
	require.Empty(t, record.LastError)
}

func TestFatalSourceTransportWaitsForLifecyclePublication(t *testing.T) {
	_, pm := newTestHealthChecker(t)
	pm.pluginOpsLocks = make(map[string]*sync.Mutex)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	lock := pm.pluginOpsLock("p")
	lock.Lock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		pm.markFatalSourceTransport("p", backend, func(commit func()) bool { commit(); return true })
	}()
	record := &plugintypes.PluginRecord{ID: "p", Backend: backend, Phase: lifecycle.PhaseRunning}
	pm.recordsMu.Lock()
	pm.records["p"] = record
	pm.recordsMu.Unlock()
	lock.Unlock()
	<-done
	require.Equal(t, lifecycle.PhaseFailed, record.Phase)
}

func TestProbedCrashCannotRecoverFatalOrReplacementGeneration(t *testing.T) {
	_, pm := newTestHealthChecker(t)
	pm.pluginOpsLocks = make(map[string]*sync.Mutex)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	old := &plugintypes.PluginRecord{ID: "p", Backend: backend, Phase: lifecycle.PhaseRunning}
	pm.records["p"] = old
	pm.markFatalSourceTransport("p", backend, func(commit func()) bool { commit(); return true })
	pm.handleProbedCrash("p", old, backend)
	require.Equal(t, lifecycle.PhaseFailed, old.Phase)
	current, err := pm.reloadProbedCrash("p", &probedCrash{record: old, backend: backend})
	require.NoError(t, err)
	require.False(t, current)

	replacement := &plugintypes.PluginRecord{ID: "p", Backend: backend, Phase: lifecycle.PhaseRunning}
	pm.records["p"] = replacement
	pm.handleProbedCrash("p", old, backend)
	require.Equal(t, lifecycle.PhaseRunning, replacement.Phase)
}

func TestFatalSourceTransportStopsAlreadyAdmittedRecovery(t *testing.T) {
	hc, pm := newTestHealthChecker(t)
	pm.healthChecker = hc
	pm.pluginOpsLocks = make(map[string]*sync.Mutex)
	backend := plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{})
	record := &plugintypes.PluginRecord{ID: "p", Backend: backend, Phase: lifecycle.PhaseRecovering}
	pm.records["p"] = record
	pm.markFatalSourceTransport("p", backend, func(commit func()) bool { commit(); return true })
	require.Equal(t, lifecycle.PhaseFailed, record.Phase)
	hc.handleCrashWithBackoff("p", &probedCrash{record: record, backend: backend})
	require.Empty(t, hc.recoveryStates)
}
