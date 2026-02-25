package plugin

import (
	"os"
	"path/filepath"

	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// Reconciler audits the filesystem against persisted state and
// produces a consistent set of plugin records for the manager.
type Reconciler struct {
	logger *zap.SugaredLogger
}

// NewReconciler creates a new Reconciler.
func NewReconciler(logger *zap.SugaredLogger) *Reconciler {
	return &Reconciler{
		logger: logger.Named("Reconciler"),
	}
}

// ReconcileResult contains the reconciled plugin state.
type ReconcileResult struct {
	Records map[string]*plugintypes.PluginRecord
	// Orphans are directories found on disk but not in persisted state.
	Orphans []string
	// Ghosts are entries in persisted state but not on disk.
	Ghosts []string
}

// Reconcile compares the filesystem with persisted state and produces
// a consistent set of plugin records.
func (r *Reconciler) Reconcile(
	pluginDir string,
	persistedStates []plugintypes.PluginStateRecord,
) (*ReconcileResult, error) {
	result := &ReconcileResult{
		Records: make(map[string]*plugintypes.PluginRecord),
	}

	// Build a lookup from persisted state.
	stateByID := make(map[string]plugintypes.PluginStateRecord)
	for _, s := range persistedStates {
		stateByID[s.ID] = s
	}

	// Walk the filesystem to find installed plugins.
	entries, err := os.ReadDir(pluginDir)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return nil, err
	}

	diskIDs := make(map[string]bool)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		id := entry.Name()
		diskIDs[id] = true
		location := filepath.Join(pluginDir, id)

		// Try to load metadata.
		meta, metaErr := sdktypes.LoadPluginMetadata(location)
		if metaErr != nil {
			r.logger.Warnw("plugin directory missing metadata, skipping",
				"pluginID", id, "error", metaErr)
			continue
		}

		if state, ok := stateByID[id]; ok {
			// Have both disk and state — use state, update metadata.
			record := &plugintypes.PluginRecord{
				ID:          id,
				Phase:       r.determineInitialPhase(state, location),
				Metadata:    meta,
				Enabled:     state.Enabled,
				DevMode:     state.DevMode,
				DevPath:     state.DevPath,
				LastError:   state.LastError,
				ErrorCount:  state.ErrorCount,
				InstalledAt: state.InstalledAt,
				StateMachine: lifecycle.NewPluginStateMachine(id,
					r.determineInitialPhase(state, location)),
			}
			result.Records[id] = record
		} else {
			// On disk but not in state — orphan. Adopt it.
			r.logger.Infow("adopting orphan plugin from filesystem", "pluginID", id)
			result.Orphans = append(result.Orphans, id)

			record := plugintypes.NewPluginRecord(id, meta, lifecycle.PhaseInstalled)
			result.Records[id] = record
		}
	}

	// Check for ghosts: in state but not on disk.
	for id := range stateByID {
		if !diskIDs[id] {
			r.logger.Warnw("plugin in state but not on disk (ghost)", "pluginID", id)
			result.Ghosts = append(result.Ghosts, id)
		}
	}

	return result, nil
}

// determineInitialPhase figures out what phase a plugin should start in
// based on its persisted state and what's actually on disk.
func (r *Reconciler) determineInitialPhase(
	state plugintypes.PluginStateRecord,
	location string,
) lifecycle.PluginPhase {
	if !state.Enabled {
		return lifecycle.PhaseStopped
	}

	// Check if binary exists for backend plugins.
	if state.Metadata.HasBackendCapabilities() {
		if err := validateHasBinary(location); err != nil {
			if state.DevMode {
				// Dev plugin without binary — needs building.
				return lifecycle.PhaseBuilding
			}
			return lifecycle.PhaseFailed
		}
	}

	// Binary exists — ready to validate and start.
	return lifecycle.PhaseInstalled
}

// ReconcileFromFilesystem rebuilds state entirely from the filesystem.
// Used when the state file is corrupt or missing.
func (r *Reconciler) ReconcileFromFilesystem(
	pluginDir string,
) (*ReconcileResult, error) {
	r.logger.Infow("rebuilding plugin state from filesystem")

	entries, err := os.ReadDir(pluginDir)
	if err != nil {
		if os.IsNotExist(err) {
			return &ReconcileResult{
				Records: make(map[string]*plugintypes.PluginRecord),
			}, nil
		}
		return nil, err
	}

	result := &ReconcileResult{
		Records: make(map[string]*plugintypes.PluginRecord),
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		id := entry.Name()
		location := filepath.Join(pluginDir, id)

		meta, metaErr := sdktypes.LoadPluginMetadata(location)
		if metaErr != nil {
			r.logger.Warnw("skipping directory without valid metadata",
				"dir", id, "error", metaErr)
			continue
		}

		phase := lifecycle.PhaseInstalled
		if meta.HasBackendCapabilities() {
			if err := validateHasBinary(location); err != nil {
				phase = lifecycle.PhaseFailed
			}
		}

		record := plugintypes.NewPluginRecord(id, meta, phase)
		result.Records[id] = record

		r.logger.Infow("recovered plugin from filesystem",
			"pluginID", id, "phase", phase)
	}

	return result, nil
}


