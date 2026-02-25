package devserver

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// mockSettingsProvider satisfies pkgsettings.Provider for testing.
type mockSettingsProvider struct{}

var _ pkgsettings.Provider = (*mockSettingsProvider)(nil)

func (m *mockSettingsProvider) Initialize(_ context.Context, _ ...pkgsettings.Category) error {
	return nil
}
func (m *mockSettingsProvider) LoadSettings() error                         { return nil }
func (m *mockSettingsProvider) SaveSettings() error                         { return nil }
func (m *mockSettingsProvider) ListSettings() pkgsettings.Store             { return nil }
func (m *mockSettingsProvider) Values() map[string]any                      { return nil }
func (m *mockSettingsProvider) GetSetting(string) (pkgsettings.Setting, error) {
	return pkgsettings.Setting{}, nil
}
func (m *mockSettingsProvider) GetSettingValue(string) (any, error)   { return nil, nil }
func (m *mockSettingsProvider) SetSetting(string, any) error          { return nil }
func (m *mockSettingsProvider) SetSettings(map[string]any) error      { return nil }
func (m *mockSettingsProvider) ResetSetting(string) error             { return nil }
func (m *mockSettingsProvider) RegisterSetting(string, pkgsettings.Setting) error {
	return nil
}
func (m *mockSettingsProvider) RegisterSettings(string, ...pkgsettings.Setting) error {
	return nil
}
func (m *mockSettingsProvider) GetCategories() []pkgsettings.Category { return nil }
func (m *mockSettingsProvider) GetCategory(string) (pkgsettings.Category, error) {
	return pkgsettings.Category{}, nil
}
func (m *mockSettingsProvider) GetCategoryValues(string) (map[string]interface{}, error) {
	return nil, nil
}
func (m *mockSettingsProvider) GetString(string) (string, error)       { return "", nil }
func (m *mockSettingsProvider) GetStringSlice(string) ([]string, error) { return nil, nil }
func (m *mockSettingsProvider) GetInt(string) (int, error)             { return 0, nil }
func (m *mockSettingsProvider) GetIntSlice(string) ([]int, error)      { return nil, nil }
func (m *mockSettingsProvider) GetFloat(string) (float64, error)       { return 0, nil }
func (m *mockSettingsProvider) GetFloatSlice(string) ([]float64, error) { return nil, nil }
func (m *mockSettingsProvider) GetBool(string) (bool, error)           { return false, nil }

func newTestManager(t *testing.T) *DevServerManager {
	t.Helper()
	logger := zap.NewNop().Sugar()
	return NewDevServerManager(logger, nil, nil, &mockSettingsProvider{})
}

