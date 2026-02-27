package plugin

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

var stateMu sync.RWMutex

// stateFilePathOverride allows tests to redirect state persistence.
var stateFilePathOverride string

// stateFilePath returns the path to the JSON state file.
func stateFilePath() string {
	if stateFilePathOverride != "" {
		return stateFilePathOverride
	}
	return filepath.Join(resolveHomeDir(), ".omniview", "plugin_state.json")
}

// writePluginStateJSON atomically persists plugin records as JSON.
// Write to .tmp file then rename for POSIX atomicity.
func (pm *pluginManager) writePluginStateJSON() error {
	stateMu.Lock()
	defer stateMu.Unlock()

	pm.recordsMu.RLock()
	records := make([]types.PluginStateRecord, 0, len(pm.records))
	for _, r := range pm.records {
		records = append(records, r.ToStateRecord())
	}
	pm.recordsMu.RUnlock()

	data, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return fmt.Errorf("error marshaling plugin state: %w", err)
	}

	path := stateFilePath()
	tmpPath := path + ".tmp"

	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("error creating state directory: %w", err)
	}

	if err = os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("error writing temp state file: %w", err)
	}

	if err = os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
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
		merged[r.ID] = r.ToStateRecord()
	}
	pm.recordsMu.RUnlock()

	// Keep persisted entries that are NOT in the loaded records,
	// but only if their plugin directory still exists on disk.
	pluginDir := getPluginDir()
	for _, s := range persisted {
		if _, loaded := merged[s.ID]; !loaded {
			dir := filepath.Join(pluginDir, s.ID)
			if _, statErr := os.Stat(dir); os.IsNotExist(statErr) {
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

	path := stateFilePath()
	tmpPath := path + ".tmp"

	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("error creating state directory: %w", err)
	}

	if err = os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("error writing temp state file: %w", err)
	}

	if err = os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("error renaming state file: %w", err)
	}

	return nil
}

// readPluginStateJSON reads persisted plugin state from JSON.
func readPluginStateJSON() ([]types.PluginStateRecord, error) {
	stateMu.RLock()
	defer stateMu.RUnlock()

	data, err := os.ReadFile(stateFilePath())
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
