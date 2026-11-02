package plugin

import (
	"fmt"
	"sort"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// PluginProcessInfo is a read-only observation, not process ownership authority.
type PluginProcessInfo struct {
	PluginID  string                         `json:"pluginID"`
	Ownership string                         `json:"ownership"`
	Identity  *devsession.ProcessObservation `json:"identity"`
	Error     string                         `json:"error"`
}

type processObserver interface {
	ProcessObservation() (devsession.ProcessObservation, error)
}

func processBackendExited(backend plugintypes.PluginBackend) bool {
	if observer, ok := backend.(interface{ ProcessExited() bool }); ok {
		return observer.ProcessExited()
	}
	return backend.Exited()
}

// GetPluginProcesses never performs RPCs or adopts processes for lifecycle control.
func (pm *pluginManager) GetPluginProcesses() []PluginProcessInfo {
	return pm.getPluginProcesses(devsession.ObserveProcess)
}

func (pm *pluginManager) getPluginProcesses(observe func(int) (devsession.ProcessObservation, error)) []PluginProcessInfo {
	pm.recordsMu.RLock()
	snapshots := make([]profilingBackendSnapshot, 0, len(pm.records))
	for id, record := range pm.records {
		if record.Phase == lifecycle.PhaseRunning && record.Backend != nil {
			snapshots = append(snapshots, profilingBackendSnapshot{id: id, record: record, backend: record.Backend})
		}
	}
	pm.recordsMu.RUnlock()
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].id < snapshots[j].id })
	results := make([]PluginProcessInfo, len(snapshots))
	for i, snapshot := range snapshots {
		result := PluginProcessInfo{PluginID: snapshot.id, Ownership: "unverified"}
		if processBackendExited(snapshot.backend) {
			result.Error = "Plugin backend is not running"
		} else if _, ok := snapshot.backend.(*plugintypes.InProcessBackend); ok {
			result.Ownership = "shared"
		} else if observer, ok := snapshot.backend.(processObserver); ok {
			identity, err := observer.ProcessObservation()
			if err == nil {
				err = validatePluginObservation(identity, observe)
			}
			if err != nil {
				result.Error = err.Error()
			} else {
				result.Ownership = "verified"
				result.Identity = &identity
			}
		} else {
			result.Error = "Plugin backend does not expose process identity"
		}
		results[i] = result
	}
	// Fence all results after the batch; later observations may outlive earlier backends.
	for i, snapshot := range snapshots {
		if results[i].Identity != nil {
			if err := validatePluginObservation(*results[i].Identity, observe); err != nil {
				results[i] = PluginProcessInfo{PluginID: snapshot.id, Ownership: "unverified", Error: err.Error()}
			}
		}
	}
	for i, snapshot := range snapshots {
		// No inventory lock spans kernel I/O or backend callbacks.
		exited := processBackendExited(snapshot.backend)
		pm.recordsMu.RLock()
		current := pm.records[snapshot.id]
		unchanged := current == snapshot.record && current != nil &&
			current.Backend == snapshot.backend && current.Phase == lifecycle.PhaseRunning
		pm.recordsMu.RUnlock()
		if exited || !unchanged {
			results[i] = PluginProcessInfo{PluginID: snapshot.id, Ownership: "unverified", Error: "Plugin backend is not running or has changed"}
		}
	}
	return results
}

func validatePluginObservation(identity devsession.ProcessObservation, observe func(int) (devsession.ProcessObservation, error)) error {
	if identity.PID <= 0 || identity.StartIdentity == "" || identity.Executable == "" {
		return fmt.Errorf("Plugin process identity unavailable")
	}
	current, err := observe(identity.PID)
	if err != nil {
		return fmt.Errorf("Plugin process observation: %w", err)
	}
	if current != identity {
		return fmt.Errorf("Plugin process identity changed")
	}
	return nil
}
