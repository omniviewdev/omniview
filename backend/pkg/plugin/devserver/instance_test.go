package devserver

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewDevServerInstance(t *testing.T) {
	inst, sr, _, _ := newTestInstance(t, "test-plugin")

	assert.Equal(t, "test-plugin", inst.pluginID)
	assert.Equal(t, 15173, inst.vitePort)
	assert.Equal(t, DevServerModeManaged, inst.mode)
	assert.Equal(t, DevProcessStatusIdle, inst.viteStatus)
	assert.Equal(t, DevProcessStatusIdle, inst.goStatus)
	assert.NotNil(t, inst.logBuffer)
	assert.NotNil(t, inst.ctx)
	assert.NotNil(t, inst.cancel)
	assert.Nil(t, inst.vite)
	assert.Nil(t, inst.goWatcher)
	// No callbacks should have fired during construction.
	assert.Equal(t, 0, sr.count())
}

func TestInstance_State(t *testing.T) {
	inst, _, _, _ := newTestInstance(t, "state-plugin")

	state := inst.State()
	assert.Equal(t, "state-plugin", state.PluginID)
	assert.Equal(t, DevServerModeManaged, state.Mode)
	assert.Equal(t, DevProcessStatusIdle, state.ViteStatus)
	assert.Equal(t, DevProcessStatusIdle, state.GoStatus)
	assert.Equal(t, 15173, state.VitePort)
	assert.Empty(t, state.ViteURL) // idle → no URL
	assert.Empty(t, state.LastError)
	assert.False(t, state.GRPCConnected)
}

func TestInstance_State_ViteURLWhenReady(t *testing.T) {
	inst, _, _, _ := newTestInstance(t, "url-plugin")

	// Manually set vite status to ready.
	inst.mu.Lock()
	inst.viteStatus = DevProcessStatusReady
	inst.mu.Unlock()

	state := inst.State()
	assert.Equal(t, "http://127.0.0.1:15173", state.ViteURL)
}

func TestInstance_SetViteStatus(t *testing.T) {
	inst, sr, _, _ := newTestInstance(t, "vite-status")

	inst.setViteStatus(DevProcessStatusStarting)
	assert.Equal(t, DevProcessStatusStarting, inst.State().ViteStatus)
	require.Equal(t, 1, sr.count())
	assert.Equal(t, "vite-status", sr.last().pluginID)
	assert.Equal(t, DevProcessStatusStarting, sr.last().state.ViteStatus)
}

func TestInstance_SetGoStatus(t *testing.T) {
	inst, sr, _, _ := newTestInstance(t, "go-status")

	inst.setGoStatus(DevProcessStatusBuilding)
	assert.Equal(t, DevProcessStatusBuilding, inst.State().GoStatus)
	require.Equal(t, 1, sr.count())
	assert.Equal(t, "go-status", sr.last().pluginID)
	assert.Equal(t, DevProcessStatusBuilding, sr.last().state.GoStatus)
}

func TestInstance_SetBuildResult_WithError(t *testing.T) {
	inst, sr, _, _ := newTestInstance(t, "build-err")

	dur := 2 * time.Second
	inst.setBuildResult(dur, "compile error: undefined Foo")

	state := inst.State()
	assert.Equal(t, dur, state.LastBuildDuration)
	assert.Equal(t, "compile error: undefined Foo", state.LastError)
	assert.False(t, state.GRPCConnected) // error → grpc not connected
	assert.False(t, state.LastBuildTime.IsZero())
	require.Equal(t, 1, sr.count())
}

func TestInstance_SetBuildResult_Success(t *testing.T) {
	inst, sr, _, _ := newTestInstance(t, "build-ok")

	// Set an initial error to verify it gets cleared.
	inst.setLastError("old error")

	dur := 500 * time.Millisecond
	inst.setBuildResult(dur, "")

	state := inst.State()
	assert.Equal(t, dur, state.LastBuildDuration)
	assert.Empty(t, state.LastError)
	assert.True(t, state.GRPCConnected) // success → grpc connected
	assert.False(t, state.LastBuildTime.IsZero())
	// 1 call from setBuildResult (setLastError doesn't emit status)
	require.Equal(t, 1, sr.count())
}

func TestInstance_AppendLog(t *testing.T) {
	inst, _, lr, _ := newTestInstance(t, "log-test")

	entry := LogEntry{
		Source:  "vite",
		Level:   "info",
		Message: "server started",
	}
	inst.appendLog(entry)

	require.Equal(t, 1, lr.count())
	last := lr.last()
	assert.Equal(t, "log-test", last.pluginID)
	require.Len(t, last.entries, 1)
	assert.Equal(t, "server started", last.entries[0].Message)
	assert.Equal(t, "log-test", last.entries[0].PluginID) // pluginID injected
	assert.False(t, last.entries[0].Timestamp.IsZero())    // timestamp set
}

