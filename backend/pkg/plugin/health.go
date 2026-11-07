package plugin

import (
	"context"
	"reflect"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/telemetry"
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
	quarantined bool
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
	// Collect candidate IDs under the records lock, then probe without holding
	// it: Healthy() can be an RPC to the plugin.
	var probes []string
	hc.pm.recordsMu.RLock()
	for id, record := range hc.pm.records {
		if record.Phase != lifecycle.PhaseRunning {
			continue
		}
		// UI-only plugins have no process to check.
		if record.Backend == nil && !record.Metadata.HasBackendCapabilities() {
			continue
		}
		probes = append(probes, id)
	}
	hc.pm.recordsMu.RUnlock()

	for _, id := range probes {
		// Skip if recovery is already in progress for this plugin.
		hc.mu.Lock()
		_, recovering := hc.recoveryStates[id]
		hc.mu.Unlock()
		if recovering {
			continue
		}
		// Reacquire the pair together so replacements made after collection are
		// probed now, while later replacements remain fenced from the result.
		hc.pm.recordsMu.RLock()
		record := hc.pm.records[id]
		if record == nil || record.Phase != lifecycle.PhaseRunning ||
			(record.Backend == nil && !record.Metadata.HasBackendCapabilities()) {
			hc.pm.recordsMu.RUnlock()
			continue
		}
		backend, source := record.Backend, record.DevPath
		hc.pm.recordsMu.RUnlock()

		if !hc.checkPlugin(id, source, record, backend) {
			hc.logger.Warnw(hc.pm.ctx, "plugin health check failed, triggering recovery",
				"pluginID", id)
			go hc.pm.handleProbedCrash(id, record, backend)
		}
	}
}

// checkPlugin checks the health of a single running plugin using its Backend.
// Returns true if healthy, false if recovery should be triggered.
func (hc *HealthChecker) checkPlugin(id, source string, record *plugintypes.PluginRecord, backend plugintypes.PluginBackend) bool {
	if record != nil {
		generation := hc.pm.managedRuntimeGeneration(id, source)
		if generation != "" && backend != nil {
			err := verifyLifecycleRPC(backend, id)
			if err != nil {
				unlock := hc.pm.lockProbedCrash(id, &probedCrash{record: record, backend: backend}, lifecycle.PhaseRunning)
				if unlock != nil {
					hc.pm.observeManagedLifecycle(id, source, generation, false, false, err)
					unlock()
				}
			}
			return err == nil
		}
	}

	if backend == nil {
		// No record or no backend — cannot verify health, assume unhealthy.
		return false
	}

	return backend.Healthy()
}

