package devserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func newTestManager(t *testing.T) *DevServerManager {
	t.Helper()
	svc := appstate.NewTestService(t)
	return NewDevServerManager(logging.NewNop(), svc.RootDir(), svc.Plugins(), nil, nil,
		pkgsettings.NewProvider(pkgsettings.ProviderOpts{Logger: nil, PluginSettings: nil, PluginID: ""}))
}

func TestManager_StartupFailureRetainsOutputAfterCleanup(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX executable fixture")
	}
	mgr := newTestManager(t)
	mgr.ctx = context.Background()
	mgr.settingsProvider = nil
	source := managedSourceFixture(t, "install-failure")
	require.NoError(t, os.MkdirAll(filepath.Join(source, "ui"), 0700))
	tools := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(tools, "pnpm"), []byte("#!/bin/sh\nprintf 'dependency resolution failed: incompatible peer\\n' >&2\nexit 1\n"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(tools, "node"), []byte("#!/bin/sh\nexit 0\n"), 0700))
	t.Setenv("PATH", tools+string(os.PathListSeparator)+os.Getenv("PATH"))

	_, err := mgr.StartDevServerForPath("install-failure", source)
	require.Error(t, err)
	require.False(t, mgr.IsManaged("install-failure"))
	require.Empty(t, mgr.GetDevServerLogs("install-failure", 200))
	var startup *StartupError
	require.ErrorAs(t, err, &startup)
	var output strings.Builder
	for _, entry := range startup.Logs {
		output.WriteString(entry.Message)
	}
	require.Contains(t, output.String(), "dependency resolution failed: incompatible peer")
}

func TestNewDevServerManager(t *testing.T) {
	mgr := newTestManager(t)
	require.NotNil(t, mgr)
	assert.NotNil(t, mgr.instances)
	assert.NotNil(t, mgr.ports)
}

func TestManager_IsManaged_NoInstances(t *testing.T) {
	mgr := newTestManager(t)
	assert.False(t, mgr.IsManaged("nonexistent"))
}

func TestManager_IsManaged_WithInstance(t *testing.T) {
	mgr := newTestManager(t)

	mgr.mu.Lock()
	mgr.instances["test-plugin"] = &DevServerInstance{pluginID: "test-plugin"}
	mgr.mu.Unlock()

	assert.True(t, mgr.IsManaged("test-plugin"))
	assert.False(t, mgr.IsManaged("other-plugin"))
}

func TestManager_GetDevServerState_NoInstance(t *testing.T) {
	mgr := newTestManager(t)

	state := mgr.GetDevServerState("nonexistent")
	assert.Equal(t, "nonexistent", state.PluginID)
	assert.Equal(t, DevServerModeIdle, state.Mode)
}

func TestManager_ListDevServerStates_Empty(t *testing.T) {
	mgr := newTestManager(t)
	states := mgr.ListDevServerStates()
	assert.Empty(t, states)
}

func TestManager_ListDevServerStates_WithInstances(t *testing.T) {
	mgr := newTestManager(t)

	// Insert instances with known state.
	ctx := context.Background()
	noop := func(string, DevServerState) {}
	noopLogs := func(string, []LogEntry) {}
	noopErrors := func(string, []BuildError) {}

	inst := NewDevServerInstance(
		ctx, logging.NewNop(), "plugin-a", "/dev/path", 15173, BuildOpts{}, nil, nil, noop, noopLogs, noopErrors,
	)

	mgr.mu.Lock()
	mgr.instances["plugin-a"] = inst
	mgr.mu.Unlock()

	states := mgr.ListDevServerStates()
	require.Len(t, states, 1)
	assert.Equal(t, "plugin-a", states[0].PluginID)
	assert.Equal(t, DevServerModeManaged, states[0].Mode)
}

func TestManager_GetDevServerLogs_NoInstance(t *testing.T) {
	mgr := newTestManager(t)
	logs := mgr.GetDevServerLogs("nonexistent", 10)
	assert.Nil(t, logs)
}

func TestManager_GetDevServerLogs_WithInstance(t *testing.T) {
	mgr := newTestManager(t)

	ctx := context.Background()
	noop := func(string, DevServerState) {}
	noopLogs := func(string, []LogEntry) {}
	noopErrors := func(string, []BuildError) {}

	inst := NewDevServerInstance(
		ctx, logging.NewNop(), "plugin-a", "/dev/path", 15173, BuildOpts{}, nil, nil, noop, noopLogs, noopErrors,
	)
	inst.appendLog(LogEntry{
		Message: "build started", Source: "go-build", Level: "info", Timestamp: time.Now().Format(time.RFC3339),
	})
	inst.appendLog(LogEntry{
		Message: "build complete", Source: "go-build", Level: "info", Timestamp: time.Now().Format(time.RFC3339),
	})

	mgr.mu.Lock()
	mgr.instances["plugin-a"] = inst
	mgr.mu.Unlock()

	logs := mgr.GetDevServerLogs("plugin-a", 10)
	require.Len(t, logs, 2)
	assert.Equal(t, "build started", logs[0].Message)
	assert.Equal(t, "build complete", logs[1].Message)

	// Test with count smaller than total.
	logs = mgr.GetDevServerLogs("plugin-a", 1)
	require.Len(t, logs, 1)
	assert.Equal(t, "build complete", logs[0].Message)
}

