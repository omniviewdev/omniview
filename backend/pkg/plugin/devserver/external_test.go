package devserver

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

func TestReadDevInfoFile_Valid(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".devinfo")

	info := DevInfoFile{
		PID:             12345,
		Protocol:        "grpc",
		ProtocolVersion: 1,
		Addr:            "127.0.0.1:42367",
		VitePort:        15173,
		PluginID:        "test-plugin",
		Version:         "1.0.0",
		StartedAt:       "2025-01-01T00:00:00Z",
	}

	data, err := json.MarshalIndent(info, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, data, 0644))

	result, err := readDevInfoFile(path)
	require.NoError(t, err)
	assert.Equal(t, 12345, result.PID)
	assert.Equal(t, "grpc", result.Protocol)
	assert.Equal(t, "127.0.0.1:42367", result.Addr)
	assert.Equal(t, 15173, result.VitePort)
	assert.Equal(t, "test-plugin", result.PluginID)
}

func TestReadDevInfoFile_Invalid(t *testing.T) {
	dir := t.TempDir()

	tests := []struct {
		name      string
		content   string
		wantTitle string
		wantType  string
	}{
		{
			name:      "invalid json",
			content:   "not json",
			wantTitle: "Invalid dev info",
			wantType:  apperror.TypeValidation,
		},
		{
			name:      "missing pid",
			content:   `{"pid":0,"addr":"127.0.0.1:42367"}`,
			wantTitle: "Invalid PID",
			wantType:  apperror.TypeValidation,
		},
		{
			name:      "missing addr",
			content:   `{"pid":12345,"addr":""}`,
			wantTitle: "Invalid dev info",
			wantType:  apperror.TypeValidation,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(dir, tt.name+".devinfo")
			require.NoError(t, os.WriteFile(path, []byte(tt.content), 0644))

			_, err := readDevInfoFile(path)
			require.Error(t, err)
			var appErr *apperror.AppError
			require.True(t, errors.As(err, &appErr))
			assert.Equal(t, tt.wantType, appErr.Type)
			assert.Equal(t, 422, appErr.Status)
			assert.Equal(t, tt.wantTitle, appErr.Title)
		})
	}
}

func TestReadDevInfoFile_Defaults(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".devinfo")

	// Minimal valid file -- protocol and version should default
	content := `{"pid":12345,"addr":"127.0.0.1:42367"}`
	require.NoError(t, os.WriteFile(path, []byte(content), 0644))

	info, err := readDevInfoFile(path)
	require.NoError(t, err)
	assert.Equal(t, "grpc", info.Protocol)
	assert.Equal(t, 1, info.ProtocolVersion)
}

func TestIsPIDAlive(t *testing.T) {
	// Current process should be alive.
	assert.True(t, isPIDAlive(os.Getpid()))

	// Invalid PID.
	assert.False(t, isPIDAlive(-1))

	// Very high PID unlikely to exist.
	assert.False(t, isPIDAlive(9999999))
}

// ============================================================================
// ExternalWatcher unit tests
// ============================================================================

// newTestExternalWatcher creates an ExternalWatcher with temp pluginDir and
// callback recorders, without starting a real fsnotify watcher.
func newTestExternalWatcher(t *testing.T) (*ExternalWatcher, *connectRecorder, *disconnectRecorder) {
	t.Helper()
	cr := &connectRecorder{}
	dr := &disconnectRecorder{}

	ew := &ExternalWatcher{
		ctx:          context.Background(),
		logger:       zap.NewNop().Sugar(),
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    t.TempDir(),
		onConnect:    cr.record,
		onDisconnect: dr.record,
	}
	return ew, cr, dr
}

type connectRecorder struct {
	mu    sync.Mutex
	calls []connectCall
}

type connectCall struct {
	pluginID string
	info     *DevInfoFile
}

func (r *connectRecorder) record(pluginID string, info *DevInfoFile) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, connectCall{pluginID: pluginID, info: info})
}

func (r *connectRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

type disconnectRecorder struct {
	mu    sync.Mutex
	calls []string
}

func (r *disconnectRecorder) record(pluginID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, pluginID)
}

