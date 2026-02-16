# 10 -- Testing & Verification Plan

## Testing Strategy for the Plugin Dev Server System

**Scope**: All components from Phases 1-9. Testing spans Go backend, TypeScript frontend, integration between them, and end-to-end user workflows.

---

## 1. Unit Tests for Each Go Package

### 1.1 `backend/pkg/plugin/devserver/` Package

#### `manager_test.go`

```go
package devserver

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestManager_StartStop(t *testing.T) {
	logger := zap.NewNop().Sugar()
	mgr := NewManager(logger, nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := mgr.Initialize(ctx)
	require.NoError(t, err)

	// Should have no instances initially
	assert.Equal(t, 0, len(mgr.ListInstances()))

	mgr.Shutdown()
}

func TestManager_IsManaged_Empty(t *testing.T) {
	logger := zap.NewNop().Sugar()
	mgr := NewManager(logger, nil, nil)

	assert.False(t, mgr.IsManaged("nonexistent"))
}

func TestManager_IsManaged_WithInstance(t *testing.T) {
	logger := zap.NewNop().Sugar()
	mgr := NewManager(logger, nil, nil)

	mgr.mu.Lock()
	mgr.instances["test-plugin"] = &DevServerInstance{PluginID: "test-plugin"}
	mgr.mu.Unlock()

	assert.True(t, mgr.IsManaged("test-plugin"))
	assert.False(t, mgr.IsManaged("other-plugin"))
}
```

#### `external_test.go`

```go
package devserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadDevInfoFile_Valid(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".devinfo")

	info := DevInfo{
		PID:             12345,
		Protocol:        "grpc",
		ProtocolVersion: 1,
		Addr:            "127.0.0.1:42367",
		VitePort:        15173,
		PluginID:        "test-plugin",
		Version:         "1.0.0",
		StartedAt:       time.Now().UTC(),
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
		name    string
		content string
		wantErr string
	}{
		{
			name:    "invalid json",
			content: "not json",
			wantErr: "invalid JSON",
		},
		{
			name:    "missing pid",
			content: `{"pid":0,"addr":"127.0.0.1:42367"}`,
			wantErr: "invalid PID",
		},
		{
			name:    "missing addr",
			content: `{"pid":12345,"addr":""}`,
			wantErr: "missing addr",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(dir, tt.name+".devinfo")
			require.NoError(t, os.WriteFile(path, []byte(tt.content), 0644))

			_, err := readDevInfoFile(path)
			assert.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
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
	// Current process should be alive
	assert.True(t, isPIDAlive(os.Getpid()))

	// PID 0 is the kernel -- should not be "alive" in our sense
	// PID -1 is invalid
	assert.False(t, isPIDAlive(-1))

	// Very high PID unlikely to exist
	assert.False(t, isPIDAlive(9999999))
}
```

#### `ports_test.go`

```go
package devserver

import (
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAllocatePort_ReturnsInRange(t *testing.T) {
	port, err := AllocatePort(15173, 15273)
	assert.NoError(t, err)
	assert.GreaterOrEqual(t, port, 15173)
	assert.LessOrEqual(t, port, 15273)
}

func TestAllocatePort_SkipsUsedPorts(t *testing.T) {
	// Bind the preferred port
	listener, err := net.Listen("tcp", "127.0.0.1:15173")
	if err != nil {
		t.Skip("cannot bind test port")
	}
	defer listener.Close()

	port, err := AllocatePort(15173, 15273)
	assert.NoError(t, err)
	assert.NotEqual(t, 15173, port)
}
```

### 1.2 `pkg/plugin-sdk/pkg/sdk/` Package

#### `devinfo_test.go`