// CrashRecoveryState tracks exponential backoff for a single plugin.
type CrashRecoveryState struct {
	Attempts    int
	NextBackoff time.Duration
	LastAttempt time.Time
	owner       context.Context
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
		cb.quarantined = false
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
// forcing its state machine to PhaseFailed with reason. Must be called with hc.mu
// held; it takes pm.recordsMu itself (lock order: hc.mu, then pm.recordsMu).
func (hc *HealthChecker) markFailedLocked(pluginID, lastError, reason string) {
	hc.pm.recordsMu.Lock()
	defer hc.pm.recordsMu.Unlock()
	if record, ok := hc.pm.records[pluginID]; ok {
		budget := hc.crashBudgets[pluginID]
		if budget == nil {
			budget = &crashBudget{windowStart: time.Now()}
			hc.crashBudgets[pluginID] = budget
		}
		if !budget.quarantined {
			budget.quarantined = true
			telemetry.RecordPluginQuarantine(context.Background())
		}
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
	hc.handleCrashWithBackoff(pluginID, nil)
}

func (hc *HealthChecker) handleCrashWithBackoff(pluginID string, expected *probedCrash) {
	var unlock func()
	var recoveryOptions *LoadPluginOptions
	if expected != nil {
		unlock = hc.pm.lockProbedCrash(pluginID, expected, lifecycle.PhaseRecovering)
		if unlock == nil {
			return
		}
		hc.pm.recordsMu.RLock()
		record := expected.record
		recoveryOptions = &LoadPluginOptions{ExistingState: &plugintypes.PluginStateRecord{
			ID: record.ID, Enabled: record.Enabled, DevMode: record.DevMode, DevPath: record.DevPath,
		}}
		hc.pm.recordsMu.RUnlock()
	}
	hc.mu.Lock()

	// Enforce a global crash budget to prevent infinite recovery cycles.
	// If a plugin keeps crashing immediately after recovery, the per-cycle
	// maxCrashRetries would reset each time. The budget tracks total crashes
	// across all cycles within a time window.
	if hc.consumeCrashBudgetLocked(pluginID) {
		hc.mu.Unlock()
		if unlock != nil {
			unlock()
		}
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
		delete(hc.recoveryStates, pluginID)
		hc.mu.Unlock()
		if unlock != nil {
			unlock()
		}
		return
	}

	// Create a cancellable context for this recovery loop.
	// CancelRecovery() will cancel it if the plugin is uninstalled.
	ctx, cancel := context.WithCancel(hc.pm.ctx)
	// Cancel any previous recovery goroutine for this plugin.
	if prevCancel, exists := hc.recoveryCancels[pluginID]; exists {
		prevCancel()
	}
	state.owner = ctx
	hc.recoveryCancels[pluginID] = cancel
	hc.mu.Unlock()
	if unlock != nil {
		unlock()
	}

	defer func() {
		hc.mu.Lock()
		// A newer recovery may have reused the state.
		if hc.recoveryStates[pluginID] == state && state.owner == ctx {
			delete(hc.recoveryStates, pluginID)
			delete(hc.recoveryCancels, pluginID)
		}
		hc.mu.Unlock()
		cancel()
	}()
	// After each failed reload, ownership moves to the record published by
	// that reload. Capture it while holding the lifecycle lock.
	var owned *recoveryRecord
	if expected != nil {
		owned = &recoveryRecord{record: expected.record, backend: expected.backend, phase: lifecycle.PhaseRecovering}
	}

	for {
		// Check if cancelled (plugin uninstalled).
		select {
		case <-ctx.Done():
			hc.logger.Infow(ctx, "crash recovery cancelled", "pluginID", pluginID)
			return
		default:
		}

		if expected != nil {
			unlock = hc.lockRecoveryRecord(pluginID, owned)
			if unlock == nil {
				return
			}
			if ctx.Err() != nil {
				unlock()
				return
			}
		}
		backoff, attempt, proceed := hc.beginRecoveryAttempt(pluginID, state)
		if expected != nil {
			unlock()
		}
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

		var err error
		if expected == nil {
			_, err = hc.pm.ReloadPlugin(pluginID)
		} else {
			unlock = hc.lockRecoveryRecord(pluginID, owned)
			if unlock == nil {
				return
			}
			if ctx.Err() != nil {
				unlock()
				return
			}
			if owned.record == nil {
				if err = hc.pm.guardArchiveRecovery(pluginID); err == nil {
					_, err = hc.pm.loadPluginLocked(pluginID, recoveryOptions)
				}
			} else {
				_, err = hc.pm.reloadPluginLocked(pluginID)
			}
			if err != nil {
				hc.pm.recordsMu.RLock()
				record := hc.pm.records[pluginID]
				owned = &recoveryRecord{record: record}
				if record != nil {
					owned.backend = record.Backend
					owned.phase = record.Phase
				}
				hc.pm.recordsMu.RUnlock()
			}
			unlock()
		}
		if err != nil {
			hc.logger.Errorw(hc.pm.ctx, "crash recovery attempt failed",
				"pluginID", pluginID, "attempt", attempt, "error", err)
			continue
		}

		// Success — the deferred cleanup resets the state.
		hc.logger.Infow(hc.pm.ctx, "plugin recovered after crash",
			"pluginID", pluginID, "attempts", attempt)

		hc.pm.emitter.Emit(EventRecovered, PluginErrorPayload{PluginID: pluginID})
		return
	}
}

// recoveryRecord identifies the exact lifecycle state left by a failed reload.
// A nil record is also tracked, so a later replacement is never adopted.
type recoveryRecord struct {
	record  *plugintypes.PluginRecord
	backend plugintypes.PluginBackend
	phase   lifecycle.PluginPhase
}

func (hc *HealthChecker) lockRecoveryRecord(id string, expected *recoveryRecord) func() {
	if expected.backend != nil && !reflect.TypeOf(expected.backend).Comparable() {
		return nil
	}
	lock := hc.pm.pluginOpsLock(id)
	lock.Lock()
	hc.pm.recordsMu.RLock()
	record := hc.pm.records[id]
	current := record == expected.record
	if current && record != nil {
		current = record.Backend == expected.backend && record.Phase == expected.phase
	}
	hc.pm.recordsMu.RUnlock()
	if !current {
		lock.Unlock()
		return nil
	}
	return lock.Unlock
}