func TestManager_ServiceShutdown_NoInstances(t *testing.T) {
	mgr := newTestManager(t)
	// Should not panic when there are no instances or watcher.
	_ = mgr.ServiceShutdown()
}

// ============================================================================
// New tests: error paths and coordination
// ============================================================================

func TestManager_StopDevServer_NotRunning(t *testing.T) {
	mgr := newTestManager(t)

	err := mgr.StopDevServer("nonexistent-plugin")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Title, "No dev server running")
}

func TestManager_StartDevServer_AlreadyRunning(t *testing.T) {
	mgr := newTestManager(t)
	source := managedSourceFixture(t, "same")
	inst, _, _ := newTestInstance(t, "same")
	inst.devPath = source
	mgr.instances["same"] = inst
	mgr.pluginRef = &mockPluginRef{devMode: true, devPath: source}
	state, err := mgr.StartDevServer("same")
	require.NoError(t, err)
	assert.Equal(t, inst.generation, state.Generation)
	assert.Zero(t, mgr.ports.GetPort("same"))
}

func TestManager_StartDevServer_PluginNotFound(t *testing.T) {
	mgr := newTestManager(t)
	mgr.pluginRef = &mockPluginRef{err: errors.New("not found")}

	_, err := mgr.StartDevServer("missing")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
	assert.Contains(t, appErr.Detail, "missing")
}

func TestManager_StartDevServer_NotDevMode(t *testing.T) {
	mgr := newTestManager(t)
	mgr.pluginRef = &mockPluginRef{devMode: false, devPath: "/some/path"}

	_, err := mgr.StartDevServer("non-dev")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
}

func TestManager_StartDevServer_EmptyDevPath(t *testing.T) {
	mgr := newTestManager(t)
	mgr.pluginRef = &mockPluginRef{devMode: true, devPath: ""}

	_, err := mgr.StartDevServer("empty-path")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Title, "Missing dev path")
}

func TestManager_ServiceShutdown_WithInstances(t *testing.T) {
	mgr := newTestManager(t)

	// Create instances with no-op callbacks. These have nil vite/goWatcher
	// so Stop() is safe.
	noop := func(string, DevServerState) {}
	noopLogs := func(string, []LogEntry) {}
	noopErrors := func(string, []BuildError) {}

	inst1 := NewDevServerInstance(
		context.Background(), logging.NewNop(),
		"plugin-1", "/p1", 15173, BuildOpts{}, nil, nil,
		noop, noopLogs, noopErrors,
	)
	inst2 := NewDevServerInstance(
		context.Background(), logging.NewNop(),
		"plugin-2", "/p2", 15174, BuildOpts{}, nil, nil,
		noop, noopLogs, noopErrors,
	)

	mgr.mu.Lock()
	mgr.instances["plugin-1"] = inst1
	mgr.instances["plugin-2"] = inst2
	mgr.mu.Unlock()

	// Shutdown should stop all instances and not panic.
	_ = mgr.ServiceShutdown()

	// After shutdown, instances should be removed.
	mgr.mu.RLock()
	assert.Empty(t, mgr.instances)
	mgr.mu.RUnlock()
}

func TestManager_GetDevServerState_WithInstance(t *testing.T) {
	mgr := newTestManager(t)

	noop := func(string, DevServerState) {}
	noopLogs := func(string, []LogEntry) {}
	noopErrors := func(string, []BuildError) {}

	inst := NewDevServerInstance(
		context.Background(), logging.NewNop(),
		"state-plug", "/dev/path", 15180, BuildOpts{}, nil, nil,
		noop, noopLogs, noopErrors,
	)
	// Simulate the instance being in a running state.
	inst.mu.Lock()
	inst.viteStatus = DevProcessStatusReady
	inst.goStatus = DevProcessStatusReady
	inst.mu.Unlock()

	mgr.mu.Lock()
	mgr.instances["state-plug"] = inst
	mgr.mu.Unlock()

	state := mgr.GetDevServerState("state-plug")
	assert.Equal(t, "state-plug", state.PluginID)
	assert.Equal(t, DevServerModeManaged, state.Mode)
	assert.Equal(t, DevProcessStatusReady, state.ViteStatus)
	assert.Equal(t, DevProcessStatusReady, state.GoStatus)
	assert.Equal(t, 15180, state.VitePort)
	assert.Equal(t, "http://127.0.0.1:15180", state.ViteURL)
}

