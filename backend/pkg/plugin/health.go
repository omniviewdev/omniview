package plugin

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
)

const (
	healthCheckInterval = 30 * time.Second
	maxCrashRetries     = 5
	initialCrashBackoff = 1 * time.Second
	maxCrashBackoff     = 60 * time.Second

	// maxTotalCrashes is the hard limit on total crash-recovery cycles per
	// plugin within crashBudgetWindow. This prevents infinite recovery loops
	// when a plugin keeps crashing immediately after being reloaded.
	maxTotalCrashes    = 8
	crashBudgetWindow  = 5 * time.Minute
)

// crashBudget tracks the total number of crash-recovery cycles for a plugin
// within a sliding time window to prevent infinite recovery loops.
type crashBudget struct {
	count      int
	windowStart time.Time
}

// HealthChecker periodically checks the health of running plugins
// and triggers crash recovery when issues are detected.
type HealthChecker struct {
	logger          *zap.SugaredLogger
	pm              *pluginManager
	mu              sync.Mutex
	recoveryStates  map[string]*CrashRecoveryState
	recoveryCancels map[string]context.CancelFunc
	crashBudgets    map[string]*crashBudget
}

// NewHealthChecker creates a new HealthChecker.
func NewHealthChecker(logger *zap.SugaredLogger, pm *pluginManager) *HealthChecker {
	return &HealthChecker{
		logger:          logger.Named("HealthChecker"),
		pm:              pm,
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
		// Skip if recovery is already in progress for this plugin.
		if _, recovering := hc.recoveryStates[id]; recovering {
			continue
		}

		if !hc.checkPlugin(id) {
			hc.logger.Warnw("plugin health check failed, triggering recovery",
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

// HandleCrashWithBackoff handles a plugin crash with exponential backoff.
// Uses an iterative loop instead of recursion to avoid stack growth.
func (hc *HealthChecker) HandleCrashWithBackoff(pluginID string) {
	hc.mu.Lock()

	// Enforce a global crash budget to prevent infinite recovery cycles.
	// If a plugin keeps crashing immediately after recovery, the per-cycle
	// maxCrashRetries would reset each time. The budget tracks total crashes
	// across all cycles within a time window.
	cb := hc.crashBudgets[pluginID]
	if cb == nil {
		cb = &crashBudget{windowStart: time.Now()}
		hc.crashBudgets[pluginID] = cb
	}
	// Reset the window if enough time has passed since first crash.
	if time.Since(cb.windowStart) > crashBudgetWindow {
		cb.count = 0
		cb.windowStart = time.Now()
	}
	cb.count++
	if cb.count > maxTotalCrashes {
		hc.logger.Errorw("crash budget exhausted — plugin keeps crashing, giving up",
			"pluginID", pluginID, "totalCrashes", cb.count, "window", crashBudgetWindow)
		if record, ok := hc.pm.records[pluginID]; ok {
			record.Phase = lifecycle.PhaseFailed
			record.LastError = "plugin keeps crashing (crash budget exhausted)"
			if record.StateMachine != nil {
				record.StateMachine.ForcePhase(lifecycle.PhaseFailed, "crash budget exhausted")
			}
		}
		hc.mu.Unlock()
		emitEvent(hc.pm.ctx, EventCrashRecoveryFailed, map[string]interface{}{
			"pluginID": pluginID,
			"error":    "crash budget exhausted — too many crashes in a short time",
		})
		return
	}

	state, ok := hc.recoveryStates[pluginID]
	if !ok {
		state = &CrashRecoveryState{
			NextBackoff: initialCrashBackoff,
		}
		hc.recoveryStates[pluginID] = state
	}

	// Guard against nil manager context.
	if hc.pm.ctx == nil {
		hc.logger.Errorw("cannot start crash recovery: manager context is nil", "pluginID", pluginID)
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
		if currentCancel, ok := hc.recoveryCancels[pluginID]; ok && fmt.Sprintf("%p", currentCancel) == fmt.Sprintf("%p", cancel) {
			delete(hc.recoveryCancels, pluginID)
		}
		hc.mu.Unlock()
		cancel()
	}()

	for {
		// Check if cancelled (plugin uninstalled).
		select {
		case <-ctx.Done():
			hc.logger.Infow("crash recovery cancelled", "pluginID", pluginID)
			return
		default:
		}

		hc.mu.Lock()
		if state.Attempts >= maxCrashRetries {
			hc.logger.Errorw("max crash recovery attempts reached",
				"pluginID", pluginID, "attempts", state.Attempts)

			// Mark the plugin record as failed if we have one.
			if record, ok := hc.pm.records[pluginID]; ok {
				record.Phase = lifecycle.PhaseFailed
				record.LastError = "max crash recovery attempts reached"
				if record.StateMachine != nil {
					record.StateMachine.ForcePhase(lifecycle.PhaseFailed, "max retries exhausted")
				}
			}

			hc.mu.Unlock()
			emitEvent(hc.pm.ctx, EventCrashRecoveryFailed, map[string]interface{}{
				"pluginID": pluginID,
				"error":    "max crash recovery attempts reached",
			})
			return
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

		hc.logger.Infow("waiting before crash recovery attempt",
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
			hc.logger.Infow("crash recovery cancelled during backoff", "pluginID", pluginID)
			return
		}

		if _, err := hc.pm.ReloadPlugin(pluginID); err != nil {
			hc.logger.Errorw("crash recovery attempt failed",
				"pluginID", pluginID, "attempt", attempt, "error", err)
			continue
		}

		// Success — reset the state.
		hc.logger.Infow("plugin recovered after crash",
			"pluginID", pluginID, "attempts", attempt)

		hc.mu.Lock()
		delete(hc.recoveryStates, pluginID)
		hc.mu.Unlock()

		emitEvent(hc.pm.ctx, EventRecovered, map[string]interface{}{"pluginID": pluginID})
		return
	}
}
