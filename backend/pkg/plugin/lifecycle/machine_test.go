package lifecycle

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewPluginStateMachine(t *testing.T) {
	sm := NewPluginStateMachine("test-plugin", PhaseInstalled)
	assert.Equal(t, PhaseInstalled, sm.Phase())
	assert.Empty(t, sm.History())
}

func TestTransitionTo_Valid(t *testing.T) {
	sm := NewPluginStateMachine("test-plugin", PhaseInstalled)

	err := sm.TransitionTo(PhaseValidating, "starting validation")
	require.NoError(t, err)
	assert.Equal(t, PhaseValidating, sm.Phase())

	err = sm.TransitionTo(PhaseStarting, "validation passed")
	require.NoError(t, err)
	assert.Equal(t, PhaseStarting, sm.Phase())

	err = sm.TransitionTo(PhaseRunning, "plugin started")
	require.NoError(t, err)
	assert.Equal(t, PhaseRunning, sm.Phase())

	history := sm.History()
	assert.Len(t, history, 3)
	assert.Equal(t, PhaseInstalled, history[0].From)
	assert.Equal(t, PhaseValidating, history[0].To)
	assert.Equal(t, "starting validation", history[0].Reason)
}

func TestTransitionTo_Invalid(t *testing.T) {
	sm := NewPluginStateMachine("test-plugin", PhaseInstalled)

	err := sm.TransitionTo(PhaseRunning, "skip ahead")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid transition")
	// Phase should not have changed.
	assert.Equal(t, PhaseInstalled, sm.Phase())
}

func TestForcePhase(t *testing.T) {
	sm := NewPluginStateMachine("test-plugin", PhaseInstalled)

	// Force an otherwise invalid transition.
	sm.ForcePhase(PhaseRunning, "reconciliation")
	assert.Equal(t, PhaseRunning, sm.Phase())

	history := sm.History()
	require.Len(t, history, 1)
	assert.Contains(t, history[0].Reason, "force:")
}

func TestObserverNotification(t *testing.T) {
	sm := NewPluginStateMachine("test-plugin", PhaseInstalled)

	var observed []Transition
	sm.AddObserver(func(pluginID string, tr Transition) {
		assert.Equal(t, "test-plugin", pluginID)
		observed = append(observed, tr)
	})

	_ = sm.TransitionTo(PhaseValidating, "test")
	_ = sm.TransitionTo(PhaseStarting, "test")

	assert.Len(t, observed, 2)
	assert.Equal(t, PhaseInstalled, observed[0].From)
	assert.Equal(t, PhaseValidating, observed[0].To)
}

func TestHistoryRingBuffer(t *testing.T) {
	sm := NewPluginStateMachine("test-plugin", PhaseInstalled)

	// Exceed maxHistory by forcing many transitions.
	for i := 0; i < maxHistory+10; i++ {
		if i%2 == 0 {
			sm.ForcePhase(PhaseValidating, "even")
		} else {
			sm.ForcePhase(PhaseInstalled, "odd")
		}
	}

	history := sm.History()
	assert.LessOrEqual(t, len(history), maxHistory)
}

func TestRetryState(t *testing.T) {
	r := RetryState{NextBackoff: initialBackoff}

	assert.True(t, r.CanRetry())

	for i := 0; i < maxRetries; i++ {
		r.Advance()
	}

	assert.False(t, r.CanRetry())
	assert.Equal(t, maxRetries, r.Attempts)
	// Backoff should be capped.
	assert.LessOrEqual(t, r.NextBackoff, maxBackoff)

	r.Reset()
	assert.True(t, r.CanRetry())
	assert.Equal(t, 0, r.Attempts)
	assert.Equal(t, initialBackoff, r.NextBackoff)
}

func TestConcurrentTransitions(t *testing.T) {
	sm := NewPluginStateMachine("test-plugin", PhaseInstalled)

	var wg sync.WaitGroup
	// Run many concurrent force transitions to verify thread safety.
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			if n%2 == 0 {
				sm.ForcePhase(PhaseRunning, "concurrent")
			} else {
				sm.ForcePhase(PhaseInstalled, "concurrent")
			}
		}(i)
	}
	wg.Wait()

	// Should be in a valid state (either Running or Installed).
	phase := sm.Phase()
	assert.True(t, phase == PhaseRunning || phase == PhaseInstalled,
		"unexpected phase: %s", phase)
}
