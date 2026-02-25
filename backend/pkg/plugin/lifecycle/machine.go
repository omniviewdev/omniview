package lifecycle

import (
	"fmt"
	"sync"
	"time"
)

const (
	maxHistory    = 50
	maxRetries    = 5
	initialBackoff = 1 * time.Second
	maxBackoff     = 60 * time.Second
)

// Observer is called on every state transition.
type Observer func(pluginID string, t Transition)

// RetryState tracks exponential backoff for crash recovery.
type RetryState struct {
	Attempts    int
	NextBackoff time.Duration
	LastAttempt time.Time
}

// Reset clears retry state after a successful recovery.
func (r *RetryState) Reset() {
	r.Attempts = 0
	r.NextBackoff = initialBackoff
	r.LastAttempt = time.Time{}
}

// Advance increments the retry counter and doubles the backoff (capped).
func (r *RetryState) Advance() {
	r.Attempts++
	r.LastAttempt = time.Now()
	r.NextBackoff *= 2
	if r.NextBackoff > maxBackoff {
		r.NextBackoff = maxBackoff
	}
}

// CanRetry returns true if we haven't exhausted retries.
func (r *RetryState) CanRetry() bool {
	return r.Attempts < maxRetries
}

// PluginStateMachine manages the lifecycle phase for a single plugin.
// It is thread-safe and notifies observers on every transition.
type PluginStateMachine struct {
	mu        sync.RWMutex
	pluginID  string
	phase     PluginPhase
	history   []Transition
	observers []Observer
	Retry     RetryState
}

// NewPluginStateMachine creates a state machine starting at the given phase.
func NewPluginStateMachine(pluginID string, initial PluginPhase) *PluginStateMachine {
	return &PluginStateMachine{
		pluginID: pluginID,
		phase:    initial,
		history:  make([]Transition, 0, maxHistory),
		Retry: RetryState{
			NextBackoff: initialBackoff,
		},
	}
}

// Phase returns the current phase (thread-safe).
func (sm *PluginStateMachine) Phase() PluginPhase {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.phase
}

// TransitionTo attempts a state transition. Returns an error if the
// transition is not valid.
func (sm *PluginStateMachine) TransitionTo(next PluginPhase, reason string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if !IsValidTransition(sm.phase, next) {
		return fmt.Errorf("invalid transition %s → %s for plugin %s", sm.phase, next, sm.pluginID)
	}

	t := Transition{
		From:      sm.phase,
		To:        next,
		Reason:    reason,
		Timestamp: time.Now(),
	}

	sm.phase = next

	// Ring buffer: keep last maxHistory entries.
	if len(sm.history) >= maxHistory {
		sm.history = sm.history[1:]
	}
	sm.history = append(sm.history, t)

	// Notify observers (holding lock — observers should be fast).
	for _, obs := range sm.observers {
		obs(sm.pluginID, t)
	}

	return nil
}

// ForcePhase sets the phase without validation. Use only during
// reconciliation or initial load from persisted state.
func (sm *PluginStateMachine) ForcePhase(phase PluginPhase, reason string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	t := Transition{
		From:      sm.phase,
		To:        phase,
		Reason:    "force: " + reason,
		Timestamp: time.Now(),
	}

	sm.phase = phase
	if len(sm.history) >= maxHistory {
		sm.history = sm.history[1:]
	}
	sm.history = append(sm.history, t)

	for _, obs := range sm.observers {
		obs(sm.pluginID, t)
	}
}

// AddObserver registers a callback for state transitions.
func (sm *PluginStateMachine) AddObserver(obs Observer) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.observers = append(sm.observers, obs)
}

// History returns a copy of the transition history.
func (sm *PluginStateMachine) History() []Transition {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	out := make([]Transition, len(sm.history))
	copy(out, sm.history)
	return out
}
