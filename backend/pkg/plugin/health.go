package plugin

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

const (
	healthCheckInterval = 30 * time.Second
	maxCrashRetries     = 3
	initialCrashBackoff = 2 * time.Second
	maxCrashBackoff     = 30 * time.Second

	// maxTotalCrashes is the hard limit on total crash-recovery cycles per
	// plugin within crashBudgetWindow. This prevents infinite recovery loops
	// when a plugin keeps crashing immediately after being reloaded.
	maxTotalCrashes   = 5
	crashBudgetWindow = 5 * time.Minute
)

// crashBudget tracks the total number of crash-recovery cycles for a plugin
// within a sliding time window to prevent infinite recovery loops.
type crashBudget struct {
	count       int
	windowStart time.Time
}

// HealthChecker periodically checks the health of running plugins
// and triggers crash recovery when issues are detected.
type HealthChecker struct {
	logger          logging.Logger
	pm              *pluginManager
	mu              sync.Mutex
	recoveryStates  map[string]*CrashRecoveryState
	recoveryCancels map[string]context.CancelFunc
	crashBudgets    map[string]*crashBudget
}

// NewHealthChecker creates a new HealthChecker.
func NewHealthChecker(logger logging.Logger, pm *pluginManager) *HealthChecker {
	return &HealthChecker{
		logger:          logger.Named("HealthChecker"),
		pm:              pm,
		mu:              sync.Mutex{},
		recoveryStates:  make(map[string]*CrashRecoveryState),
		recoveryCancels: make(map[string]context.CancelFunc),
		crashBudgets:    make(map[string]*crashBudget),
	}
}

// Start begins the periodic health check loop.
func (hc *HealthChecker) Start(ctx context.Context) {
	ticker := time.NewTicker(healthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			hc.checkAll()
		}
	}
}

// checkAll iterates over all loaded plugins and checks their health.
func (hc *HealthChecker) checkAll() {
	hc.mu.Lock()
	defer hc.mu.Unlock()

	for id, record := range hc.pm.records {
		if record.Phase != lifecycle.PhaseRunning {
			continue
		}
		// UI-only plugins have no process to check.
		if record.Backend == nil && !record.Metadata.HasBackendCapabilities() {
			continue
		}
		// Skip if recovery is already in progress for this plugin.
		if _, recovering := hc.recoveryStates[id]; recovering {
			continue
		}

		if !hc.checkPlugin(id) {
			hc.logger.Warnw(hc.pm.ctx, "plugin health check failed, triggering recovery",
				"pluginID", id)
			go hc.pm.HandlePluginCrash(id)
		}
	}
}

// checkPlugin checks the health of a single running plugin using its Backend.
// Returns true if healthy, false if recovery should be triggered.
func (hc *HealthChecker) checkPlugin(id string) bool {
	record, ok := hc.pm.records[id]
	if !ok || record.Backend == nil {
		// No record or no backend — cannot verify health, assume unhealthy.
		return false
	}

	return record.Backend.Healthy()
}

// CrashRecoveryState tracks exponential backoff for a single plugin.
type CrashRecoveryState struct {
	Attempts    int
	NextBackoff time.Duration
	LastAttempt time.Time
}

// CancelRecovery cancels any in-progress crash recovery goroutine for the given plugin.
// This should be called when a plugin is uninstalled to prevent recovery loops.
func (hc *HealthChecker) CancelRecovery(pluginID string) {
	hc.mu.Lock()
	defer hc.mu.Unlock()

	if cancel, ok := hc.recoveryCancels[pluginID]; ok {
		cancel()
		delete(hc.recoveryCancels, pluginID)
	}
	delete(hc.recoveryStates, pluginID)
	delete(hc.crashBudgets, pluginID)
}

// ResetBudget clears the crash budget and recovery state for a plugin.
// This should be called when the user manually triggers a reload so that
// the plugin gets fresh retry attempts instead of being immediately
// rejected by an exhausted budget from a prior crash cycle.
func (hc *HealthChecker) ResetBudget(pluginID string) {
	hc.mu.Lock()
	defer hc.mu.Unlock()

	delete(hc.crashBudgets, pluginID)
	delete(hc.recoveryStates, pluginID)
}

// IsInCrashCycle returns true if the plugin has already crashed at least once
// within the current budget window. Used by HandlePluginCrash to suppress
// repeated "plugin/crash" notifications during crash-recover-crash loops.
func (hc *HealthChecker) IsInCrashCycle(pluginID string) bool {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	cb := hc.crashBudgets[pluginID]
	if cb == nil {
		return false
	}
	if time.Since(cb.windowStart) > crashBudgetWindow {
		return false
	}
	return cb.count > 0
}

// beginRecoveryAttempt records a new recovery attempt in state and returns the
// backoff to wait and the attempt number. When the maximum number of attempts
// has been reached it marks the plugin as failed, emits EventCrashRecoveryFailed
// and reports false.
func (hc *HealthChecker) beginRecoveryAttempt(
	pluginID string,
	state *CrashRecoveryState,
) (time.Duration, int, bool) {
	hc.mu.Lock()
	if state.Attempts >= maxCrashRetries {
		hc.logger.Errorw(hc.pm.ctx, "max crash recovery attempts reached",
			"pluginID", pluginID, "attempts", state.Attempts)

		// Mark the plugin record as failed if we have one.
		hc.markFailedLocked(pluginID, "max crash recovery attempts reached", "max retries exhausted")

		hc.mu.Unlock()
		hc.pm.emitter.Emit(EventCrashRecoveryFailed, PluginErrorPayload{
			PluginID: pluginID,
			Error:    "max crash recovery attempts reached",
		})
		return 0, 0, false
	}

	backoff := state.NextBackoff
	state.Attempts++
	state.LastAttempt = time.Now()
	state.NextBackoff *= 2
	if state.NextBackoff > maxCrashBackoff {
		state.NextBackoff = maxCrashBackoff
	}
	attempt := state.Attempts
	hc.mu.Unlock()
	return backoff, attempt, true
}