func TestNewDevServerManager(t *testing.T) {
	mgr := newTestManager(t)
	require.NotNil(t, mgr)
	assert.NotNil(t, mgr.instances)
	assert.NotNil(t, mgr.ports)
	assert.Nil(t, mgr.externalWatcher)
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

func TestManager_IsManaged_WithExternalWatcher(t *testing.T) {
	mgr := newTestManager(t)

	// Manually set up an external watcher with a connected plugin.
	mgr.externalWatcher = &ExternalWatcher{
		connections: map[string]*ExternalConnection{
			"ext-plugin": {
				DevInfo:   &DevInfoFile{PID: 12345, Addr: "127.0.0.1:50051"},
				Connected: true,
			},
		},
	}

	assert.True(t, mgr.IsManaged("ext-plugin"))
	assert.False(t, mgr.IsManaged("nonexistent"))
}

func TestManager_IsManaged_ExternalDisconnected(t *testing.T) {
	mgr := newTestManager(t)

	mgr.externalWatcher = &ExternalWatcher{
		connections: map[string]*ExternalConnection{
			"ext-plugin": {
				DevInfo:   &DevInfoFile{PID: 12345, Addr: "127.0.0.1:50051"},
				Connected: false,
			},
		},
	}

	// Disconnected external plugins should NOT report as managed.
	assert.False(t, mgr.IsManaged("ext-plugin"))
}

func TestManager_GetDevServerState_NoInstance(t *testing.T) {
	mgr := newTestManager(t)

	state := mgr.GetDevServerState("nonexistent")
	assert.Equal(t, "nonexistent", state.PluginID)
	assert.Equal(t, DevServerModeIdle, state.Mode)
}

func TestManager_GetExternalPluginInfo_NilWatcher(t *testing.T) {
	mgr := newTestManager(t)
	assert.Nil(t, mgr.GetExternalPluginInfo("test"))
}

func TestManager_GetExternalPluginInfo_WithConnection(t *testing.T) {
	mgr := newTestManager(t)
	info := &DevInfoFile{PID: 12345, Addr: "127.0.0.1:50051", VitePort: 15173}

	mgr.externalWatcher = &ExternalWatcher{
		connections: map[string]*ExternalConnection{
			"test-plugin": {DevInfo: info, Connected: true},
		},
	}

	result := mgr.GetExternalPluginInfo("test-plugin")
	require.NotNil(t, result)
	assert.Equal(t, 12345, result.PID)
	assert.Equal(t, "127.0.0.1:50051", result.Addr)
	assert.Equal(t, 15173, result.VitePort)

	// Non-existent plugin returns nil.
	assert.Nil(t, mgr.GetExternalPluginInfo("nonexistent"))
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

	inst := NewDevServerInstance(ctx, zap.NewNop().Sugar(), "plugin-a", "/dev/path", 15173, BuildOpts{}, nil, noop, noopLogs, noopErrors)

	mgr.mu.Lock()
	mgr.instances["plugin-a"] = inst
	mgr.mu.Unlock()

	states := mgr.ListDevServerStates()
	require.Len(t, states, 1)
	assert.Equal(t, "plugin-a", states[0].PluginID)
	assert.Equal(t, DevServerModeManaged, states[0].Mode)
}

func TestManager_ListDevServerStates_IncludesExternal(t *testing.T) {
	mgr := newTestManager(t)

	mgr.externalWatcher = &ExternalWatcher{
		connections: map[string]*ExternalConnection{
			"ext-plugin": {
				DevInfo:   &DevInfoFile{PID: 99, Addr: "127.0.0.1:50051", VitePort: 15173},
				Connected: true,
			},
			"ext-disconnected": {
				DevInfo:   &DevInfoFile{PID: 100, Addr: "127.0.0.1:50052"},
				Connected: false,
			},
		},
	}

	states := mgr.ListDevServerStates()
	// Only connected external plugins should appear.
	require.Len(t, states, 1)
	assert.Equal(t, "ext-plugin", states[0].PluginID)
	assert.Equal(t, DevServerModeExternal, states[0].Mode)
	assert.True(t, states[0].GRPCConnected)
	assert.Equal(t, 15173, states[0].VitePort)
	assert.Equal(t, "http://127.0.0.1:15173", states[0].ViteURL)
	assert.Equal(t, DevProcessStatusReady, states[0].ViteStatus)
}

func TestManager_ListDevServerStates_ExternalNoVitePort(t *testing.T) {
	mgr := newTestManager(t)

	mgr.externalWatcher = &ExternalWatcher{
		connections: map[string]*ExternalConnection{
			"go-only-plugin": {
				DevInfo:   &DevInfoFile{PID: 99, Addr: "127.0.0.1:50051", VitePort: 0},
				Connected: true,
			},
		},
	}

	states := mgr.ListDevServerStates()
	require.Len(t, states, 1)
	assert.Equal(t, DevProcessStatus(""), states[0].ViteStatus)
	assert.Equal(t, "", states[0].ViteURL)
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

	inst := NewDevServerInstance(ctx, zap.NewNop().Sugar(), "plugin-a", "/dev/path", 15173, BuildOpts{}, nil, noop, noopLogs, noopErrors)
	inst.appendLog(LogEntry{Message: "build started", Source: "go-build", Level: "info", Timestamp: time.Now()})
	inst.appendLog(LogEntry{Message: "build complete", Source: "go-build", Level: "info", Timestamp: time.Now()})

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

func TestManager_Shutdown_NoInstances(t *testing.T) {
	mgr := newTestManager(t)
	// Should not panic when there are no instances or watcher.
	mgr.Shutdown()
}

func TestManager_HandleExternalConnect(t *testing.T) {
	mgr := newTestManager(t)

	info := &DevInfoFile{PID: 12345, Addr: "127.0.0.1:50051", VitePort: 15173}
	// handleExternalConnect calls emitStatus which checks m.ctx.
	// With nil ctx, emitStatus is a no-op, which is fine for this test.
	mgr.handleExternalConnect("test-plugin", info)
	// No panic = success. The method just logs and emits events.
}

func TestManager_HandleExternalDisconnect(t *testing.T) {
	mgr := newTestManager(t)
	mgr.handleExternalDisconnect("test-plugin")
	// No panic = success.
}

// ============================================================================
// New tests: error paths and coordination
// ============================================================================

func TestManager_StopDevServer_NotRunning(t *testing.T) {
	mgr := newTestManager(t)

	err := mgr.StopDevServer("nonexistent-plugin")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Title, "No dev server running")
}

func TestManager_StartDevServer_AlreadyRunning(t *testing.T) {
	mgr := newTestManager(t)

	// Inject a pre-existing instance.
	noop := func(string, DevServerState) {}
	noopLogs := func(string, []LogEntry) {}
	noopErrors := func(string, []BuildError) {}
	inst := NewDevServerInstance(
		context.Background(), zap.NewNop().Sugar(),
		"dup-plugin", "/dev/path", 15173, BuildOpts{}, nil,
		noop, noopLogs, noopErrors,
	)

	mgr.mu.Lock()
	mgr.instances["dup-plugin"] = inst
	mgr.mu.Unlock()

	// pluginRef is nil, but StartDevServer should return early because
	// the instance already exists — returns existing state, no error.
	state, err := mgr.StartDevServer("dup-plugin")
	require.NoError(t, err)
	assert.Equal(t, "dup-plugin", state.PluginID)
	assert.Equal(t, DevServerModeManaged, state.Mode)
}

func TestManager_StartDevServer_PluginNotFound(t *testing.T) {
	mgr := newTestManager(t)
	mgr.pluginRef = &mockPluginRef{err: fmt.Errorf("not found")}

	_, err := mgr.StartDevServer("missing")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
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
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
}

func TestManager_StartDevServer_EmptyDevPath(t *testing.T) {
	mgr := newTestManager(t)
	mgr.pluginRef = &mockPluginRef{devMode: true, devPath: ""}

	_, err := mgr.StartDevServer("empty-path")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Title, "Missing dev path")
}