```go
package sdk

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWriteDevInfo_ParsesHandshake(t *testing.T) {
	// Override home dir for test
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	pluginDir := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin")
	require.NoError(t, os.MkdirAll(pluginDir, 0755))

	err := WriteDevInfo("test-plugin", "1.0.0", "1|1|tcp|127.0.0.1:42367|grpc", 15173)
	require.NoError(t, err)

	// Read and verify
	info, err := ReadDevInfo("test-plugin")
	require.NoError(t, err)
	assert.Equal(t, os.Getpid(), info.PID)
	assert.Equal(t, "grpc", info.Protocol)
	assert.Equal(t, 1, info.ProtocolVersion)
	assert.Equal(t, "127.0.0.1:42367", info.Addr)
	assert.Equal(t, 15173, info.VitePort)
	assert.Equal(t, "test-plugin", info.PluginID)
}

func TestWriteDevInfo_InvalidHandshake(t *testing.T) {
	err := WriteDevInfo("test", "1.0", "invalid", 0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid handshake line")
}

func TestCleanupDevInfo(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	pluginDir := filepath.Join(tmpHome, ".omniview", "plugins", "test-plugin")
	require.NoError(t, os.MkdirAll(pluginDir, 0755))

	// Write a file first
	err := WriteDevInfo("test-plugin", "1.0.0", "1|1|tcp|127.0.0.1:42367|grpc", 0)
	require.NoError(t, err)

	// Verify it exists
	path := filepath.Join(pluginDir, ".devinfo")
	_, err = os.Stat(path)
	require.NoError(t, err)

	// Cleanup
	err = CleanupDevInfo("test-plugin")
	require.NoError(t, err)

	// Verify it's gone
	_, err = os.Stat(path)
	assert.True(t, os.IsNotExist(err))
}

func TestCleanupDevInfo_NotExist(t *testing.T) {
	origHome := os.Getenv("HOME")
	tmpHome := t.TempDir()
	os.Setenv("HOME", tmpHome)
	defer os.Setenv("HOME", origHome)

	// Should not error when file doesn't exist
	err := CleanupDevInfo("nonexistent-plugin")
	assert.NoError(t, err)
}
```

### 1.3 `backend/pkg/plugin/` Package (Watcher Refactor)

#### `dev_test.go` (additions)

```go
package plugin

import (
	"testing"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

type mockDevServerMgr struct {
	managed map[string]bool
}

func (m *mockDevServerMgr) IsManaged(pluginID string) bool {
	return m.managed[pluginID]
}

func (m *mockDevServerMgr) StartDevServer(pluginID string) error {
	return nil
}

func (m *mockDevServerMgr) Shutdown() {}

func TestHandleWatchEvent_SkipsManagedPlugin(t *testing.T) {
	mockMgr := &mockDevServerMgr{
		managed: map[string]bool{"test-plugin": true},
	}

	pm := &pluginManager{
		logger:       zap.NewNop().Sugar(),
		devServerMgr: mockMgr,
		watchTargets: map[string][]string{
			"/tmp/plugins/test-plugin": {"/tmp/plugins/test-plugin/pkg"},
		},
	}

	// This event is for a managed plugin -- should return nil without building
	err := pm.handleWatchEvent(fsnotify.Event{
		Name: "/tmp/plugins/test-plugin/pkg/main.go",
		Op:   fsnotify.Write,
	})
	assert.NoError(t, err)
}

func TestHandleWatchEvent_NilDevServerMgr(t *testing.T) {
	pm := &pluginManager{
		logger:       zap.NewNop().Sugar(),
		devServerMgr: nil, // nil is fine -- old behavior
		watchTargets: map[string][]string{},
	}

	// Should not panic when devServerMgr is nil
	err := pm.handleWatchEvent(fsnotify.Event{
		Name: "/tmp/plugins/test-plugin/pkg/main.go",
		Op:   fsnotify.Write,
	})
	assert.NoError(t, err) // returns nil because findParentTarget returns ""
}

func TestEventShouldFire(t *testing.T) {
	tests := []struct {
		name     string
		event    fsnotify.Event
		expected bool
	}{
		{
			name:     "go file write",
			event:    fsnotify.Event{Name: "main.go", Op: fsnotify.Write},
			expected: true,
		},
		{
			name:     "tsx file create",
			event:    fsnotify.Event{Name: "App.tsx", Op: fsnotify.Create},
			expected: true,
		},
		{
			name:     "txt file write",
			event:    fsnotify.Event{Name: "readme.txt", Op: fsnotify.Write},
			expected: false,
		},
		{
			name:     "go file remove",
			event:    fsnotify.Event{Name: "main.go", Op: fsnotify.Remove},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, eventShouldFire(tt.event))
		})
	}
}
```

