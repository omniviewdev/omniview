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

	"github.com/omniviewdev/omniview/internal/appstate"
)

func TestPluginPIDTracker_RecordAndRemove(t *testing.T) {
	svc := appstate.NewTestService(t)
	tracker := NewPluginPIDTracker(svc.RootDir())

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
	svc := appstate.NewTestService(t)
	tracker := NewPluginPIDTracker(svc.RootDir())
	tracker.Record("aws", 12345)
	tracker.Record("kubernetes", 67890)

	// Save via the real method
	require.NoError(t, tracker.Save())

	// Read the file back and verify contents
	raw, err := svc.RootDir().ReadFile(pluginPIDFileName)
	require.NoError(t, err)

	var loaded map[string]int
	require.NoError(t, json.Unmarshal(raw, &loaded))

	assert.Equal(t, 12345, loaded["aws"])
	assert.Equal(t, 67890, loaded["kubernetes"])
}

func TestPluginPIDTracker_CleanupStale_KillsProcesses(t *testing.T) {
	svc := appstate.NewTestService(t)

	// Spawn a real sleep process to kill
	cmd := exec.Command("sleep", "300")
	require.NoError(t, cmd.Start())
	pid := cmd.Process.Pid

	// Verify it's alive
	require.NoError(t, syscall.Kill(pid, 0))

	// Write a PID file pointing at this process.
	data := map[string]int{"test-plugin": pid}
	b, err := json.Marshal(data)
	require.NoError(t, err)
	require.NoError(t, svc.RootDir().WriteFile(pluginPIDFileName, b, 0644))

	logger := testLogger(t)
	tracker := NewPluginPIDTracker(svc.RootDir())
	tracker.CleanupStale(logger)

	// Reap the zombie -- our test process is the parent, so we must Wait()
	// before the kernel removes the process table entry.
	_ = cmd.Wait()

	// Verify the process is dead
	err = syscall.Kill(pid, 0)
	assert.ErrorIs(t, err, syscall.ESRCH, "process should be dead after cleanup")

	// Verify the PID file was removed
	_, err = svc.RootDir().Stat(pluginPIDFileName)
	assert.True(t, os.IsNotExist(err), "PID file should be removed after cleanup")
}

func TestPluginPIDTracker_CleanupStale_NoFile(t *testing.T) {
	svc := appstate.NewTestService(t)

	logger := testLogger(t)
	tracker := NewPluginPIDTracker(svc.RootDir())

	// Should not panic or error
	tracker.CleanupStale(logger)
}

func TestPluginPIDTracker_CleanupStale_DeadProcess(t *testing.T) {
	svc := appstate.NewTestService(t)

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
	require.NoError(t, svc.RootDir().WriteFile(pluginPIDFileName, b, 0644))

	logger := testLogger(t)
	tracker := NewPluginPIDTracker(svc.RootDir())

	// Should handle ESRCH gracefully
	tracker.CleanupStale(logger)

	// Verify the PID file was removed
	_, err = svc.RootDir().Stat(pluginPIDFileName)
	assert.True(t, os.IsNotExist(err), "PID file should be removed after cleanup")
}