// consumeCrashBudgetLocked counts a crash against the plugin's crash budget and
// reports whether the budget is now exhausted, in which case the plugin record
// is marked as failed. Must be called with hc.mu held.
func (hc *HealthChecker) consumeCrashBudgetLocked(pluginID string) bool {
	cb := hc.crashBudgets[pluginID]
	if cb == nil {
		cb = &crashBudget{count: 0, windowStart: time.Now()}
		hc.crashBudgets[pluginID] = cb
	}
	// Reset the window if enough time has passed since first crash.
	if time.Since(cb.windowStart) > crashBudgetWindow {
		cb.count = 0
		cb.windowStart = time.Now()
	}
	cb.count++
	if cb.count <= maxTotalCrashes {
		return false
	}
	hc.logger.Errorw(hc.pm.ctx, "crash budget exhausted — plugin keeps crashing, giving up",
		"pluginID", pluginID, "totalCrashes", cb.count, "window", crashBudgetWindow)
	hc.markFailedLocked(pluginID, "plugin keeps crashing (crash budget exhausted)", "crash budget exhausted")
	return true
}

// markFailedLocked marks the plugin record (if any) as failed with lastError,
// forcing its state machine to PhaseFailed with reason. Must be called with hc.mu held.
func (hc *HealthChecker) markFailedLocked(pluginID, lastError, reason string) {
	if record, ok := hc.pm.records[pluginID]; ok {
		record.Phase = lifecycle.PhaseFailed
		record.LastError = lastError
		if record.StateMachine != nil {
			record.StateMachine.ForcePhase(lifecycle.PhaseFailed, reason)
		}
	}
}

// HandleCrashWithBackoff handles a plugin crash with exponential backoff.
// Uses an iterative loop instead of recursion to avoid stack growth.
func (hc *HealthChecker) HandleCrashWithBackoff(pluginID string) {
	hc.mu.Lock()

	// Enforce a global crash budget to prevent infinite recovery cycles.
	// If a plugin keeps crashing immediately after recovery, the per-cycle
	// maxCrashRetries would reset each time. The budget tracks total crashes
	// across all cycles within a time window.
	if hc.consumeCrashBudgetLocked(pluginID) {
		hc.mu.Unlock()
		hc.pm.emitter.Emit(EventCrashRecoveryFailed, PluginErrorPayload{
			PluginID: pluginID,
			Error:    "crash budget exhausted — too many crashes in a short time",
		})
		return
	}

	state, ok := hc.recoveryStates[pluginID]
	if !ok {
		state = &CrashRecoveryState{
			Attempts:    0,
			LastAttempt: time.Time{},
			NextBackoff: initialCrashBackoff,
		}
		hc.recoveryStates[pluginID] = state
	}

	// Guard against nil manager context.
	if hc.pm.ctx == nil {
		hc.logger.Errorw(context.Background(), "cannot start crash recovery: manager context is nil", "pluginID", pluginID)
		hc.mu.Unlock()
		return
	}

	// Create a cancellable context for this recovery loop.
	// CancelRecovery() will cancel it if the plugin is uninstalled.
	ctx, cancel := context.WithCancel(hc.pm.ctx)
	// Cancel any previous recovery goroutine for this plugin.
	if prevCancel, exists := hc.recoveryCancels[pluginID]; exists {
		prevCancel()
	}
	hc.recoveryCancels[pluginID] = cancel
	hc.mu.Unlock()

	defer func() {
		hc.mu.Lock()
		// Only clean up if we're still the active cancel (not replaced by a newer goroutine).
		currentCancel, active := hc.recoveryCancels[pluginID]
		if active && fmt.Sprintf("%p", currentCancel) == fmt.Sprintf("%p", cancel) {
			delete(hc.recoveryCancels, pluginID)
		}
		hc.mu.Unlock()
		cancel()
	}()

	for {
		// Check if cancelled (plugin uninstalled).
		select {
		case <-ctx.Done():
			hc.logger.Infow(ctx, "crash recovery cancelled", "pluginID", pluginID)
			return
		default:
		}

		backoff, attempt, proceed := hc.beginRecoveryAttempt(pluginID, state)
		if !proceed {
			return
		}

		hc.logger.Infow(hc.pm.ctx, "waiting before crash recovery attempt",
			"pluginID", pluginID,
			"attempt", attempt,
			"backoff", backoff,
		)

		// Context-aware sleep: cancel recovery if the plugin is uninstalled
		// or the manager is shutting down.
		timer := time.NewTimer(backoff)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			hc.logger.Infow(ctx, "crash recovery cancelled during backoff", "pluginID", pluginID)
			return
		}

		if _, err := hc.pm.ReloadPlugin(pluginID); err != nil {
			hc.logger.Errorw(hc.pm.ctx, "crash recovery attempt failed",
				"pluginID", pluginID, "attempt", attempt, "error", err)
			continue
		}

		// Success — reset the state.
		hc.logger.Infow(hc.pm.ctx, "plugin recovered after crash",
			"pluginID", pluginID, "attempts", attempt)

		hc.mu.Lock()
		delete(hc.recoveryStates, pluginID)
		hc.mu.Unlock()

		hc.pm.emitter.Emit(EventRecovered, PluginErrorPayload{PluginID: pluginID})
		return
	}
}