### 1.4 CLI Tool Tests

#### `cmd/omniview-plugin-dev/validator_test.go`

```go
package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidatePlugin_FullPlugin(t *testing.T) {
	dir := t.TempDir()

	// Create required structure
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "pkg"), 0755))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "ui"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(`
id: test-plugin
name: Test Plugin
version: 1.0.0
capabilities:
  - resource
  - ui
`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "pkg", "main.go"), []byte("package main"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "vite.config.ts"), []byte("export default {}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "package.json"), []byte("{}"), 0644))

	meta, err := ValidatePlugin(dir)
	require.NoError(t, err)
	assert.Equal(t, "test-plugin", meta.ID)
	assert.Equal(t, "1.0.0", meta.Version)
	assert.True(t, meta.HasBackend)
	assert.True(t, meta.HasUI)
}

func TestValidatePlugin_MissingPluginYaml(t *testing.T) {
	dir := t.TempDir()
	_, err := ValidatePlugin(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "plugin.yaml not found")
}

func TestValidatePlugin_MissingMainGo(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(`
id: test
version: 1.0.0
capabilities:
  - resource
`), 0644))

	_, err := ValidatePlugin(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "pkg/main.go")
}

func TestValidatePlugin_UIOnly(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "ui"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte(`
id: ui-plugin
name: UI Plugin
version: 1.0.0
capabilities:
  - ui
`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "vite.config.ts"), []byte("export default {}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "ui", "package.json"), []byte("{}"), 0644))

	meta, err := ValidatePlugin(dir)
	require.NoError(t, err)
	assert.False(t, meta.HasBackend)
	assert.True(t, meta.HasUI)
}
```

---

## 2. Integration Test Scenarios

### 2.1 DevServerManager + Plugin Manager Integration

**Test**: `backend/pkg/plugin/integration_test.go`

```
Scenario: Install dev mode plugin with DevServerManager
  Given a valid plugin directory at /tmp/test-plugin
  And DevServerManager is initialized
  When InstallInDevMode() is called with the directory
  Then the plugin is built and transferred
  And LoadPlugin() is called with DevMode=true
  And devServerMgr.StartDevServer() is called
  And the plugin appears in ListPlugins()
  And the plugin has DevMode=true
```

```
Scenario: File change skips build for managed plugin
  Given plugin "test-plugin" is loaded in dev mode
  And DevServerManager is managing "test-plugin"
  When a .go file change event fires for "test-plugin"
  Then handleWatchEvent() returns nil
  And buildAndTransferPlugin is NOT called
  And ReloadPlugin is NOT called
```

```
Scenario: File change triggers build for unmanaged plugin
  Given plugin "test-plugin" is loaded in dev mode
  And DevServerManager is NOT managing "test-plugin"
  When a .go file change event fires for "test-plugin"
  Then handleWatchEvent() calls buildAndTransferPlugin
  And ReloadPlugin is called
```

### 2.2 External Watcher Integration

```
Scenario: IDE detects externally-running plugin
  Given the ExternalWatcher is running
  And no .devinfo file exists for "test-plugin"
  When a process writes .devinfo for "test-plugin" with valid PID and addr
  Then ExternalWatcher detects the file creation
  And connects via ReattachConfig
  And onConnect callback is called
  And plugin/devserver/status event is emitted with grpcConnected=true
```

```
Scenario: IDE handles external plugin crash
  Given the ExternalWatcher is connected to "test-plugin" at PID 12345
  When the process at PID 12345 terminates
  Then the health check detects PID death within 5 seconds
  And disconnectLocked() is called
  And onDisconnect callback is called
  And .devinfo file is removed
  And plugin/devserver/status event is emitted with grpcConnected=false
```

```
Scenario: IDE reconnects after air restart
  Given the ExternalWatcher is connected to "test-plugin" at PID 12345
  When .devinfo is deleted (old process stops)
  And a new .devinfo is created with PID 12346 and new addr
  Then ExternalWatcher disconnects from old process
  And connects to new process via ReattachConfig
  And the plugin continues to function
```

### 2.3 Vite Config Integration