func TestManager_Shutdown_WithInstances(t *testing.T) {
	mgr := newTestManager(t)

	// Create instances with no-op callbacks. These have nil vite/goWatcher
	// so Stop() is safe.
	noop := func(string, DevServerState) {}
	noopLogs := func(string, []LogEntry) {}
	noopErrors := func(string, []BuildError) {}

	inst1 := NewDevServerInstance(
		context.Background(), zap.NewNop().Sugar(),
		"plugin-1", "/p1", 15173, BuildOpts{}, nil,
		noop, noopLogs, noopErrors,
	)
	inst2 := NewDevServerInstance(
		context.Background(), zap.NewNop().Sugar(),
		"plugin-2", "/p2", 15174, BuildOpts{}, nil,
		noop, noopLogs, noopErrors,
	)

	mgr.mu.Lock()
	mgr.instances["plugin-1"] = inst1
	mgr.instances["plugin-2"] = inst2
	mgr.mu.Unlock()

	// Shutdown should stop all instances and not panic.
	mgr.Shutdown()

	// After shutdown, instances should be removed.
	mgr.mu.RLock()
	assert.Empty(t, mgr.instances)
	mgr.mu.RUnlock()
}

func TestManager_Shutdown_WithExternalWatcher(t *testing.T) {
	mgr := newTestManager(t)

	// Set up a minimal external watcher with a real fsnotify watcher
	// (required because Stop() calls watcher.Close()).
	ew, _, _ := newTestExternalWatcher(t)
	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)
	ew.watcher = watcher
	mgr.externalWatcher = ew

	// Pre-populate a connection.
	ew.connections["ext-plug"] = &ExternalConnection{
		DevInfo:   &DevInfoFile{PID: 1, Addr: "127.0.0.1:50051"},
		Connected: true,
	}

	// Shutdown should call Stop on the external watcher, disconnecting all.
	mgr.Shutdown()

	assert.False(t, ew.IsExternallyManaged("ext-plug"))
}

