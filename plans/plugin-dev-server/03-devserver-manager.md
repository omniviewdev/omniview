# 03 -- DevServerManager (Phase 2)

## Overview

The DevServerManager is a Go package at `backend/pkg/plugin/devserver/` that manages Vite dev server processes and Go file watchers for plugins running in dev mode. It is exposed as a Wails binding so the frontend can call its methods directly via the generated TypeScript bindings.

The package is responsible for:

- Starting/stopping Vite dev server processes per plugin (IDE-managed mode)
- Starting/stopping Go file watchers that rebuild the plugin binary on `.go` file changes
- Allocating unique ports for each Vite instance in the 15173-15273 range
- Streaming build logs and status updates to the frontend via Wails events
- Supporting external/self-managed mode where developers run their own processes
- Maintaining a log ring buffer per plugin for the Dev Tools UI

This package does NOT modify the existing plugin Manager. It operates alongside it. The plugin Manager continues to handle `LoadPlugin`, `ReloadPlugin`, `UnloadPlugin`, etc. The DevServerManager calls into the plugin Manager's `ReloadPlugin` method after a successful Go rebuild.

## Package Layout

```
backend/pkg/plugin/devserver/
  types.go       -- All type definitions, enums, event constants
  ports.go       -- Port allocator (thread-safe)
  manager.go     -- DevServerManager struct, Wails-bound methods, lifecycle
  instance.go    -- DevServerInstance per-plugin lifecycle
  vite.go        -- Vite process spawning, ready detection, log piping
  gowatch.go     -- Go file watcher, rebuild, binary comparison, transfer
```

## Dependencies

All dependencies are already in `go.mod`. No new modules required.

| Import | Used for |
|--------|----------|
| `github.com/fsnotify/fsnotify` | Go file watching |
| `github.com/wailsapp/wails/v2/pkg/runtime` | `runtime.EventsEmit` |
| `go.uber.org/zap` | Structured logging |
| `github.com/omniviewdev/settings` | Reading `developer.gopath`, `developer.pnpmpath`, `developer.nodepath` |
| `github.com/omniviewdev/omniview/backend/pkg/plugin` | `plugin.Manager` interface for `ReloadPlugin` |
| `github.com/omniviewdev/omniview/backend/pkg/plugin/types` | `BuildOpts` |

---

## File: `types.go`

```go
package devserver

import (
	"time"
)

// ============================================================================
// Event constants
// ============================================================================

const (
	// EventDevServerStatus is emitted whenever any field in DevServerState changes.
	// Payload: DevServerState
	EventDevServerStatus = "plugin/devserver/status"

	// EventDevServerLog is emitted for batched log lines from Vite or Go build.
	// Payload: []LogEntry (each entry contains pluginID)
	EventDevServerLog = "plugin/devserver/log"

	// EventDevServerError is emitted for structured build errors.
	// Payload: (pluginID string, errors []BuildError)
	EventDevServerError = "plugin/devserver/error"
)

// ============================================================================
// Enums
// ============================================================================

// DevServerMode describes how the dev server for a plugin is managed.
type DevServerMode string

const (
	// DevServerModeIdle means no dev server is running for this plugin.
	DevServerModeIdle DevServerMode = "idle"

	// DevServerModeManaged means the IDE spawned and manages the Vite + Go watcher processes.
	DevServerModeManaged DevServerMode = "managed"

	// DevServerModeExternal means the developer runs processes externally;
	// the IDE connects via .devinfo file.
	DevServerModeExternal DevServerMode = "external"
)

// DevProcessStatus describes the current status of either the Vite process or the Go watcher.
type DevProcessStatus string

const (
	DevProcessStatusIdle     DevProcessStatus = "idle"
	DevProcessStatusStarting DevProcessStatus = "starting"
	DevProcessStatusBuilding DevProcessStatus = "building"
	DevProcessStatusRunning  DevProcessStatus = "running"
	DevProcessStatusReady    DevProcessStatus = "ready"
	DevProcessStatusError    DevProcessStatus = "error"
	DevProcessStatusStopped  DevProcessStatus = "stopped"
)

// ============================================================================
// State types (JSON-serializable for frontend)
// ============================================================================

// DevServerState is the JSON-serializable state of a single plugin's dev server.
// This is sent to the frontend via Wails events and returned from query methods.
type DevServerState struct {
	PluginID  string           `json:"pluginID"`
	Mode      DevServerMode    `json:"mode"`
	DevPath   string           `json:"devPath"`
	VitePort  int              `json:"vitePort"`
	ViteURL   string           `json:"viteURL"`
	ViteStatus DevProcessStatus `json:"viteStatus"`
	GoStatus  DevProcessStatus `json:"goStatus"`
	LastBuildDuration time.Duration `json:"lastBuildDuration"`
	LastBuildTime     time.Time     `json:"lastBuildTime"`
	LastError         string        `json:"lastError"`
	GRPCConnected     bool          `json:"grpcConnected"`
}

// LogEntry is a single log line from either the Vite process or the Go build.
type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Source    string    `json:"source"` // "vite" | "go-build" | "go-watch" | "manager"
	Level     string    `json:"level"`  // "info" | "warn" | "error" | "debug"
	Message   string    `json:"message"`
	PluginID  string    `json:"pluginID"`
}

// BuildError is a structured build error parsed from Go compiler output.
type BuildError struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Message string `json:"message"`
}

// DevInfoFile is the JSON structure of the .devinfo file written by externally-run plugins.
// This is used for external mode (Phase 6). Defined here for type completeness; the full
// external mode implementation is in a later phase.
type DevInfoFile struct {
	PID             int    `json:"pid"`
	Protocol        string `json:"protocol"`
	ProtocolVersion int    `json:"protocolVersion"`
	Addr            string `json:"addr"`
	VitePort        int    `json:"vitePort"`
}

// ============================================================================
// Ring buffer for log storage
// ============================================================================

const DefaultLogBufferSize = 5000

// LogRingBuffer is a fixed-size circular buffer for log entries.
// It is NOT thread-safe on its own; callers must hold the instance mutex.
type LogRingBuffer struct {
	entries []LogEntry
	head    int
	count   int
	cap     int
}

// NewLogRingBuffer creates a ring buffer with the given capacity.
func NewLogRingBuffer(capacity int) *LogRingBuffer {
	return &LogRingBuffer{
		entries: make([]LogEntry, capacity),
		cap:     capacity,
	}
}

// Push adds an entry to the ring buffer, overwriting the oldest if full.
func (rb *LogRingBuffer) Push(entry LogEntry) {
	idx := (rb.head + rb.count) % rb.cap
	rb.entries[idx] = entry
	if rb.count == rb.cap {
		// Buffer is full; advance head to overwrite oldest.
		rb.head = (rb.head + 1) % rb.cap
	} else {
		rb.count++
	}
}

// Entries returns all entries in chronological order (oldest first).
func (rb *LogRingBuffer) Entries() []LogEntry {
	result := make([]LogEntry, rb.count)
	for i := 0; i < rb.count; i++ {
		result[i] = rb.entries[(rb.head+i)%rb.cap]
	}
	return result
}

// Last returns the most recent n entries in chronological order.
func (rb *LogRingBuffer) Last(n int) []LogEntry {
	if n > rb.count {
		n = rb.count
	}
	result := make([]LogEntry, n)
	start := rb.count - n
	for i := 0; i < n; i++ {
		result[i] = rb.entries[(rb.head+start+i)%rb.cap]
	}
	return result
}

// Clear resets the buffer.
func (rb *LogRingBuffer) Clear() {
	rb.head = 0
	rb.count = 0
}
```