func TestInstance_AppendLog_PreservesTimestamp(t *testing.T) {
	inst, _, lr, _ := newTestInstance(t, "log-ts")

	fixedTime := time.Date(2025, 6, 15, 12, 0, 0, 0, time.UTC)
	inst.appendLog(LogEntry{
		Source:    "go-build",
		Level:     "info",
		Message:   "build ok",
		Timestamp: fixedTime,
	})

	require.Equal(t, 1, lr.count())
	assert.Equal(t, fixedTime, lr.last().entries[0].Timestamp)
}

func TestInstance_GetLogs(t *testing.T) {
	inst, _, _, _ := newTestInstance(t, "getlogs")

	// Add multiple entries.
	for i := 0; i < 5; i++ {
		inst.appendLog(LogEntry{
			Source:  "vite",
			Level:   "info",
			Message: time.Now().String(),
		})
	}

	// Get all.
	all := inst.GetLogs(0)
	assert.Len(t, all, 5)

	// Get last 3.
	last3 := inst.GetLogs(3)
	assert.Len(t, last3, 3)
	// last3 should be the 3 most recent (same as the last 3 of all).
	assert.Equal(t, all[2].Message, last3[0].Message)
	assert.Equal(t, all[4].Message, last3[2].Message)

	// Count exceeding total returns all.
	overCount := inst.GetLogs(100)
	assert.Len(t, overCount, 5)
}

func TestInstance_GetLogs_Empty(t *testing.T) {
	inst, _, _, _ := newTestInstance(t, "empty-logs")

	// Last(n) with 0 entries → empty slice.
	logs := inst.GetLogs(10)
	assert.Empty(t, logs)

	// Entries() with 0 entries → empty slice.
	all := inst.GetLogs(0)
	assert.Empty(t, all)
}

func TestInstance_Stop_NotRunning(t *testing.T) {
	inst, sr, _, _ := newTestInstance(t, "stop-idle")

	// Stop with no Vite/GoWatcher started should not panic.
	inst.Stop()

	state := inst.State()
	assert.Equal(t, DevProcessStatusStopped, state.ViteStatus)
	assert.Equal(t, DevProcessStatusStopped, state.GoStatus)
	// setViteStatus + setGoStatus = 2 callbacks.
	assert.Equal(t, 2, sr.count())
}

func TestInstance_Stop_WithSubProcesses(t *testing.T) {
	inst, sr, _, _ := newTestInstance(t, "stop-procs")

	// Attach a viteProcess with nil cmd — viteProcess.Stop() returns early when cmd is nil.
	inst.vite = &viteProcess{
		done: make(chan struct{}),
	}

	// Attach a goWatcherProcess with closed done channel — Stop() returns immediately.
	ctx, cancel := context.WithCancel(context.Background())
	doneCh := make(chan struct{})
	close(doneCh) // pre-close so Stop doesn't block
	inst.goWatcher = &goWatcherProcess{
		cancel: cancel,
		ctx:    ctx,
		done:   doneCh,
	}

	inst.Stop()

	state := inst.State()
	assert.Equal(t, DevProcessStatusStopped, state.ViteStatus)
	assert.Equal(t, DevProcessStatusStopped, state.GoStatus)
	assert.GreaterOrEqual(t, sr.count(), 2)
}

func TestInstance_StateTransitions(t *testing.T) {
	tests := []struct {
		name       string
		viteStatus DevProcessStatus
		goStatus   DevProcessStatus
	}{
		{"both idle", DevProcessStatusIdle, DevProcessStatusIdle},
		{"vite starting, go idle", DevProcessStatusStarting, DevProcessStatusIdle},
		{"both ready", DevProcessStatusReady, DevProcessStatusReady},
		{"vite ready, go building", DevProcessStatusReady, DevProcessStatusBuilding},
		{"vite error, go ready", DevProcessStatusError, DevProcessStatusReady},
		{"both stopped", DevProcessStatusStopped, DevProcessStatusStopped},
		{"vite running, go error", DevProcessStatusRunning, DevProcessStatusError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inst, _, _, _ := newTestInstance(t, "transitions")
			inst.setViteStatus(tt.viteStatus)
			inst.setGoStatus(tt.goStatus)

			state := inst.State()
			assert.Equal(t, tt.viteStatus, state.ViteStatus)
			assert.Equal(t, tt.goStatus, state.GoStatus)
			assert.Equal(t, DevServerModeManaged, state.Mode)
		})
	}
}