```
Scenario: Vite dev server starts with correct config
  Given the kubernetes plugin has the updated vite.config.ts
  When "pnpm run dev" is executed in plugins/kubernetes/ui/
  Then Vite starts on 127.0.0.1 (not localhost)
  And the port is 15173 or next available
  And CORS headers are present on responses
  And HMR WebSocket connects to 127.0.0.1
  And shared deps resolve to shim files (not bundled)
```

```
Scenario: Multiple Vite instances on different ports
  Given plugin A has Vite running on port 15173
  When plugin B starts its Vite dev server
  Then plugin B's Vite starts on port 15174 (auto-increment)
  And both servers respond independently
```

---

## 3. Manual QA Checklist

| # | Test | Steps | Expected Result |
|---|------|-------|----------------|
| 1 | **Dev mode install** | IDE > Plugins > Install Dev Mode > select kubernetes plugin directory | Plugin builds, loads, appears in plugin list with "Dev Mode" chip |
| 2 | **HMR for UI change** | Edit a `.tsx` file in the kubernetes plugin's `ui/src/` | Component updates in <100ms without page refresh. React state preserved |
| 3 | **Go backend rebuild** | Edit a `.go` file in the kubernetes plugin's `pkg/` | Build output appears in bottom drawer. Plugin reloads in 2-5s. Connections re-established |
| 4 | **Build error display** | Introduce a syntax error in a `.go` file | Error overlay appears with file:line:col. Fix the error. Overlay dismisses on successful rebuild |
| 5 | **Footer indicators** | With 2 dev-mode plugins active | Two colored dots appear in footer. Green when ready, amber during build |
| 6 | **Build output tab** | Click a footer indicator dot | Bottom drawer opens with "Build: <plugin>" tab showing color-coded output |
| 7 | **External mode** | Run `omniview-plugin-dev --dir ./plugins/kubernetes` in terminal, then open IDE | IDE shows "External" chip. Plugin loads. HMR works |
| 8 | **External mode disconnect** | Ctrl+C the CLI tool | IDE shows disconnected state within 5s. Plugin UI shows placeholder |
| 9 | **Multi-plugin dev** | Install 2 plugins in dev mode simultaneously | Both have independent Vite servers, independent Go watchers, independent status indicators |
| 10 | **IDE restart persistence** | Install plugin in dev mode, quit IDE, reopen | Dev server auto-starts on launch. Plugin loads in dev mode |

---

## 4. Performance Benchmarks

### 4.1 HMR Latency

**Metric**: Time from file save to visual update in the webview.

**Measurement method**: Inject a `performance.now()` call in the Vite HMR client's `handleUpdate` hook.

**Targets**:
| Scenario | Target | Acceptable |
|----------|--------|------------|
| Single component change | <100ms | <200ms |
| CSS-only change | <50ms | <100ms |
| New file added | <300ms | <500ms |
| Large file with many imports | <200ms | <400ms |

**Benchmark script**:
```bash
#!/bin/bash
# benchmark-hmr.sh
# Requires: inotifywait, curl

FILE="plugins/kubernetes/ui/src/components/test/Benchmark.tsx"

# Create test file
echo 'import React from "react"; export default () => <div>v1</div>' > $FILE

sleep 2  # Wait for Vite to detect and serve

START=$(date +%s%N)
echo 'import React from "react"; export default () => <div>v2</div>' > $FILE

# Poll the Vite server for the updated module
while true; do
  CONTENT=$(curl -s "http://127.0.0.1:15173/src/components/test/Benchmark.tsx")
  if echo "$CONTENT" | grep -q "v2"; then
    END=$(date +%s%N)
    ELAPSED=$(( (END - START) / 1000000 ))
    echo "HMR latency: ${ELAPSED}ms"
    break
  fi
  sleep 0.01
done

rm $FILE
```

### 4.2 Go Rebuild Time

**Metric**: Time from file save detection to plugin process restart.

**Measurement method**: Timestamps in DevServerManager log events.

**Targets**:
| Plugin Size | Target | Acceptable |
|-------------|--------|------------|
| Small (<5 files) | <1s | <2s |
| Medium (~50 files, Kubernetes plugin) | <3s | <5s |
| Large (100+ files) | <5s | <10s |

### 4.3 Memory Usage