---

## File: `ports.go`

```go
package devserver

import (
	"fmt"
	"net"
	"sync"
)

const (
	PortRangeStart = 15173
	PortRangeEnd   = 15273
)

// PortAllocator manages port allocation for Vite dev servers.
// It tracks which ports are currently in use and finds free ones.
type PortAllocator struct {
	mu       sync.Mutex
	assigned map[int]string // port -> pluginID
}

// NewPortAllocator creates a new PortAllocator.
func NewPortAllocator() *PortAllocator {
	return &PortAllocator{
		assigned: make(map[int]string),
	}
}

// Allocate finds a free port in the range [PortRangeStart, PortRangeEnd) and
// reserves it for the given pluginID. Returns the port number or an error if
// no port is available.
func (pa *PortAllocator) Allocate(pluginID string) (int, error) {
	pa.mu.Lock()
	defer pa.mu.Unlock()

	for port := PortRangeStart; port < PortRangeEnd; port++ {
		// Skip if already assigned in our tracking map.
		if _, taken := pa.assigned[port]; taken {
			continue
		}

		// Verify the port is actually free by attempting to listen.
		if !isPortFree(port) {
			continue
		}

		pa.assigned[port] = pluginID
		return port, nil
	}

	return 0, fmt.Errorf("no free port available in range %d-%d", PortRangeStart, PortRangeEnd)
}

// Release frees a previously allocated port.
func (pa *PortAllocator) Release(port int) {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	delete(pa.assigned, port)
}

// ReleaseByPlugin frees the port allocated to the given plugin ID, if any.
// Returns the port that was released, or 0 if no port was allocated.
func (pa *PortAllocator) ReleaseByPlugin(pluginID string) int {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	for port, id := range pa.assigned {
		if id == pluginID {
			delete(pa.assigned, port)
			return port
		}
	}
	return 0
}

// GetPort returns the port assigned to a plugin, or 0 if none.
func (pa *PortAllocator) GetPort(pluginID string) int {
	pa.mu.Lock()
	defer pa.mu.Unlock()
	for port, id := range pa.assigned {
		if id == pluginID {
			return port
		}
	}
	return 0
}

// isPortFree checks if a TCP port is available by attempting to listen on it.
func isPortFree(port int) bool {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	ln.Close()
	return true
}
```

---

## File: `manager.go`

```go
package devserver

import (
	"context"
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	pkgsettings "github.com/omniviewdev/settings"
)

// DevServerManager manages dev server instances for plugins in development mode.
// It is exposed as a Wails binding. All public methods are callable from the frontend.
type DevServerManager struct {
	ctx              context.Context
	logger           *zap.SugaredLogger
	mu               sync.RWMutex
	instances        map[string]*DevServerInstance // pluginID -> instance
	ports            *PortAllocator
	pluginMgr        plugin.Manager
	settingsProvider pkgsettings.Provider
}

// NewManager creates a new DevServerManager. Call Initialize() with the Wails
// context before using any other methods.
func NewManager(
	logger *zap.SugaredLogger,
	pluginMgr plugin.Manager,
	settingsProvider pkgsettings.Provider,
) *DevServerManager {
	return &DevServerManager{
		logger:           logger.Named("DevServerManager"),
		instances:        make(map[string]*DevServerInstance),
		ports:            NewPortAllocator(),
		pluginMgr:        pluginMgr,
		settingsProvider: settingsProvider,
	}
}

// Initialize is called during Wails startup (OnStartup callback). It stores the
// Wails context needed for runtime.EventsEmit.
func (m *DevServerManager) Initialize(ctx context.Context) {
	m.ctx = ctx
	m.logger.Info("DevServerManager initialized")
}

// Shutdown stops all running dev server instances. Called from Wails OnShutdown.
func (m *DevServerManager) Shutdown() {
	m.logger.Info("DevServerManager shutting down")

	m.mu.RLock()
	ids := make([]string, 0, len(m.instances))
	for id := range m.instances {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	for _, id := range ids {
		if err := m.StopDevServer(id); err != nil {
			m.logger.Errorw("error stopping dev server during shutdown",
				"pluginID", id,
				"error", err,
			)
		}
	}

	m.logger.Info("DevServerManager shutdown complete")
}

// ============================================================================
// Wails-bound methods (callable from frontend)
// ============================================================================

// StartDevServer starts a managed dev server for the given plugin. This spawns
// a Vite dev server process and a Go file watcher. The plugin must already be
// loaded in dev mode (DevMode=true, DevPath set).
//
// Returns the initial DevServerState.
func (m *DevServerManager) StartDevServer(pluginID string) (DevServerState, error) {
	l := m.logger.With("method", "StartDevServer", "pluginID", pluginID)
	l.Info("starting dev server")

	m.mu.Lock()

	// Check if already running.
	if inst, exists := m.instances[pluginID]; exists {
		m.mu.Unlock()
		l.Warn("dev server already running")
		return inst.State(), nil
	}

	// Look up the plugin to get DevPath.
	p, err := m.pluginMgr.GetPlugin(pluginID)
	if err != nil {
		m.mu.Unlock()
		return DevServerState{}, fmt.Errorf("plugin not found: %w", err)
	}
	if !p.DevMode {
		m.mu.Unlock()
		return DevServerState{}, fmt.Errorf("plugin %q is not in dev mode", pluginID)
	}
	if p.DevPath == "" {
		m.mu.Unlock()
		return DevServerState{}, fmt.Errorf("plugin %q has no DevPath set", pluginID)
	}

	// Allocate a port for the Vite dev server.
	port, err := m.ports.Allocate(pluginID)
	if err != nil {
		m.mu.Unlock()
		return DevServerState{}, fmt.Errorf("port allocation failed: %w", err)
	}

	// Resolve build tool paths from settings.
	buildOpts := m.resolveBuildOpts()

	// Create the instance.
	inst := NewDevServerInstance(
		m.ctx,
		m.logger,
		pluginID,
		p.DevPath,
		port,
		buildOpts,
		m.pluginMgr,
		m.emitStatus,
		m.emitLogs,
		m.emitErrors,
	)

	m.instances[pluginID] = inst
	m.mu.Unlock()

	// Start the instance (non-blocking; spawns goroutines).
	if err := inst.Start(); err != nil {
		m.mu.Lock()
		delete(m.instances, pluginID)
		m.mu.Unlock()
		m.ports.Release(port)
		return DevServerState{}, fmt.Errorf("failed to start dev server: %w", err)
	}

	state := inst.State()
	m.emitStatus(pluginID, state)

	l.Infow("dev server started", "port", port)
	return state, nil
}

// StopDevServer stops the managed dev server for the given plugin.
// Tears down both Vite and the Go watcher.
func (m *DevServerManager) StopDevServer(pluginID string) error {
	l := m.logger.With("method", "StopDevServer", "pluginID", pluginID)
	l.Info("stopping dev server")

	m.mu.Lock()
	inst, exists := m.instances[pluginID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("no dev server running for plugin %q", pluginID)
	}
	delete(m.instances, pluginID)
	m.mu.Unlock()

	// Stop the instance (blocks until processes are dead).
	inst.Stop()

	// Release the port.
	m.ports.ReleaseByPlugin(pluginID)

	// Emit final state.
	state := DevServerState{
		PluginID:   pluginID,
		Mode:       DevServerModeIdle,
		ViteStatus: DevProcessStatusStopped,
		GoStatus:   DevProcessStatusStopped,
	}
	m.emitStatus(pluginID, state)

	l.Info("dev server stopped")
	return nil
}

// RestartDevServer stops and then starts the dev server for the given plugin.
func (m *DevServerManager) RestartDevServer(pluginID string) (DevServerState, error) {
	m.logger.Infow("restarting dev server", "pluginID", pluginID)

	// Stop first; ignore "not running" errors.
	_ = m.StopDevServer(pluginID)

	return m.StartDevServer(pluginID)
}

// GetDevServerState returns the current state of the dev server for a single plugin.
// Returns an idle state if no dev server is running.
func (m *DevServerManager) GetDevServerState(pluginID string) DevServerState {
	m.mu.RLock()
	defer m.mu.RUnlock()

	inst, exists := m.instances[pluginID]
	if !exists {
		return DevServerState{
			PluginID: pluginID,
			Mode:     DevServerModeIdle,
		}
	}
	return inst.State()
}

// ListDevServerStates returns the state of all running dev server instances.
func (m *DevServerManager) ListDevServerStates() []DevServerState {
	m.mu.RLock()
	defer m.mu.RUnlock()

	states := make([]DevServerState, 0, len(m.instances))
	for _, inst := range m.instances {
		states = append(states, inst.State())
	}
	return states
}

// GetDevServerLogs returns the most recent log entries for a plugin's dev server.
// If count is 0, returns all buffered entries (up to DefaultLogBufferSize).
func (m *DevServerManager) GetDevServerLogs(pluginID string, count int) []LogEntry {
	m.mu.RLock()
	inst, exists := m.instances[pluginID]
	m.mu.RUnlock()

	if !exists {
		return nil
	}

	return inst.GetLogs(count)
}

// AttachExternal attaches to an externally-running plugin dev server.
// This is a stub for Phase 6 (External Mode). The full implementation will
// parse .devinfo files and use go-plugin ReattachConfig.
func (m *DevServerManager) AttachExternal(pluginID string, vitePort int) (DevServerState, error) {
	// Phase 6 implementation placeholder.
	return DevServerState{
		PluginID: pluginID,
		Mode:     DevServerModeExternal,
	}, fmt.Errorf("external mode not yet implemented")
}

// DetachExternal detaches from an externally-running plugin dev server.
// Stub for Phase 6.
func (m *DevServerManager) DetachExternal(pluginID string) error {
	return fmt.Errorf("external mode not yet implemented")
}

// IsManaged returns true if the plugin's dev server is currently managed by this manager.
func (m *DevServerManager) IsManaged(pluginID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	inst, exists := m.instances[pluginID]
	if !exists {
		return false
	}
	return inst.mode == DevServerModeManaged
}

// ============================================================================
// Internal helpers
// ============================================================================

// resolveBuildOpts reads developer tool paths from the settings provider.
func (m *DevServerManager) resolveBuildOpts() BuildOpts {
	opts := BuildOpts{}
	opts.GoPath, _ = m.settingsProvider.GetString("developer.gopath")
	opts.PnpmPath, _ = m.settingsProvider.GetString("developer.pnpmpath")
	opts.NodePath, _ = m.settingsProvider.GetString("developer.nodepath")
	return opts
}

// emitStatus emits the dev server status event to the frontend.
func (m *DevServerManager) emitStatus(pluginID string, state DevServerState) {
	if m.ctx == nil {
		return
	}
	runtime.EventsEmit(m.ctx, EventDevServerStatus, state)
}

// emitLogs emits a batch of log entries to the frontend.
func (m *DevServerManager) emitLogs(pluginID string, entries []LogEntry) {
	if m.ctx == nil || len(entries) == 0 {
		return
	}
	runtime.EventsEmit(m.ctx, EventDevServerLog, entries)
}

// emitErrors emits structured build errors to the frontend.
func (m *DevServerManager) emitErrors(pluginID string, errors []BuildError) {
	if m.ctx == nil || len(errors) == 0 {
		return
	}
	runtime.EventsEmit(m.ctx, EventDevServerError, pluginID, errors)
}

// BuildOpts holds resolved paths to build tools. This is a local copy; the canonical
// type is in backend/pkg/plugin/types.BuildOpts. We duplicate it here to avoid a
// circular import (devserver -> plugin -> devserver). The manager.go resolves
// settings into this struct and passes it to instances.
type BuildOpts struct {
	GoPath   string
	PnpmPath string
	NodePath string
}
```