func (r *disconnectRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

// writeDevInfoFile writes a valid .devinfo file using the current process PID
// (so isPIDAlive passes) into pluginDir/<pluginID>/.devinfo.
func writeDevInfoFile(t *testing.T, pluginDir, pluginID string) string {
	t.Helper()
	dir := filepath.Join(pluginDir, pluginID)
	require.NoError(t, os.MkdirAll(dir, 0755))

	info := DevInfoFile{
		PID:      os.Getpid(), // current process is alive
		Addr:     "127.0.0.1:50051",
		PluginID: pluginID,
		VitePort: 15173,
	}
	data, err := json.Marshal(info)
	require.NoError(t, err)

	path := filepath.Join(dir, ".devinfo")
	require.NoError(t, os.WriteFile(path, data, 0644))
	return path
}

func TestExternalWatcher_HandleDevInfoCreated(t *testing.T) {
	ew, cr, _ := newTestExternalWatcher(t)

	path := writeDevInfoFile(t, ew.pluginDir, "my-plugin")
	ew.handleDevInfoCreated(path)

	require.Equal(t, 1, cr.count())
	assert.True(t, ew.IsExternallyManaged("my-plugin"))

	conn := ew.connections["my-plugin"]
	require.NotNil(t, conn)
	assert.True(t, conn.Connected)
	assert.Equal(t, os.Getpid(), conn.DevInfo.PID)
}

func TestExternalWatcher_HandleDevInfoCreated_InvalidFile(t *testing.T) {
	ew, cr, _ := newTestExternalWatcher(t)

	// Write invalid JSON.
	dir := filepath.Join(ew.pluginDir, "bad-plugin")
	require.NoError(t, os.MkdirAll(dir, 0755))
	path := filepath.Join(dir, ".devinfo")
	require.NoError(t, os.WriteFile(path, []byte("not json"), 0644))

	ew.handleDevInfoCreated(path)

	// Should not have connected.
	assert.Equal(t, 0, cr.count())
	assert.False(t, ew.IsExternallyManaged("bad-plugin"))
}

func TestExternalWatcher_HandleDevInfoCreated_MissingFile(t *testing.T) {
	ew, cr, _ := newTestExternalWatcher(t)

	path := filepath.Join(ew.pluginDir, "ghost-plugin", ".devinfo")
	ew.handleDevInfoCreated(path)

	assert.Equal(t, 0, cr.count())
}

func TestExternalWatcher_HandleDevInfoCreated_PluginIDMismatch(t *testing.T) {
	ew, cr, _ := newTestExternalWatcher(t)

	// Write a .devinfo in dir "dir-name" but PluginID says "other-name".
	dir := filepath.Join(ew.pluginDir, "dir-name")
	require.NoError(t, os.MkdirAll(dir, 0755))
	info := DevInfoFile{
		PID:      os.Getpid(),
		Addr:     "127.0.0.1:50051",
		PluginID: "other-name",
	}
	data, _ := json.Marshal(info)
	path := filepath.Join(dir, ".devinfo")
	require.NoError(t, os.WriteFile(path, data, 0644))

	ew.handleDevInfoCreated(path)

	// Should not connect due to mismatch.
	assert.Equal(t, 0, cr.count())
}

func TestExternalWatcher_HandleDevInfoRemoved(t *testing.T) {
	ew, _, dr := newTestExternalWatcher(t)

	// Pre-populate a connection.
	ew.connections["rm-plugin"] = &ExternalConnection{
		DevInfo:   &DevInfoFile{PID: os.Getpid(), Addr: "127.0.0.1:50051"},
		Connected: true,
	}

	path := filepath.Join(ew.pluginDir, "rm-plugin", ".devinfo")
	ew.handleDevInfoRemoved(path)

	assert.Equal(t, 1, dr.count())
	assert.False(t, ew.IsExternallyManaged("rm-plugin"))
}

func TestExternalWatcher_HandleDevInfoRemoved_NotConnected(t *testing.T) {
	ew, _, dr := newTestExternalWatcher(t)

	// Remove for a plugin that was never connected.
	path := filepath.Join(ew.pluginDir, "unknown-plugin", ".devinfo")
	ew.handleDevInfoRemoved(path)

	assert.Equal(t, 0, dr.count())
}

func TestExternalWatcher_DisconnectLocked(t *testing.T) {
	ew, _, dr := newTestExternalWatcher(t)

	cancelled := false
	conn := &ExternalConnection{
		DevInfo:      &DevInfoFile{PID: 1, Addr: "127.0.0.1:50051"},
		Connected:    true,
		cancelHealth: func() { cancelled = true },
	}
	ew.connections["dc-plugin"] = conn

	ew.mu.Lock()
	ew.disconnectLocked("dc-plugin", conn)
	ew.mu.Unlock()

	assert.False(t, conn.Connected)
	assert.True(t, cancelled)
	assert.Equal(t, 1, dr.count())
	// Connection should be removed from map.
	_, exists := ew.connections["dc-plugin"]
	assert.False(t, exists)
}

func TestExternalWatcher_DisconnectLocked_AlreadyDisconnected(t *testing.T) {
	ew, _, dr := newTestExternalWatcher(t)

	conn := &ExternalConnection{
		DevInfo:   &DevInfoFile{PID: 1, Addr: "127.0.0.1:50051"},
		Connected: false,
	}
	ew.connections["dc2"] = conn

	// Should not panic even with nil cancelHealth.
	ew.mu.Lock()
	ew.disconnectLocked("dc2", conn)
	ew.mu.Unlock()

	assert.False(t, conn.Connected)
	assert.Equal(t, 1, dr.count())
}

func TestExternalWatcher_ScanExistingDevInfoFiles(t *testing.T) {
	ew, cr, _ := newTestExternalWatcher(t)

	// Write multiple .devinfo files.
	writeDevInfoFile(t, ew.pluginDir, "plugin-a")
	writeDevInfoFile(t, ew.pluginDir, "plugin-b")

	ew.scanExistingDevInfoFiles()

	assert.Equal(t, 2, cr.count())
	assert.True(t, ew.IsExternallyManaged("plugin-a"))
	assert.True(t, ew.IsExternallyManaged("plugin-b"))
}

func TestExternalWatcher_ScanExistingDevInfoFiles_Empty(t *testing.T) {
	ew, cr, _ := newTestExternalWatcher(t)

	// Empty pluginDir — no .devinfo files.
	ew.scanExistingDevInfoFiles()

	assert.Equal(t, 0, cr.count())
}

func TestExternalWatcher_ScanExistingDevInfoFiles_SkipsNonDirs(t *testing.T) {
	ew, cr, _ := newTestExternalWatcher(t)

	// Write a regular file (not a directory) in pluginDir.
	require.NoError(t, os.WriteFile(filepath.Join(ew.pluginDir, "stray-file"), []byte("x"), 0644))

	ew.scanExistingDevInfoFiles()

	assert.Equal(t, 0, cr.count())
}

func TestExternalWatcher_GetExternalInfo(t *testing.T) {
	ew, _, _ := newTestExternalWatcher(t)

	info := &DevInfoFile{PID: 42, Addr: "127.0.0.1:50051", VitePort: 15173}
	ew.connections["info-plugin"] = &ExternalConnection{
		DevInfo:   info,
		Connected: true,
	}

	result := ew.GetExternalInfo("info-plugin")
	require.NotNil(t, result)
	assert.Equal(t, 42, result.PID)

	// Non-existent returns nil.
	assert.Nil(t, ew.GetExternalInfo("nonexistent"))
}

func TestExternalWatcher_IsExternallyManaged(t *testing.T) {
	ew, _, _ := newTestExternalWatcher(t)

	ew.connections["connected"] = &ExternalConnection{Connected: true, DevInfo: &DevInfoFile{}}
	ew.connections["disconnected"] = &ExternalConnection{Connected: false, DevInfo: &DevInfoFile{}}

	assert.True(t, ew.IsExternallyManaged("connected"))
	assert.False(t, ew.IsExternallyManaged("disconnected"))
	assert.False(t, ew.IsExternallyManaged("unknown"))
}

func TestNewExternalWatcher(t *testing.T) {
	logger := zap.NewNop().Sugar()
	onConnect := func(string, *DevInfoFile) {}
	onDisconnect := func(string) {}

	ew, err := NewExternalWatcher(logger, onConnect, onDisconnect)
	require.NoError(t, err)
	require.NotNil(t, ew)

	assert.NotNil(t, ew.watcher)
	assert.NotNil(t, ew.connections)
	assert.NotEmpty(t, ew.pluginDir)
	assert.NotNil(t, ew.onConnect)
	assert.NotNil(t, ew.onDisconnect)

	// Clean up the real watcher.
	ew.watcher.Close()
}

func TestExternalWatcher_HandleDevInfoCreated_DeadPID(t *testing.T) {
	ew, cr, _ := newTestExternalWatcher(t)

	// Write a .devinfo with a dead PID.
	dir := filepath.Join(ew.pluginDir, "dead-plugin")
	require.NoError(t, os.MkdirAll(dir, 0755))
	info := DevInfoFile{
		PID:      9999999, // very unlikely to be alive
		Addr:     "127.0.0.1:50051",
		PluginID: "dead-plugin",
	}
	data, _ := json.Marshal(info)
	path := filepath.Join(dir, ".devinfo")
	require.NoError(t, os.WriteFile(path, data, 0644))

	ew.handleDevInfoCreated(path)

	// Should not have connected because PID is dead.
	assert.Equal(t, 0, cr.count())
	assert.False(t, ew.IsExternallyManaged("dead-plugin"))

	// The stale .devinfo file should have been cleaned up.
	_, err := os.Stat(path)
	assert.True(t, os.IsNotExist(err), "stale .devinfo should be removed")
}

func TestExternalWatcher_HealthCheckLoop_CtxCancelled(t *testing.T) {
	ew, _, _ := newTestExternalWatcher(t)

	// Pre-populate a connection for the plugin.
	ew.connections["health-plugin"] = &ExternalConnection{
		DevInfo:   &DevInfoFile{PID: os.Getpid(), Addr: "127.0.0.1:50051"},
		Connected: true,
	}

	// Create a cancelled context — healthCheckLoop should exit immediately.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// This should return quickly (ctx is already done).
	done := make(chan struct{})
	go func() {
		ew.healthCheckLoop(ctx, "health-plugin", os.Getpid())
		close(done)
	}()

	select {
	case <-done:
		// Success — returned promptly.
	case <-time.After(2 * time.Second):
		t.Fatal("healthCheckLoop did not exit after context cancellation")
	}
}

func TestExternalWatcher_Stop_WithConnections(t *testing.T) {
	ew, _, dr := newTestExternalWatcher(t)

	// Need a real watcher for Stop to not panic.
	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)
	ew.watcher = watcher

	cancelled1, cancelled2 := false, false
	ew.connections["plug-1"] = &ExternalConnection{
		DevInfo:      &DevInfoFile{PID: 1, Addr: "a"},
		Connected:    true,
		cancelHealth: func() { cancelled1 = true },
	}
	ew.connections["plug-2"] = &ExternalConnection{
		DevInfo:      &DevInfoFile{PID: 2, Addr: "b"},
		Connected:    true,
		cancelHealth: func() { cancelled2 = true },
	}

	ew.Stop()

	assert.True(t, cancelled1)
	assert.True(t, cancelled2)
	assert.Equal(t, 2, dr.count())
	assert.Empty(t, ew.connections)
}

