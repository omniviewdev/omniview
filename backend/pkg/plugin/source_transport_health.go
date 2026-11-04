package plugin

import (
	"reflect"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

const fatalSourceTransportMessage = "Resource source transport failed; provider is unavailable."

// markFatalSourceTransport serializes with plugin lifecycle changes, then commits
// only while both the resource registration and backend still belong to the
// failed generation. It deliberately does not start crash recovery.
func (pm *pluginManager) markFatalSourceTransport(id string, backend plugintypes.PluginBackend, withOwnership func(func()) bool) {
	if backend == nil || withOwnership == nil || !reflect.TypeOf(backend).Comparable() {
		return
	}
	lock := pm.pluginOpsLock(id)
	lock.Lock()
	defer lock.Unlock()

	var machine *lifecycle.PluginStateMachine
	marked := false
	withOwnership(func() {
		pm.recordsMu.Lock()
		defer pm.recordsMu.Unlock()
		record := pm.records[id]
		if record == nil || record.Backend != backend || (record.Phase != lifecycle.PhaseRunning && record.Phase != lifecycle.PhaseRecovering) {
			return
		}
		record.Phase = lifecycle.PhaseFailed
		record.LastError = fatalSourceTransportMessage
		machine = record.StateMachine
		marked = true
	})
	if !marked {
		return
	}
	if pm.healthChecker != nil {
		pm.healthChecker.CancelRecovery(id)
	}
	if machine != nil {
		machine.ForcePhase(lifecycle.PhaseFailed, fatalSourceTransportMessage)
	}
	pm.retireConnectionSharing(id)
	pm.retireActivities(id)
}

type probedCrash struct {
	record  *plugintypes.PluginRecord
	backend plugintypes.PluginBackend
}

// lockProbedCrash keeps the record stable until the caller releases the lock.
func (pm *pluginManager) lockProbedCrash(id string, expected *probedCrash, phase lifecycle.PluginPhase) func() {
	if expected == nil || (expected.backend != nil && !reflect.TypeOf(expected.backend).Comparable()) {
		return nil
	}
	lock := pm.pluginOpsLock(id)
	lock.Lock()
	pm.recordsMu.RLock()
	record := pm.records[id]
	current := record == expected.record && record != nil && record.Backend == expected.backend && record.Phase == phase
	pm.recordsMu.RUnlock()
	if !current {
		lock.Unlock()
		return nil
	}
	return lock.Unlock
}

func (pm *pluginManager) handleProbedCrash(id string, record *plugintypes.PluginRecord, backend plugintypes.PluginBackend) {
	expected := &probedCrash{record: record, backend: backend}
	unlock := pm.lockProbedCrash(id, expected, lifecycle.PhaseRunning)
	if unlock == nil {
		return
	}
	pm.handlePluginCrash(id, expected, unlock)
}

func (pm *pluginManager) reloadProbedCrash(id string, expected *probedCrash) (bool, error) {
	unlock := pm.lockProbedCrash(id, expected, lifecycle.PhaseRecovering)
	if unlock == nil {
		return false, nil
	}
	defer unlock()
	_, err := pm.reloadPluginLocked(id)
	return true, err
}