---

## File: `instance.go`

```go
package devserver

import (
	"context"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
)

// emitStatusFunc is the callback type for emitting status updates.
type emitStatusFunc func(pluginID string, state DevServerState)

// emitLogsFunc is the callback type for emitting log batches.
type emitLogsFunc func(pluginID string, entries []LogEntry)

// emitErrorsFunc is the callback type for emitting build errors.
type emitErrorsFunc func(pluginID string, errors []BuildError)

// DevServerInstance manages the dev server lifecycle for a single plugin.
// It coordinates the Vite process and Go file watcher.
type DevServerInstance struct {
	// Immutable fields (set at construction, never change)
	ctx       context.Context
	cancel    context.CancelFunc
	logger    *zap.SugaredLogger
	pluginID  string
	devPath   string // absolute path to the plugin source directory
	vitePort  int
	buildOpts BuildOpts
	pluginMgr plugin.Manager

	// Event emission callbacks (bound to DevServerManager methods)
	onStatus emitStatusFunc
	onLogs   emitLogsFunc
	onErrors emitErrorsFunc

	// Mutable state (protected by mu)
	mu                sync.RWMutex
	mode              DevServerMode
	viteStatus        DevProcessStatus
	goStatus          DevProcessStatus
	lastBuildDuration time.Duration
	lastBuildTime     time.Time
	lastError         string
	grpcConnected     bool

	// Sub-components
	logBuffer *LogRingBuffer
	vite      *viteProcess
	goWatcher *goWatcherProcess
}

// NewDevServerInstance creates a new instance. Call Start() to begin.
func NewDevServerInstance(
	parentCtx context.Context,
	logger *zap.SugaredLogger,
	pluginID string,
	devPath string,
	vitePort int,
	buildOpts BuildOpts,
	pluginMgr plugin.Manager,
	onStatus emitStatusFunc,
	onLogs emitLogsFunc,
	onErrors emitErrorsFunc,
) *DevServerInstance {
	ctx, cancel := context.WithCancel(parentCtx)

	return &DevServerInstance{
		ctx:       ctx,
		cancel:    cancel,
		logger:    logger.Named("instance").With("pluginID", pluginID),
		pluginID:  pluginID,
		devPath:   devPath,
		vitePort:  vitePort,
		buildOpts: buildOpts,
		pluginMgr: pluginMgr,
		onStatus:  onStatus,
		onLogs:    onLogs,
		onErrors:  onErrors,
		mode:      DevServerModeManaged,
		viteStatus: DevProcessStatusIdle,
		goStatus:   DevProcessStatusIdle,
		logBuffer:  NewLogRingBuffer(DefaultLogBufferSize),
	}
}

// Start spawns the Vite dev server and Go watcher in background goroutines.
// Returns an error only if initial setup fails (e.g., directory doesn't exist).
func (inst *DevServerInstance) Start() error {
	inst.logger.Info("starting dev server instance")

	// Start Vite process.
	inst.vite = newViteProcess(
		inst.ctx,
		inst.logger,
		inst.pluginID,
		inst.devPath,
		inst.vitePort,
		inst.buildOpts,
		inst.appendLog,
		inst.setViteStatus,
	)
	if err := inst.vite.Start(); err != nil {
		inst.setViteStatus(DevProcessStatusError)
		inst.setLastError(err.Error())
		return err
	}

	// Start Go watcher.
	inst.goWatcher = newGoWatcherProcess(
		inst.ctx,
		inst.logger,
		inst.pluginID,
		inst.devPath,
		inst.buildOpts,
		inst.pluginMgr,
		inst.appendLog,
		inst.setGoStatus,
		inst.setBuildResult,
		inst.onErrors,
	)
	if err := inst.goWatcher.Start(); err != nil {
		// Vite started successfully but Go watcher failed. Stop Vite before returning.
		inst.vite.Stop()
		inst.setGoStatus(DevProcessStatusError)
		inst.setLastError(err.Error())
		return err
	}

	return nil
}

// Stop gracefully stops both the Vite process and Go watcher.
// Blocks until both are fully stopped.
func (inst *DevServerInstance) Stop() {
	inst.logger.Info("stopping dev server instance")

	// Cancel the context to signal both processes.
	inst.cancel()

	// Stop Vite (SIGTERM, wait, SIGKILL).
	if inst.vite != nil {
		inst.vite.Stop()
	}

	// Stop the Go watcher.
	if inst.goWatcher != nil {
		inst.goWatcher.Stop()
	}

	inst.setViteStatus(DevProcessStatusStopped)
	inst.setGoStatus(DevProcessStatusStopped)

	inst.logger.Info("dev server instance stopped")
}

// State returns a snapshot of the current state, safe for JSON serialization.
func (inst *DevServerInstance) State() DevServerState {
	inst.mu.RLock()
	defer inst.mu.RUnlock()

	viteURL := ""
	if inst.vitePort > 0 && inst.viteStatus == DevProcessStatusReady {
		viteURL = fmt.Sprintf("http://127.0.0.1:%d", inst.vitePort)
	}

	return DevServerState{
		PluginID:          inst.pluginID,
		Mode:              inst.mode,
		DevPath:           inst.devPath,
		VitePort:          inst.vitePort,
		ViteURL:           viteURL,
		ViteStatus:        inst.viteStatus,
		GoStatus:          inst.goStatus,
		LastBuildDuration: inst.lastBuildDuration,
		LastBuildTime:     inst.lastBuildTime,
		LastError:         inst.lastError,
		GRPCConnected:     inst.grpcConnected,
	}
}

// GetLogs returns log entries from the ring buffer.
// If count <= 0, returns all buffered entries.
func (inst *DevServerInstance) GetLogs(count int) []LogEntry {
	inst.mu.RLock()
	defer inst.mu.RUnlock()

	if count <= 0 {
		return inst.logBuffer.Entries()
	}
	return inst.logBuffer.Last(count)
}

// ============================================================================
// Internal state mutation helpers (all acquire write lock)
// ============================================================================

func (inst *DevServerInstance) setViteStatus(status DevProcessStatus) {
	inst.mu.Lock()
	inst.viteStatus = status
	inst.mu.Unlock()

	inst.onStatus(inst.pluginID, inst.State())
}

func (inst *DevServerInstance) setGoStatus(status DevProcessStatus) {
	inst.mu.Lock()
	inst.goStatus = status
	inst.mu.Unlock()

	inst.onStatus(inst.pluginID, inst.State())
}

func (inst *DevServerInstance) setLastError(msg string) {
	inst.mu.Lock()
	inst.lastError = msg
	inst.mu.Unlock()
}

func (inst *DevServerInstance) setBuildResult(duration time.Duration, buildErr string) {
	inst.mu.Lock()
	inst.lastBuildDuration = duration
	inst.lastBuildTime = time.Now()
	if buildErr != "" {
		inst.lastError = buildErr
	} else {
		inst.lastError = ""
		inst.grpcConnected = true
	}
	inst.mu.Unlock()

	inst.onStatus(inst.pluginID, inst.State())
}

// appendLog adds a log entry to the ring buffer and batches it for emission.
// The batching happens in a separate goroutine per instance (see logFlusher).
func (inst *DevServerInstance) appendLog(entry LogEntry) {
	entry.PluginID = inst.pluginID
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now()
	}

	inst.mu.Lock()
	inst.logBuffer.Push(entry)
	inst.mu.Unlock()

	// For simplicity in Phase 2, emit each log entry immediately in a small batch.
	// A future optimization can batch on a 100ms timer.
	inst.onLogs(inst.pluginID, []LogEntry{entry})
}
```