**Measurement method**: `ps aux` or Go runtime metrics.

**Targets**:
| Component | Target | Acceptable |
|-----------|--------|------------|
| Vite dev server (per plugin) | <25MB | <50MB |
| DevServerManager Go process | <10MB | <20MB |
| fsnotify watchers (per plugin) | <5MB | <10MB |
| Total for 5 plugins | <200MB | <350MB |

---

## 5. Scale Testing (5+ Concurrent Plugins)

### 5.1 Test Setup

Create 5 minimal test plugins:

```bash
for i in $(seq 1 5); do
  mkdir -p /tmp/test-plugins/plugin-$i/{pkg,ui}
  cat > /tmp/test-plugins/plugin-$i/plugin.yaml << EOF
id: test-plugin-$i
name: Test Plugin $i
version: 1.0.0
capabilities:
  - resource
  - ui
EOF
  # Create minimal Go and UI files...
done
```

### 5.2 Scale Test Checklist

| # | Test | Expected |
|---|------|----------|
| 1 | Install 5 plugins in dev mode | All 5 load successfully |
| 2 | Check Vite ports | 15173, 15174, 15175, 15176, 15177 |
| 3 | Check footer indicators | 5 dots visible, all green |
| 4 | Simultaneous Go changes in 3 plugins | All 3 rebuild independently, no deadlocks |
| 5 | Simultaneous UI changes in all 5 | All 5 HMR updates arrive, no cross-talk |
| 6 | Total memory usage | Under 350MB |
| 7 | File watcher count | Under macOS FSEvents limit (32k) |
| 8 | Stop 2 plugins, start 2 new ones | Ports reclaimed, new plugins get correct ports |
| 9 | Rapid file changes (10 saves in 1s) | Debounce works; exactly 1 rebuild triggered per plugin |
| 10 | IDE restart with 5 dev plugins | All 5 auto-start on next launch |

### 5.3 Stress Test: Rapid Changes

```bash
# Trigger 100 rapid file changes across 5 plugins
for i in $(seq 1 100); do
  PLUGIN=$((i % 5 + 1))
  echo "// change $i" >> /tmp/test-plugins/plugin-$PLUGIN/pkg/main.go
  sleep 0.05
done

# Expected: each plugin rebuilds at most once per 500ms debounce window
# Total rebuilds should be ~5 (one per plugin, not 100)
```

---

## 6. Error Recovery Testing

### 6.1 Vite Process Crash

| Scenario | Steps | Expected Recovery |
|----------|-------|-------------------|
| Vite killed with SIGKILL | `kill -9 <vite-pid>` | DevServerManager detects process exit. Emits error status. Auto-restarts Vite within 2s. HMR resumes after restart. |
| Vite port conflict | Start another process on 15173 before Vite | Vite auto-increments to 15174. DevServerManager detects actual port. Frontend uses correct port. |
| Vite out of memory | Create a plugin with 10000 files | Vite crashes. DevServerManager reports error. Developer reduces file count. Restart works. |

### 6.2 Go Build Failure

| Scenario | Steps | Expected Recovery |
|----------|-------|-------------------|
| Syntax error | Introduce `func main( {` | Build fails. Error overlay shows with file:line:col. Old binary keeps running. Fix error. Next save triggers successful build. |
| Import cycle | Create circular import | Build fails. Error output shows cycle. Old binary keeps running. |
| Missing dependency | Import non-existent package | Build fails. `go get` message shown. Old binary keeps running. |

### 6.3 Plugin Process Crash

| Scenario | Steps | Expected Recovery |
|----------|-------|-------------------|
| Plugin panics | Add `panic("test")` to handler | gRPC connection lost. DevServerManager detects. Emits error status. Plugin auto-restarts from last built binary. |
| Plugin deadlock | Create a goroutine deadlock | Plugin stops responding. gRPC timeout triggers. DevServerManager kills and restarts. |
| Plugin exits normally | Plugin's `Serve()` returns | DevServerManager detects exit. Attempts restart. |

### 6.4 Filesystem Issues

