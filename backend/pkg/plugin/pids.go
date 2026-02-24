package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"go.uber.org/zap"
)

// PluginPIDTracker tracks PIDs of running plugin binary processes so that
// orphaned processes from a previous unclean shutdown (force-quit, crash,
// SIGKILL) can be cleaned up on the next startup.
//
// On clean shutdown, client.Kill() already terminates plugin processes, so the
// saved PID file will typically be empty. The file only matters when shutdown
// was interrupted.
type PluginPIDTracker struct {
	mu   sync.Mutex
	pids map[string]int // pluginID -> PID
}

// NewPluginPIDTracker creates a new tracker with an empty PID map.
func NewPluginPIDTracker() *PluginPIDTracker {
	return &PluginPIDTracker{
		pids: make(map[string]int),
	}
}

// Record adds or updates the PID for a plugin. Called after a plugin binary
// is successfully started and the gRPC connection is established.
func (t *PluginPIDTracker) Record(pluginID string, pid int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.pids[pluginID] = pid
}

// Remove deletes the PID entry for a plugin. Called when a plugin is cleanly
// stopped via client.Kill().
func (t *PluginPIDTracker) Remove(pluginID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.pids, pluginID)
}

// pidFilePath returns the path to the plugin PID tracking file.
func pluginPIDFilePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".omniview", "plugin_pids.json")
}

// Save persists the current pluginID→PID map to disk. This is called during
// Shutdown as a safety net — if all plugins were stopped cleanly the map is
// empty, but if shutdownPlugin failed for any plugin its PID will be saved
// for cleanup on the next startup.
func (t *PluginPIDTracker) Save() error {
	t.mu.Lock()
	data := make(map[string]int, len(t.pids))
	for id, pid := range t.pids {
		data[id] = pid
	}
	t.mu.Unlock()

	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(pluginPIDFilePath(), b, 0644)
}

// CleanupStale reads the PID file from a previous session, kills any processes
// that are still alive, and removes the file. This should be called early in
// Initialize(), before any new plugins are started.
func (t *PluginPIDTracker) CleanupStale(logger *zap.SugaredLogger) {
	pidFile := pluginPIDFilePath()
	b, err := os.ReadFile(pidFile)
	if err != nil {
		// No PID file — nothing to clean up (normal case after clean shutdown).
		return
	}
	_ = os.Remove(pidFile)

	var data map[string]int
	if err := json.Unmarshal(b, &data); err != nil {
		logger.Warnw("failed to parse plugin PID file", "error", err)
		return
	}

	killed := 0
	for pluginID, pid := range data {
		if pid <= 0 {
			continue
		}

		if err := killProcess(pid); err != nil {
			// Process already dead — that's fine.
			if !isProcessNotFound(err) {
				logger.Warnw("failed to kill stale plugin process",
					"pluginID", pluginID,
					"pid", pid,
					"error", err,
				)
			}
			continue
		}

		logger.Infow("killed stale plugin process",
			"pluginID", pluginID,
			"pid", pid,
		)
		killed++
	}

	if killed > 0 {
		logger.Infow("cleaned up stale plugin processes", "count", killed)
	}
}