Note: `instance.go` requires `"fmt"` for `Sprintf` in the `State()` method. Full import:

```go
import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
)
```

---

## File: `vite.go`

```go
package devserver

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"go.uber.org/zap"
)

const (
	// viteReadyTimeout is how long we wait for Vite to print its "Local:" URL.
	viteReadyTimeout = 30 * time.Second

	// viteStopGracePeriod is how long we wait after SIGTERM before sending SIGKILL.
	viteStopGracePeriod = 5 * time.Second
)

// viteProcess manages a single Vite dev server child process.
type viteProcess struct {
	ctx       context.Context
	logger    *zap.SugaredLogger
	pluginID  string
	devPath   string
	port      int
	buildOpts BuildOpts

	appendLog func(LogEntry)
	setStatus func(DevProcessStatus)

	mu   sync.Mutex
	cmd  *exec.Cmd
	done chan struct{} // closed when the process exits
}

// newViteProcess creates a viteProcess. Call Start() to spawn.
func newViteProcess(
	ctx context.Context,
	logger *zap.SugaredLogger,
	pluginID string,
	devPath string,
	port int,
	buildOpts BuildOpts,
	appendLog func(LogEntry),
	setStatus func(DevProcessStatus),
) *viteProcess {
	return &viteProcess{
		ctx:       ctx,
		logger:    logger.Named("vite"),
		pluginID:  pluginID,
		devPath:   devPath,
		port:      port,
		buildOpts: buildOpts,
		appendLog: appendLog,
		setStatus: setStatus,
		done:      make(chan struct{}),
	}
}

// Start spawns `pnpm run dev --port <port> --strictPort` in the plugin's ui/ directory.
// It returns once the command is spawned (not when Vite is ready).
// Ready detection happens asynchronously; the status will transition to "ready"
// when Vite's "Local:" output line is detected.
func (vp *viteProcess) Start() error {
	vp.mu.Lock()
	defer vp.mu.Unlock()

	vp.setStatus(DevProcessStatusStarting)

	uiDir := filepath.Join(vp.devPath, "ui")
	if _, err := os.Stat(uiDir); os.IsNotExist(err) {
		return fmt.Errorf("plugin ui directory does not exist: %s", uiDir)
	}

	// Resolve pnpm path.
	pnpmPath := vp.buildOpts.PnpmPath
	if pnpmPath == "" {
		return fmt.Errorf("pnpm path not configured; set developer.pnpmpath in settings")
	}

	// Build the command with proper PATH.
	args := []string{
		"run", "dev",
		"--", // pass remaining args to vite
		"--port", fmt.Sprintf("%d", vp.port),
		"--strictPort",
		"--host", "127.0.0.1",
	}

	cmd := exec.CommandContext(vp.ctx, pnpmPath, args...)
	cmd.Dir = uiDir

	// Set up environment with proper PATH including node and pnpm directories.
	env := os.Environ()
	extraDirs := []string{}
	if vp.buildOpts.PnpmPath != "" {
		extraDirs = append(extraDirs, filepath.Dir(vp.buildOpts.PnpmPath))
	}
	if vp.buildOpts.NodePath != "" {
		extraDirs = append(extraDirs, filepath.Dir(vp.buildOpts.NodePath))
	}
	env = prependToPath(env, extraDirs)
	cmd.Env = env

	// Use a process group so we can kill all child processes.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	// Capture stdout and stderr.
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start vite process: %w", err)
	}

	vp.cmd = cmd
	vp.logger.Infow("vite process spawned", "pid", cmd.Process.Pid, "port", vp.port)

	vp.appendLog(LogEntry{
		Source:  "vite",
		Level:   "info",
		Message: fmt.Sprintf("Vite dev server starting on port %d (pid %d)", vp.port, cmd.Process.Pid),
	})

	// Channel to signal when the "ready" line is detected.
	readyCh := make(chan struct{}, 1)

	// Pipe stdout, scanning for the ready signal.
	go func() {
		scanner := bufio.NewScanner(stdoutPipe)
		for scanner.Scan() {
			line := scanner.Text()
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "info",
				Message: line,
			})

			// Vite prints something like:
			//   ➜  Local:   http://127.0.0.1:15173/
			// We detect readiness by finding "Local:" in the output.
			if strings.Contains(line, "Local:") && strings.Contains(line, fmt.Sprintf("%d", vp.port)) {
				select {
				case readyCh <- struct{}{}:
				default:
				}
			}
		}
		if err := scanner.Err(); err != nil {
			vp.logger.Warnw("vite stdout scanner error", "error", err)
		}
	}()

	// Pipe stderr.
	go func() {
		scanner := bufio.NewScanner(stderrPipe)
		for scanner.Scan() {
			line := scanner.Text()
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "error",
				Message: line,
			})
		}
	}()

	// Wait for the process to exit in a goroutine.
	go func() {
		err := cmd.Wait()
		if err != nil {
			vp.logger.Warnw("vite process exited with error", "error", err)
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "error",
				Message: fmt.Sprintf("Vite process exited: %v", err),
			})
		} else {
			vp.logger.Info("vite process exited cleanly")
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "info",
				Message: "Vite process exited",
			})
		}
		close(vp.done)
	}()

	// Wait for the "ready" signal or timeout.
	go func() {
		select {
		case <-readyCh:
			vp.setStatus(DevProcessStatusReady)
			vp.logger.Infow("vite dev server is ready", "port", vp.port)
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "info",
				Message: fmt.Sprintf("Vite dev server ready at http://127.0.0.1:%d", vp.port),
			})
		case <-time.After(viteReadyTimeout):
			vp.setStatus(DevProcessStatusError)
			vp.logger.Errorw("vite dev server did not become ready in time", "timeout", viteReadyTimeout)
			vp.appendLog(LogEntry{
				Source:  "vite",
				Level:   "error",
				Message: fmt.Sprintf("Vite did not become ready within %s", viteReadyTimeout),
			})
		case <-vp.done:
			// Process exited before ready; status will be set by the waiter.
			vp.setStatus(DevProcessStatusError)
		case <-vp.ctx.Done():
			// Context cancelled.
			return
		}
	}()

	return nil
}

// Stop sends SIGTERM to the Vite process group, waits up to viteStopGracePeriod,
// then sends SIGKILL if it's still running.
func (vp *viteProcess) Stop() {
	vp.mu.Lock()
	cmd := vp.cmd
	vp.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return
	}

	vp.logger.Info("stopping vite process")

	// Send SIGTERM to the process group (negative PID = process group).
	pgid, err := syscall.Getpgid(cmd.Process.Pid)
	if err == nil {
		_ = syscall.Kill(-pgid, syscall.SIGTERM)
	} else {
		_ = cmd.Process.Signal(syscall.SIGTERM)
	}

	// Wait for exit or timeout.
	select {
	case <-vp.done:
		vp.logger.Info("vite process stopped after SIGTERM")
		return
	case <-time.After(viteStopGracePeriod):
		vp.logger.Warn("vite process did not stop after SIGTERM; sending SIGKILL")
		if pgid > 0 {
			_ = syscall.Kill(-pgid, syscall.SIGKILL)
		} else {
			_ = cmd.Process.Kill()
		}
	}

	// Wait for final exit after SIGKILL.
	select {
	case <-vp.done:
		vp.logger.Info("vite process stopped after SIGKILL")
	case <-time.After(3 * time.Second):
		vp.logger.Error("vite process did not exit after SIGKILL; giving up")
	}
}

// prependToPath adds directories to the front of the PATH environment variable.
func prependToPath(env []string, dirs []string) []string {
	if len(dirs) == 0 {
		return env
	}
	prefix := strings.Join(dirs, string(os.PathListSeparator))

	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			current := strings.TrimPrefix(e, "PATH=")
			env[i] = "PATH=" + prefix + string(os.PathListSeparator) + current
			return env
		}
	}
	// PATH not found; add it.
	return append(env, "PATH="+prefix)
}
```