| Scenario | Steps | Expected Recovery |
|----------|-------|-------------------|
| Plugin directory deleted | `rm -rf` the source directory | Watcher errors logged. Dev server stops. Plugin continues from installed binary. |
| Disk full | Fill disk during build | Build fails with I/O error. Error reported. Old binary keeps running. |
| Permissions denied | `chmod 000` on build output dir | Build fails. Error shows permission message. Fix permissions. Next build works. |

### 6.5 Network Issues

| Scenario | Steps | Expected Recovery |
|----------|-------|-------------------|
| Port exhaustion | Bind all ports in 15173-15273 range | Port allocation fails. Error reported clearly ("no available ports"). |
| gRPC connection timeout | Kill plugin while gRPC call in progress | Timeout after 5s. Controller marks plugin as disconnected. Automatic reconnect on rebuild. |

### 6.6 IDE Lifecycle

| Scenario | Steps | Expected Recovery |
|----------|-------|-------------------|
| IDE crash | `kill -9` the Omniview process | On restart: reads plugin state, finds DevMode plugins, auto-starts dev servers. |
| IDE shutdown during build | Close IDE while Go is compiling | Build process orphaned and eventually killed. On restart: clean rebuild. |
| macOS sleep/wake | Close laptop lid, reopen | Vite recovers WebSocket. gRPC reconnects. File watchers resume. |

---

## 7. Frontend Unit Tests

### 7.1 Type Tests: `ui/features/devtools/types.spec.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { getAggregateStatus, type DevServerState } from './types';

describe('getAggregateStatus', () => {
  it('returns error when goStatus is error', () => {
    const state: DevServerState = {
      pluginId: 'test',
      mode: 'managed',
      viteStatus: 'running',
      vitePort: 15173,
      goStatus: 'error',
      grpcConnected: true,
      lastBuildTime: 0,
    };
    expect(getAggregateStatus(state)).toBe('error');
  });

  it('returns building when goStatus is building', () => {
    const state: DevServerState = {
      pluginId: 'test',
      mode: 'managed',
      viteStatus: 'running',
      vitePort: 15173,
      goStatus: 'building',
      grpcConnected: true,
      lastBuildTime: 0,
    };
    expect(getAggregateStatus(state)).toBe('building');
  });

  it('returns ready when everything is connected', () => {
    const state: DevServerState = {
      pluginId: 'test',
      mode: 'managed',
      viteStatus: 'running',
      vitePort: 15173,
      goStatus: 'ready',
      grpcConnected: true,
      lastBuildTime: 2000,
    };
    expect(getAggregateStatus(state)).toBe('ready');
  });

  it('returns connecting when grpc not connected but no error', () => {
    const state: DevServerState = {
      pluginId: 'test',
      mode: 'managed',
      viteStatus: 'running',
      vitePort: 15173,
      goStatus: 'ready',
      grpcConnected: false,
      lastBuildTime: 0,
    };
    expect(getAggregateStatus(state)).toBe('connecting');
  });
});
```

### 7.2 Hook Tests: `ui/features/devtools/useDevServers.spec.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react-hooks';
import { useDevServers } from './useDevServers';
import { devToolsChannel } from './events';

describe('useDevServers', () => {
  it('starts with empty state', () => {
    const { result } = renderHook(() => useDevServers());
    expect(result.current.servers.size).toBe(0);
    expect(result.current.summary.total).toBe(0);
  });

  it('updates on status change event', () => {
    const { result } = renderHook(() => useDevServers());

    act(() => {
      devToolsChannel.emit('onStatusChange', {
        pluginId: 'test',
        mode: 'managed',
        viteStatus: 'running',
        vitePort: 15173,
        goStatus: 'ready',
        grpcConnected: true,
        lastBuildTime: 1000,
      });
    });

    expect(result.current.servers.size).toBe(1);
    expect(result.current.summary.ready).toBe(1);
  });
});
```

---

## 8. CI Pipeline Integration

### Run Go tests:
```bash
cd backend && go test ./pkg/plugin/devserver/... -v -race -count=1
cd pkg/plugin-sdk && go test ./pkg/sdk/... -v -race -count=1
cd cmd/omniview-plugin-dev && go test ./... -v -race -count=1
```

### Run Frontend tests:
```bash
cd ui && pnpm run test -- --run ui/features/devtools/
```

### Run integration tests (requires build):
```bash
make test-integration
```