func TestManager_GetDevServerState_WithInstance(t *testing.T) {
	mgr := newTestManager(t)

	noop := func(string, DevServerState) {}
	noopLogs := func(string, []LogEntry) {}
	noopErrors := func(string, []BuildError) {}

	inst := NewDevServerInstance(
		context.Background(), zap.NewNop().Sugar(),
		"state-plug", "/dev/path", 15180, BuildOpts{}, nil,
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
	// mockSettingsProvider returns "" for all strings.
	assert.Empty(t, opts.GoPath)
	assert.Empty(t, opts.PnpmPath)
	assert.Empty(t, opts.NodePath)
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
	mgr.pluginRef = &mockPluginRef{devMode: true, devPath: "/some/path"}
	mgr.ctx = context.Background()

	// Fill all ports in the allocator so Allocate fails.
	for port := PortRangeStart; port < PortRangeEnd; port++ {
		mgr.ports.assigned[port] = fmt.Sprintf("plugin-%d", port)
	}

	_, err := mgr.StartDevServer("new-plugin")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeInternal, appErr.Type)
	assert.Equal(t, 500, appErr.Status)
	assert.Contains(t, appErr.Title, "Port allocation failed")
}

func TestManager_RestartDevServer_NotRunning(t *testing.T) {
	mgr := newTestManager(t)
	mgr.pluginRef = &mockPluginRef{err: fmt.Errorf("not found")}

	// Restart when not running: Stop returns error (ignored), Start returns error.
	_, err := mgr.RestartDevServer("missing")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypePluginNotFound, appErr.Type)
	assert.Equal(t, 404, appErr.Status)
}

// ============================================================================
// StartDevServerForPath tests
// ============================================================================

func TestManager_StartDevServerForPath_EmptyPath(t *testing.T) {
	mgr := newTestManager(t)

	_, err := mgr.StartDevServerForPath("test-plugin", "")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Title, "Missing dev path")
}

func TestManager_StartDevServerForPath_AlreadyRunning(t *testing.T) {
	mgr := newTestManager(t)

	// Inject a pre-existing instance.
	noop := func(string, DevServerState) {}
	noopLogs := func(string, []LogEntry) {}
	noopErrors := func(string, []BuildError) {}
	inst := NewDevServerInstance(
		context.Background(), zap.NewNop().Sugar(),
		"dup-plugin", "/dev/path", 15173, BuildOpts{}, nil,
		noop, noopLogs, noopErrors,
	)

	mgr.mu.Lock()
	mgr.instances["dup-plugin"] = inst
	mgr.mu.Unlock()

	// Should return existing state, no error.
	state, err := mgr.StartDevServerForPath("dup-plugin", "/some/other/path")
	require.NoError(t, err)
	assert.Equal(t, "dup-plugin", state.PluginID)
	assert.Equal(t, DevServerModeManaged, state.Mode)
}

func TestManager_StartDevServerForPath_PortExhaustion(t *testing.T) {
	mgr := newTestManager(t)
	mgr.ctx = context.Background()

	// Fill all ports so Allocate fails.
	for port := PortRangeStart; port < PortRangeEnd; port++ {
		mgr.ports.assigned[port] = fmt.Sprintf("plugin-%d", port)
	}

	_, err := mgr.StartDevServerForPath("new-plugin", "/some/path")
	require.Error(t, err)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeInternal, appErr.Type)
	assert.Equal(t, 500, appErr.Status)
	assert.Contains(t, appErr.Title, "Port allocation failed")
}