---

## File: `gowatch.go`

```go
package devserver

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"go.uber.org/zap"
	"golang.org/x/exp/slices"

	"github.com/omniviewdev/omniview/backend/pkg/plugin"
)

const (
	// DedupInterval is the debounce window for file change events.
	// Matches the existing constant in backend/pkg/plugin/dev.go.
	DedupInterval = 500 * time.Millisecond
)

// goWatcherProcess watches Go source files for changes and rebuilds the plugin binary.
type goWatcherProcess struct {
	ctx    context.Context
	cancel context.CancelFunc
	logger *zap.SugaredLogger

	pluginID  string
	devPath   string
	buildOpts BuildOpts
	pluginMgr plugin.Manager

	appendLog  func(LogEntry)
	setStatus  func(DevProcessStatus)
	setBuild   func(duration time.Duration, buildErr string)
	emitErrors func(pluginID string, errors []BuildError)

	watcher *fsnotify.Watcher
	done    chan struct{} // closed when the watcher goroutine exits
}

// newGoWatcherProcess creates a Go watcher. Call Start() to begin watching.
func newGoWatcherProcess(
	parentCtx context.Context,
	logger *zap.SugaredLogger,
	pluginID string,
	devPath string,
	buildOpts BuildOpts,
	pluginMgr plugin.Manager,
	appendLog func(LogEntry),
	setStatus func(DevProcessStatus),
	setBuild func(duration time.Duration, buildErr string),
	emitErrors func(pluginID string, errors []BuildError),
) *goWatcherProcess {
	ctx, cancel := context.WithCancel(parentCtx)
	return &goWatcherProcess{
		ctx:        ctx,
		cancel:     cancel,
		logger:     logger.Named("gowatch"),
		pluginID:   pluginID,
		devPath:    devPath,
		buildOpts:  buildOpts,
		pluginMgr:  pluginMgr,
		appendLog:  appendLog,
		setStatus:  setStatus,
		setBuild:   setBuild,
		emitErrors: emitErrors,
		done:       make(chan struct{}),
	}
}

// Start initializes the fsnotify watcher, walks the `pkg/` directory to register
// all subdirectories, and starts the event loop goroutine.
func (gw *goWatcherProcess) Start() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}
	gw.watcher = watcher

	// Walk the pkg/ directory and add all subdirectories.
	pkgDir := filepath.Join(gw.devPath, "pkg")
	if _, err := os.Stat(pkgDir); os.IsNotExist(err) {
		watcher.Close()
		return fmt.Errorf("plugin pkg/ directory does not exist: %s", pkgDir)
	}

	watchCount := 0
	err = filepath.Walk(pkgDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Skip hidden directories and vendor.
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".") || base == "vendor" || base == "node_modules" {
				return filepath.SkipDir
			}
			if addErr := watcher.Add(path); addErr != nil {
				gw.logger.Warnw("failed to watch directory", "path", path, "error", addErr)
			} else {
				watchCount++
			}
		}
		return nil
	})
	if err != nil {
		watcher.Close()
		return fmt.Errorf("failed to walk pkg/ directory: %w", err)
	}

	gw.logger.Infow("go file watcher started", "directories", watchCount)
	gw.appendLog(LogEntry{
		Source:  "go-watch",
		Level:   "info",
		Message: fmt.Sprintf("Watching %d directories under pkg/", watchCount),
	})
	gw.setStatus(DevProcessStatusReady)

	// Start the event loop.
	go gw.eventLoop()

	return nil
}

// Stop shuts down the fsnotify watcher and waits for the event loop to exit.
func (gw *goWatcherProcess) Stop() {
	gw.cancel()
	if gw.watcher != nil {
		gw.watcher.Close()
	}
	// Wait for the event loop to finish.
	select {
	case <-gw.done:
	case <-time.After(5 * time.Second):
		gw.logger.Warn("go watcher event loop did not exit in time")
	}
}

// eventLoop processes fsnotify events with debouncing.
func (gw *goWatcherProcess) eventLoop() {
	defer close(gw.done)

	var (
		mu     sync.Mutex
		timers = make(map[string]*time.Timer)
	)

	goExtensions := []string{".go", ".mod", ".sum"}

	for {
		select {
		case <-gw.ctx.Done():
			return

		case err, ok := <-gw.watcher.Errors:
			if !ok {
				return
			}
			gw.logger.Errorw("fsnotify error", "error", err)
			gw.appendLog(LogEntry{
				Source:  "go-watch",
				Level:   "error",
				Message: fmt.Sprintf("Watcher error: %v", err),
			})

		case event, ok := <-gw.watcher.Events:
			if !ok {
				return
			}

			// Only care about Create and Write events on Go files.
			if !event.Has(fsnotify.Create) && !event.Has(fsnotify.Write) {
				continue
			}
			ext := filepath.Ext(event.Name)
			if !slices.Contains(goExtensions, ext) {
				continue
			}

			gw.logger.Debugw("go file changed", "file", event.Name, "op", event.Op)

			// Debounce: reset the timer for this file path.
			mu.Lock()
			t, exists := timers[event.Name]
			if !exists {
				t = time.AfterFunc(math.MaxInt64, func() {
					gw.handleRebuild(event.Name)
					mu.Lock()
					delete(timers, event.Name)
					mu.Unlock()
				})
				t.Stop()
				timers[event.Name] = t
			}
			t.Reset(DedupInterval)
			mu.Unlock()
		}
	}
}

// handleRebuild performs a go build, copies the binary if successful, and triggers plugin reload.
func (gw *goWatcherProcess) handleRebuild(changedFile string) {
	l := gw.logger.With("changedFile", changedFile)
	l.Info("rebuilding plugin binary")

	gw.setStatus(DevProcessStatusBuilding)
	gw.appendLog(LogEntry{
		Source:  "go-build",
		Level:   "info",
		Message: fmt.Sprintf("Building plugin (triggered by %s)", filepath.Base(changedFile)),
	})

	startTime := time.Now()

	// Run go build.
	buildErr := gw.runGoBuild()
	duration := time.Since(startTime)

	if buildErr != nil {
		l.Warnw("go build failed", "duration", duration, "error", buildErr)
		gw.appendLog(LogEntry{
			Source:  "go-build",
			Level:   "error",
			Message: fmt.Sprintf("Build failed in %s: %v", duration.Round(time.Millisecond), buildErr),
		})
		gw.setBuild(duration, buildErr.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	l.Infow("go build succeeded", "duration", duration)
	gw.appendLog(LogEntry{
		Source:  "go-build",
		Level:   "info",
		Message: fmt.Sprintf("Build succeeded in %s", duration.Round(time.Millisecond)),
	})

	// Transfer the binary to ~/.omniview/plugins/<id>/bin/plugin.
	if err := gw.transferBinary(); err != nil {
		l.Errorw("failed to transfer binary", "error", err)
		gw.appendLog(LogEntry{
			Source:  "go-build",
			Level:   "error",
			Message: fmt.Sprintf("Failed to transfer binary: %v", err),
		})
		gw.setBuild(duration, err.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	gw.appendLog(LogEntry{
		Source:  "go-build",
		Level:   "info",
		Message: "Binary transferred, reloading plugin...",
	})

	// Trigger plugin reload via the plugin manager.
	if _, err := gw.pluginMgr.ReloadPlugin(gw.pluginID); err != nil {
		l.Errorw("plugin reload failed", "error", err)
		gw.appendLog(LogEntry{
			Source:  "go-build",
			Level:   "error",
			Message: fmt.Sprintf("Plugin reload failed: %v", err),
		})
		gw.setBuild(duration, err.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	gw.appendLog(LogEntry{
		Source:  "go-build",
		Level:   "info",
		Message: "Plugin reloaded successfully",
	})
	gw.setBuild(duration, "")
	gw.setStatus(DevProcessStatusReady)
}

// runGoBuild runs `go build -o build/bin/plugin ./pkg` in the plugin's dev directory.
// Returns nil on success, or an error containing the compiler output.
func (gw *goWatcherProcess) runGoBuild() error {
	goPath := gw.buildOpts.GoPath
	if goPath == "" {
		return fmt.Errorf("go binary path not configured; set developer.gopath in settings")
	}

	// Ensure the output directory exists.
	outDir := filepath.Join(gw.devPath, "build", "bin")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return fmt.Errorf("failed to create build output directory: %w", err)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer

	cmd := exec.CommandContext(gw.ctx, goPath, "build", "-o", "build/bin/plugin", "./pkg")
	cmd.Dir = gw.devPath
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Parse build errors from stderr.
		errOutput := stderr.String()
		buildErrors := parseBuildErrors(errOutput, gw.devPath)
		if len(buildErrors) > 0 {
			gw.emitErrors(gw.pluginID, buildErrors)
		}

		// Log each line of the error output.
		for _, line := range strings.Split(errOutput, "\n") {
			if strings.TrimSpace(line) != "" {
				gw.appendLog(LogEntry{
					Source:  "go-build",
					Level:   "error",
					Message: line,
				})
			}
		}

		return fmt.Errorf("build failed: %s", errOutput)
	}

	return nil
}

// transferBinary copies the built binary from <devPath>/build/bin/plugin to
// ~/.omniview/plugins/<pluginID>/bin/plugin.
func (gw *goWatcherProcess) transferBinary() error {
	srcPath := filepath.Join(gw.devPath, "build", "bin", "plugin")
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}
	dstDir := filepath.Join(homeDir, ".omniview", "plugins", gw.pluginID, "bin")
	dstPath := filepath.Join(dstDir, "plugin")

	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Errorf("failed to create plugin bin directory: %w", err)
	}

	// Read source binary.
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("failed to open built binary: %w", err)
	}
	defer srcFile.Close()

	srcInfo, err := srcFile.Stat()
	if err != nil {
		return fmt.Errorf("failed to stat built binary: %w", err)
	}

	// Remove existing binary first (in case it's being held open).
	_ = os.Remove(dstPath)

	dstFile, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, srcInfo.Mode())
	if err != nil {
		return fmt.Errorf("failed to create destination binary: %w", err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return fmt.Errorf("failed to copy binary: %w", err)
	}

	return nil
}

// ============================================================================
// Build error parsing
// ============================================================================

// goErrorRegex matches Go compiler error lines of the form:
//
//	./path/to/file.go:42:10: error message here
var goErrorRegex = regexp.MustCompile(`^(.+\.go):(\d+):(\d+):\s*(.+)$`)

// parseBuildErrors parses Go compiler error output into structured BuildError values.
func parseBuildErrors(output string, basePath string) []BuildError {
	var errors []BuildError
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		matches := goErrorRegex.FindStringSubmatch(line)
		if matches == nil {
			continue
		}

		file := matches[1]
		// Make the file path relative to the plugin's dev path for display.
		if strings.HasPrefix(file, "./") {
			file = filepath.Join(basePath, file[2:])
		}

		lineNum, _ := strconv.Atoi(matches[2])
		colNum, _ := strconv.Atoi(matches[3])
		msg := matches[4]

		errors = append(errors, BuildError{
			File:    file,
			Line:    lineNum,
			Column:  colNum,
			Message: msg,
		})
	}
	return errors
}
```

