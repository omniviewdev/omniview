package plugin

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

var stateMu sync.RWMutex

const stateFileName = "plugin_state.json"

// writePluginStateJSON atomically persists plugin records as JSON.
// Write to .tmp file then rename for POSIX atomicity.
func (pm *pluginManager) writePluginStateJSON() error {
	stateMu.Lock()
	defer stateMu.Unlock()

	pm.recordsMu.RLock()
	records := make([]types.PluginStateRecord, 0, len(pm.records))
	for _, r := range pm.records {
		if r == nil {
			continue
		}
		records = append(records, r.ToStateRecord())
	}
	pm.recordsMu.RUnlock()

	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return fmt.Errorf("error marshaling plugin state: %w", err)
	}

	tmpName := stateFileName + ".tmp"

	if err = pm.stateRoot.WriteFile(tmpName, data, 0644); err != nil {
		return fmt.Errorf("error writing temp state file: %w", err)
	}

	if err = pm.stateRoot.Rename(tmpName, stateFileName); err != nil {
		_ = pm.stateRoot.Remove(tmpName)
		return fmt.Errorf("error renaming state file: %w", err)
	}

	return nil
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
	for _, r := range pm.records {
		if r == nil {
			continue
		}
		merged[r.ID] = r.ToStateRecord()
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

	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return fmt.Errorf("error marshaling plugin state: %w", err)
	}

	tmpName := stateFileName + ".tmp"

	if err = pm.stateRoot.WriteFile(tmpName, data, 0644); err != nil {
		return fmt.Errorf("error writing temp state file: %w", err)
	}

	if err = pm.stateRoot.Rename(tmpName, stateFileName); err != nil {
		_ = pm.stateRoot.Remove(tmpName)
		return fmt.Errorf("error renaming state file: %w", err)
	}

	return nil
}

// readPluginStateJSON reads persisted plugin state from JSON.
func (pm *pluginManager) readPluginStateJSON() ([]types.PluginStateRecord, error) {
	stateMu.RLock()
	defer stateMu.RUnlock()

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
