package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

var stateMu sync.RWMutex

const stateFileName = "plugin_state.json"

// stateFilePerm is the permission of the state files the manager writes.
const stateFilePerm os.FileMode = 0o644

// writePluginStateJSON atomically persists plugin records as JSON.
// Write to .tmp file then rename for POSIX atomicity.
func (pm *pluginManager) writePluginStateJSON() error {
	stateMu.Lock()
	defer stateMu.Unlock()

	return pm.writePluginStateRecords(pm.pluginStateSnapshot(""))
}

// pluginStateSnapshot keeps an in-flight archive's durable preimage visible to
// unrelated state writers. Only its commit may publish that candidate.
func (pm *pluginManager) pluginStateSnapshot(committingID string) []types.PluginStateRecord {
	pm.recordsMu.RLock()
	defer pm.recordsMu.RUnlock()
	records := make([]types.PluginStateRecord, 0, len(pm.records)+len(pm.pendingArchiveState))
	for id, record := range pm.records {
		if id != committingID {
			if _, pending := pm.pendingArchiveState[id]; pending {
				continue
			}
		}
		if record != nil {
			records = append(records, record.ToStateRecord())
		}
	}
	for id, previous := range pm.pendingArchiveState {
		if id != committingID && previous != nil {
			records = append(records, *previous)
		}
	}
	return records
}

// The caller holds stateMu. Sync both the file and its rename before a recovery
// marker may authorize irreversible disposal of the previous installation.
func (pm *pluginManager) writePluginStateRecords(records []types.PluginStateRecord) error {

	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return fmt.Errorf("error marshaling plugin state: %w", err)
	}

	tmpName := stateFileName + ".tmp"

	file, err := pm.stateRoot.OpenFile(tmpName, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, stateFilePerm)
	if err != nil {
		return fmt.Errorf("error opening temp state file: %w", err)
	}
	_, writeErr := file.Write(data)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	if err = errors.Join(writeErr, file.Close()); err != nil {
		return fmt.Errorf("error writing temp state file: %w", err)
	}

	if err = pm.stateRoot.Rename(tmpName, stateFileName); err != nil {
		_ = pm.stateRoot.Remove(tmpName)
		return fmt.Errorf("error renaming state file: %w", err)
	}

	return syncUninstallDirectory(pm.stateRoot, ".")
}

// mergeAndWritePluginState writes the current in-memory records but also
// preserves any persisted state entries for plugins that failed to load.
// This prevents Initialize() from destructively overwriting state for
// plugins that couldn't start (e.g. missing binary after crash).
func (pm *pluginManager) mergeAndWritePluginState(persisted []types.PluginStateRecord) error {
	stateMu.Lock()
	defer stateMu.Unlock()

	// Start with current in-memory records.
	pm.recordsMu.RLock()
	merged := make(map[string]types.PluginStateRecord, len(pm.records)+len(persisted))
	for id, record := range pm.records {
		if _, pending := pm.pendingArchiveState[id]; pending {
			continue
		}
		if record != nil {
			merged[id] = record.ToStateRecord()
		}
	}
	for id, previous := range pm.pendingArchiveState {
		if previous != nil {
			merged[id] = *previous
		}
	}
	pm.recordsMu.RUnlock()

	// Keep persisted entries that are NOT in the loaded records,
	// but only if their plugin directory still exists on disk.
	for _, s := range persisted {
		if _, loaded := merged[s.ID]; !loaded {
			if _, statErr := pm.pluginsRoot.Stat(s.ID); os.IsNotExist(statErr) {
				// Ghost entry — plugin directory was removed; drop it.
				continue
			}
			merged[s.ID] = s
		}
	}

	records := make([]types.PluginStateRecord, 0, len(merged))
	for _, r := range merged {
		records = append(records, r)
	}

	return pm.writePluginStateRecords(records)
}

// readPluginStateJSON reads persisted plugin state from JSON.
func (pm *pluginManager) readPluginStateJSON() ([]types.PluginStateRecord, error) {
	stateMu.RLock()
	defer stateMu.RUnlock()
	return pm.readPluginStateJSONLocked()
}

// The caller holds stateMu.
func (pm *pluginManager) readPluginStateJSONLocked() ([]types.PluginStateRecord, error) {

	data, err := pm.stateRoot.ReadFile(stateFileName)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("error reading state file: %w", err)
	}

	var records []types.PluginStateRecord
	if err = json.Unmarshal(data, &records); err != nil {
		return nil, fmt.Errorf("error parsing state file: %w", err)
	}

	return records, nil
}