func TestManager_ResolveBuildOpts(t *testing.T) {
	mgr := newTestManager(t)
	opts := mgr.resolveBuildOpts()
	goPath, _ := exec.LookPath("go")
	pnpmPath, _ := exec.LookPath("pnpm")
	nodePath, _ := exec.LookPath("node")
	assert.Equal(t, goPath, opts.GoPath)
	assert.Equal(t, pnpmPath, opts.PnpmPath)
	assert.Equal(t, nodePath, opts.NodePath)
	assert.Equal(t, mgr.stateRoot.ResolvePath(""), opts.StateRoot)
}

func TestManager_EmitStatus_NilCtx(t *testing.T) {
	mgr := newTestManager(t)
	// ctx is nil by default (no Initialize called).
	// emitStatus should be a no-op, not panic.
	mgr.emitStatus("test", DevServerState{})
}

func TestManager_EmitLogs_NilCtx(t *testing.T) {
	mgr := newTestManager(t)
	mgr.emitLogs("test", []LogEntry{{Message: "hello"}})
	// No panic = success.
}

func TestManager_EmitErrors_NilCtx(t *testing.T) {
	mgr := newTestManager(t)
	mgr.emitErrors("test", []BuildError{{Message: "err"}})
	// No panic = success.
}

func TestManager_EmitLogs_EmptyEntries(t *testing.T) {
	mgr := newTestManager(t)
	mgr.ctx = context.Background()
	// Empty entries should be a no-op (early return before EventsEmit).
	mgr.emitLogs("test", nil)
	mgr.emitLogs("test", []LogEntry{})
}

func TestManager_EmitErrors_EmptyErrors(t *testing.T) {
	mgr := newTestManager(t)
	mgr.ctx = context.Background()
	// Empty errors should be a no-op.
	mgr.emitErrors("test", nil)
	mgr.emitErrors("test", []BuildError{})
}

func TestManager_StartDevServer_PortExhaustion(t *testing.T) {
	mgr := newTestManager(t)
	source := managedSourceFixture(t, "new-plugin")
	mgr.pluginRef = &mockPluginRef{devMode: true, devPath: source}
	for port := PortRangeStart; port < PortRangeEnd; port++ {
		mgr.ports.assigned[port] = fmt.Sprint(port)
	}
	_, err := mgr.StartDevServer("new-plugin")
	require.ErrorContains(t, err, "no free managed Vite port")
}

func TestManager_RestartDevServer_NotRunning(t *testing.T) {
	mgr := newTestManager(t)
	mgr.pluginRef = &mockPluginRef{err: errors.New("not found")}

	// Restart when not running: Stop returns error (ignored), Start returns error.
	_, err := mgr.RestartDevServer("missing")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

// ============================================================================
// RebuildPlugin tests
// ============================================================================

func TestManager_RebuildPlugin_NotRunning(t *testing.T) {
	mgr := newTestManager(t)

	err := mgr.RebuildPlugin("nonexistent-plugin")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Title, "No dev server running")
}

func TestManager_RebuildPlugin_WithInstance(t *testing.T) {
	mgr := newTestManager(t)

	// Create an instance with a nil goWatcher — TriggerRebuild is a no-op.
	noop := func(string, DevServerState) {}
	noopLogs := func(string, []LogEntry) {}
	noopErrors := func(string, []BuildError) {}
	inst := NewDevServerInstance(
		context.Background(), logging.NewNop(),
		"rebuild-plugin", "/dev/path", 15173, BuildOpts{}, nil, nil,
		noop, noopLogs, noopErrors,
	)

	mgr.mu.Lock()
	mgr.instances["rebuild-plugin"] = inst
	mgr.mu.Unlock()

	// Should succeed (TriggerRebuild is no-op with nil goWatcher, but no error).
	err := mgr.RebuildPlugin("rebuild-plugin")
	assert.NoError(t, err)
}

// ============================================================================
// StartDevServerForPath tests
// ============================================================================

func TestManager_StartDevServerForPath_EmptyPath(t *testing.T) {
	mgr := newTestManager(t)

	_, err := mgr.StartDevServerForPath("test-plugin", "")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Title, "Missing dev path")
}

func TestManager_StartDevServerForPath_AlreadyRunning(t *testing.T) {
	mgr := newTestManager(t)
	sourceA := managedSourceFixture(t, "same")
	sourceB := managedSourceFixture(t, "same")
	inst, _, _ := newTestInstance(t, "same")
	inst.devPath = sourceA
	mgr.instances["same"] = inst
	_, err := mgr.StartDevServerForPath("same", sourceB)
	require.ErrorContains(t, err, "stop/unload")
	assert.Equal(t, sourceA, mgr.GetDevServerState("same").DevPath)
}

func TestManager_StartDevServerForPath_PortExhaustion(t *testing.T) {
	mgr := newTestManager(t)
	source := managedSourceFixture(t, "new-plugin")
	for port := PortRangeStart; port < PortRangeEnd; port++ {
		mgr.ports.assigned[port] = fmt.Sprint(port)
	}
	_, err := mgr.StartDevServerForPath("new-plugin", source)
	require.ErrorContains(t, err, "no free managed Vite port")
}