---

## Wiring into `main.go`

The following changes must be made to `/Users/joshuapare/Repos/omniview/main.go`.

### 1. Add the import

Add to the import block:

```go
"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
```

### 2. Create the DevServerManager

After the `pluginManager` is created (after line 107), add:

```go
devServerManager := devserver.NewManager(log, pluginManager, settingsProvider)
```

### 3. Initialize in the startup callback

Inside the `startup` function, after `pluginManager.Run(ctx)` (after line 135), add:

```go
devServerManager.Initialize(ctx)
```

### 4. Shutdown in OnShutdown

Inside the `OnShutdown` callback (line 163-165), add before `pluginManager.Shutdown()`:

```go
OnShutdown: func(_ context.Context) {
    devServerManager.Shutdown()
    pluginManager.Shutdown()
},
```

### 5. Add to Wails Bind array

Add `devServerManager` to the `Bind` array (after line 176, alongside the other plugin system entries):

```go
Bind: []any{
    app,
    diagnosticsClient,

    // core engines/providers
    settingsProvider,
    trivyClient,

    // plugin system
    pluginManager,
    devServerManager, // <-- ADD THIS
    resourceClient,
    settingsClient,
    execClient,
    networkerClient,
    logsClient,
    dataClient,
    uiClient,
    utilsClient,
},
```