func TestExternalWatcher_HandleDevInfoCreated_ReplacesExisting(t *testing.T) {
	ew, cr, dr := newTestExternalWatcher(t)

	// Pre-populate a connection.
	ew.connections["replace-plugin"] = &ExternalConnection{
		DevInfo:   &DevInfoFile{PID: 1, Addr: "old"},
		Connected: true,
	}

	path := writeDevInfoFile(t, ew.pluginDir, "replace-plugin")
	ew.handleDevInfoCreated(path)

	// Old connection should have been disconnected, new one connected.
	assert.Equal(t, 1, dr.count())
	assert.Equal(t, 1, cr.count())
	assert.True(t, ew.IsExternallyManaged("replace-plugin"))
}

func TestExternalWatcher_HandleDevInfoCreated_EmptyPluginID(t *testing.T) {
	ew, cr, _ := newTestExternalWatcher(t)

	// Write .devinfo with empty PluginID — should use directory name.
	dir := filepath.Join(ew.pluginDir, "dir-name-plugin")
	require.NoError(t, os.MkdirAll(dir, 0755))
	info := DevInfoFile{
		PID:      os.Getpid(),
		Addr:     "127.0.0.1:50051",
		PluginID: "", // empty
	}
	data, _ := json.Marshal(info)
	path := filepath.Join(dir, ".devinfo")
	require.NoError(t, os.WriteFile(path, data, 0644))

	ew.handleDevInfoCreated(path)

	require.Equal(t, 1, cr.count())
	assert.True(t, ew.IsExternallyManaged("dir-name-plugin"))
}
