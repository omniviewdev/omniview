//go:build !windows

package plugin

import (
	"encoding/json"
	"os"
	"os/exec"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func testLogger(t *testing.T) *zap.SugaredLogger {
	t.Helper()
	logger, _ := zap.NewDevelopment()
	return logger.Sugar()
}

func TestPluginPIDTracker_RecordAndRemove(t *testing.T) {
	tracker := NewPluginPIDTracker()

	tracker.Record("aws", 1234)
	tracker.Record("kubernetes", 5678)

	tracker.mu.Lock()
	assert.Equal(t, 1234, tracker.pids["aws"])
	assert.Equal(t, 5678, tracker.pids["kubernetes"])
	tracker.mu.Unlock()

	// Update existing entry
	tracker.Record("aws", 9999)
	tracker.mu.Lock()
	assert.Equal(t, 9999, tracker.pids["aws"])
	tracker.mu.Unlock()

	// Remove
	tracker.Remove("aws")
	tracker.mu.Lock()
	_, exists := tracker.pids["aws"]
	assert.False(t, exists)
	assert.Equal(t, 5678, tracker.pids["kubernetes"])
	tracker.mu.Unlock()

	// Remove non-existent is a no-op
	tracker.Remove("nonexistent")
}

func TestPluginPIDTracker_SaveAndLoad(t *testing.T) {
	tracker := NewPluginPIDTracker()
	tracker.Record("aws", 12345)
	tracker.Record("kubernetes", 67890)

	// Save via the real method
	require.NoError(t, tracker.Save())
	defer os.Remove(pluginPIDFilePath())

	// Read the file back and verify contents
	raw, err := os.ReadFile(pluginPIDFilePath())
	require.NoError(t, err)

	var loaded map[string]int
	require.NoError(t, json.Unmarshal(raw, &loaded))

	assert.Equal(t, 12345, loaded["aws"])
	assert.Equal(t, 67890, loaded["kubernetes"])
}

func TestPluginPIDTracker_CleanupStale_KillsProcesses(t *testing.T) {
	// Spawn a real sleep process to kill
	cmd := exec.Command("sleep", "300")
	require.NoError(t, cmd.Start())
	pid := cmd.Process.Pid

	// Verify it's alive
	require.NoError(t, syscall.Kill(pid, 0))

	// Write a PID file pointing at this process to the real path.
	realPidFile := pluginPIDFilePath()
	data := map[string]int{"test-plugin": pid}
	b, err := json.Marshal(data)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(realPidFile, b, 0644))

	logger := testLogger(t)
	tracker := NewPluginPIDTracker()
	tracker.CleanupStale(logger)

	// Reap the zombie — our test process is the parent, so we must Wait()
	// before the kernel removes the process table entry.
	_ = cmd.Wait()

	// Verify the process is dead
	err = syscall.Kill(pid, 0)
	assert.ErrorIs(t, err, syscall.ESRCH, "process should be dead after cleanup")

	// Verify the PID file was removed
	_, err = os.Stat(realPidFile)
	assert.True(t, os.IsNotExist(err), "PID file should be removed after cleanup")
}

func TestPluginPIDTracker_CleanupStale_NoFile(t *testing.T) {
	// Ensure no PID file exists
	_ = os.Remove(pluginPIDFilePath())

	logger := testLogger(t)
	tracker := NewPluginPIDTracker()

	// Should not panic or error
	tracker.CleanupStale(logger)
}

func TestPluginPIDTracker_CleanupStale_DeadProcess(t *testing.T) {
	// Spawn a process and kill it immediately so the PID is dead
	cmd := exec.Command("sleep", "300")
	require.NoError(t, cmd.Start())
	pid := cmd.Process.Pid
	require.NoError(t, cmd.Process.Kill())
	_ = cmd.Wait()

	// Verify it's dead
	err := syscall.Kill(pid, 0)
	require.ErrorIs(t, err, syscall.ESRCH)

	// Write a PID file with this dead PID
	data := map[string]int{"dead-plugin": pid}
	b, marshalErr := json.Marshal(data)
	require.NoError(t, marshalErr)

	realPidFile := pluginPIDFilePath()
	require.NoError(t, os.WriteFile(realPidFile, b, 0644))

	logger := testLogger(t)
	tracker := NewPluginPIDTracker()

	// Should handle ESRCH gracefully
	tracker.CleanupStale(logger)

	// Verify the PID file was removed
	_, err = os.Stat(realPidFile)
	assert.True(t, os.IsNotExist(err), "PID file should be removed after cleanup")
}