### Complete diff for `main.go`

```diff
 import (
 	"context"
 	"embed"
 	"fmt"

 	pkgsettings "github.com/omniviewdev/settings"
 	"github.com/wailsapp/wails/v2"
 	"github.com/wailsapp/wails/v2/pkg/logger"
 	"github.com/wailsapp/wails/v2/pkg/options"
 	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
 	"github.com/wailsapp/wails/v2/pkg/options/linux"
 	"github.com/wailsapp/wails/v2/pkg/options/mac"
 	"github.com/wailsapp/wails/v2/pkg/options/windows"
 	"github.com/wailsapp/wails/v2/pkg/runtime"

 	"github.com/omniviewdev/omniview/backend/clients"
 	"github.com/omniviewdev/omniview/backend/diagnostics"
 	"github.com/omniviewdev/omniview/backend/menus"
 	"github.com/omniviewdev/omniview/backend/pkg/plugin"
 	"github.com/omniviewdev/omniview/backend/pkg/plugin/data"
+	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
 	"github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
 	pluginlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
 	// ... rest of imports unchanged
 )

@@
 	pluginManager := plugin.NewManager(
 		log,
 		resourceController,
 		settingsController,
 		execController,
 		networkerController,
 		logsController,
 		managers,
 		settingsProvider,
 		pluginRegistryClient,
 	)
+	devServerManager := devserver.NewManager(log, pluginManager, settingsProvider)

@@
 	startup := func(ctx context.Context) {
 		// ... existing code ...
 		pluginManager.Run(ctx)
+		devServerManager.Initialize(ctx)
 		runtime.MenuSetApplicationMenu(ctx, menus.GetMenus(ctx))
 	}

@@
 		OnShutdown: func(_ context.Context) {
+			devServerManager.Shutdown()
 			pluginManager.Shutdown()
 		},

@@
 		Bind: []any{
 			app,
 			diagnosticsClient,
 			settingsProvider,
 			trivyClient,
 			pluginManager,
+			devServerManager,
 			resourceClient,
 			// ... rest unchanged
 		},
```

---

## Wails-Generated TypeScript Bindings

After running `wails generate module`, the following TypeScript types and functions will be generated automatically. For reference, the frontend will have access to:

```typescript
// Auto-generated at packages/omniviewdev-runtime/src/wailsjs/go/devserver/DevServerManager.d.ts

export function StartDevServer(pluginID: string): Promise<devserver.DevServerState>;
export function StopDevServer(pluginID: string): Promise<void>;
export function RestartDevServer(pluginID: string): Promise<devserver.DevServerState>;
export function GetDevServerState(pluginID: string): Promise<devserver.DevServerState>;
export function ListDevServerStates(): Promise<devserver.DevServerState[]>;
export function GetDevServerLogs(pluginID: string, count: number): Promise<devserver.LogEntry[]>;
export function AttachExternal(pluginID: string, vitePort: number): Promise<devserver.DevServerState>;
export function DetachExternal(pluginID: string): Promise<void>;
export function IsManaged(pluginID: string): Promise<boolean>;
```

---

## Wails Event Reference

| Event | Payload | Direction | When emitted |
|-------|---------|-----------|-------------|
| `plugin/devserver/status` | `DevServerState` | Go -> Frontend | Any state field changes |
| `plugin/devserver/log` | `LogEntry[]` (each entry contains pluginID) | Go -> Frontend | New log lines from Vite or Go build |
| `plugin/devserver/error` | `(pluginID: string, errors: BuildError[])` | Go -> Frontend | Go build errors with file/line info |
| `plugin/dev_reload_complete` | `(metadata: PluginMeta)` | Go -> Frontend | Existing event, emitted by plugin.Manager.ReloadPlugin (unchanged) |
| `plugin/dev_reload_start` | `(metadata: PluginMeta)` | Go -> Frontend | Existing event, emitted by plugin.Manager (unchanged) |

---

## Modifications to `backend/pkg/plugin/dev.go`

The existing file watcher in `dev.go` must be updated so that plugins managed by the DevServerManager are skipped. This prevents double-handling of file change events.

### Option A: Skip in `handleWatchEvent`

In `handleWatchEvent`, add an early return if the DevServerManager is managing this plugin. This requires passing a reference to the DevServerManager into the pluginManager. However, to avoid a circular dependency, use an interface.

Add to `backend/pkg/plugin/types/controller.go` (or a new file):

```go
// DevServerChecker allows the plugin manager to check if a plugin is managed
// by the dev server system, without importing the devserver package.
type DevServerChecker interface {
	IsManaged(pluginID string) bool
}
```

Add a field to `pluginManager` in `manager.go`:

```go
type pluginManager struct {
	// ... existing fields ...
	devServerChecker plugintypes.DevServerChecker
}
```

Add a setter method:

```go
// SetDevServerChecker sets the DevServerChecker. This is called after both
// the plugin manager and dev server manager are created to avoid circular deps.
func (pm *pluginManager) SetDevServerChecker(checker plugintypes.DevServerChecker) {
	pm.devServerChecker = checker
}
```

Add to the `Manager` interface:

```go
type Manager interface {
	// ... existing methods ...
	SetDevServerChecker(checker plugintypes.DevServerChecker)
}
```

In `handleWatchEvent` in `dev.go`, add at the top:

```go
func (pm *pluginManager) handleWatchEvent(event fsnotify.Event) error {
	// ... existing target lookup ...

	// Skip if managed by the DevServerManager.
	if pm.devServerChecker != nil {
		// Find the plugin ID for this target path.
		for _, p := range pm.plugins {
			if p.DevMode && p.DevPath == target {
				if pm.devServerChecker.IsManaged(p.ID) {
					pm.logger.Debugw("skipping watch event for dev-server-managed plugin",
						"pluginID", p.ID, "event", event)
					return nil
				}
			}
		}
	}

	// ... rest of existing code ...
}
```

Wire up in `main.go` after both are created:

```go
pluginManager.SetDevServerChecker(devServerManager)
```

### Option B: Do nothing in Phase 2

If backward compatibility is acceptable (some double-builds during the transition period), skip this change in Phase 2 and address it in Phase 5 (Refactor Watcher) as described in the README.

**Recommendation: Use Option A.** It is a minimal change and prevents confusing double-rebuild behavior.

---

## Acceptance Criteria

| # | Criterion | How to verify |
|---|-----------|--------------|
| 1 | `DevServerManager` compiles with no errors | `go build ./backend/pkg/plugin/devserver/...` |
| 2 | `DevServerManager` is registered as a Wails binding | Check `main.go` Bind array includes `devServerManager` |
| 3 | `StartDevServer("some-plugin-id")` spawns a Vite process on the allocated port | Check process list; curl `http://127.0.0.1:<port>/` returns Vite HTML |
| 4 | `StartDevServer` starts a Go file watcher on `<devPath>/pkg/` | Modify a `.go` file; observe `plugin/devserver/status` event with `goStatus: "building"` |
| 5 | Vite ready detection works | After `StartDevServer`, observe state transition to `viteStatus: "ready"` |
| 6 | Go file change triggers rebuild and plugin reload | Edit a `.go` file; observe build log events, then `plugin/dev_reload_complete` |
| 7 | Build errors are parsed and emitted | Introduce a syntax error in a `.go` file; observe `plugin/devserver/error` event with file/line info |
| 8 | `StopDevServer` kills Vite and stops the watcher | Call `StopDevServer`; verify no lingering processes; port is freed |
| 9 | `RestartDevServer` works | Call `RestartDevServer`; verify old process dies, new one starts on same port |
| 10 | `GetDevServerState` returns correct state | Call at various points; verify JSON matches expected values |
| 11 | `ListDevServerStates` returns all running instances | Start 2 plugins; call `ListDevServerStates`; verify both appear |
| 12 | `GetDevServerLogs` returns log history | Call after build; verify log entries contain build output |
| 13 | Port allocator reuses ports after release | Start and stop repeatedly; verify port reuse |
| 14 | Shutdown stops all instances | Call `Shutdown()`; verify all Vite processes are dead |
| 15 | No double-rebuild with existing watcher | If Option A is used: modify a `.go` file for a managed plugin; verify only one build runs |
| 16 | `devServerManager.Shutdown()` is called before `pluginManager.Shutdown()` in `main.go` | Code inspection |
| 17 | Log ring buffer does not grow unbounded | Push >5000 entries; verify buffer size stays at 5000 |

---

## Edge Cases and Error Handling

| Scenario | Expected behavior |
|----------|-------------------|
| `StartDevServer` called for plugin not in dev mode | Return error: "plugin is not in dev mode" |
| `StartDevServer` called for plugin with no `DevPath` | Return error: "plugin has no DevPath set" |
| `StartDevServer` called twice for same plugin | Return existing state (idempotent, no error) |
| `StopDevServer` called for plugin with no running server | Return error: "no dev server running" |
| All 100 ports in range exhausted | Return error: "no free port available in range 15173-15273" |
| Port is taken by external process | Skip it during allocation; try next port |
| Vite fails to start (bad pnpm path) | `viteStatus` set to "error"; error in logs; `StartDevServer` returns error |
| Vite takes longer than 30s to become ready | `viteStatus` set to "error"; timeout error in logs |
| Vite process crashes during operation | `done` channel closes; status remains in last state until next action |
| `pnpm` path not configured in settings | Return error: "pnpm path not configured" |
| `go` path not configured in settings | Build fails with error: "go binary path not configured" |
| Go build fails (syntax error) | `goStatus` set to "error"; errors parsed and emitted; old binary remains |
| Go build succeeds but `ReloadPlugin` fails | `goStatus` set to "error"; error logged; build is still available |
| Binary transfer fails (permissions) | `goStatus` set to "error"; error logged |
| Plugin source directory is deleted while watching | fsnotify emits error; logged and continues |
| Context cancelled during build | `exec.CommandContext` handles cancellation; build is aborted |
| Rapid file saves (multiple within 500ms) | Debounce timer resets; only one build runs per burst |
| Shutdown called while build is in progress | Context cancellation aborts the build; Vite receives SIGTERM/SIGKILL |
| `ui/` directory does not exist (backend-only plugin) | `viteProcess.Start()` returns error; caller should handle by skipping Vite and only starting Go watcher |

---

## Future Considerations (out of scope for Phase 2)

- **Log batching optimization**: Currently each log entry is emitted immediately. A 100ms batching timer would reduce event frequency under heavy build output. This can be added as an enhancement.
- **External mode**: `AttachExternal`/`DetachExternal` are stubs. Full implementation is in Phase 6.
- **Auto-start on launch**: When `PluginState.DevMode` is true on app startup, the DevServerManager should automatically call `StartDevServer`. This will be wired up when the plugin manager's `Initialize` is updated in Phase 5.
- **Binary comparison**: Before transferring, compare checksums of old and new binaries to skip transfer/reload if unchanged. This avoids unnecessary gRPC reconnections for no-op builds.
- **UI-only plugins**: Plugins with only UI capabilities (no `pkg/` directory) should start Vite but skip the Go watcher. The `Start()` method in `instance.go` should check for this and conditionally skip `goWatcher.Start()`. For Phase 2, treat a missing `pkg/` as an error from the Go watcher.
- **Windows support**: `syscall.Setpgid` and negative-PID `syscall.Kill` are POSIX. On Windows, use `cmd.Process.Kill()` directly. A build-tagged file (`vite_windows.go`) should provide an alternative `Stop()` implementation.
