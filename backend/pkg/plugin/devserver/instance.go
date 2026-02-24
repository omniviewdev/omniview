package devserver

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"
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
	reloader  PluginReloader

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
	reloader PluginReloader,
	onStatus emitStatusFunc,
	onLogs emitLogsFunc,
	onErrors emitErrorsFunc,
) *DevServerInstance {
	ctx, cancel := context.WithCancel(parentCtx)

	return &DevServerInstance{
		ctx:        ctx,
		cancel:     cancel,
		logger:     logger.Named("instance").With("pluginID", pluginID),
		pluginID:   pluginID,
		devPath:    devPath,
		vitePort:   vitePort,
		buildOpts:  buildOpts,
		reloader:   reloader,
		onStatus:   onStatus,
		onLogs:     onLogs,
		onErrors:   onErrors,
		mode:       DevServerModeManaged,
		viteStatus: DevProcessStatusIdle,
		goStatus:   DevProcessStatusIdle,
		logBuffer:  NewLogRingBuffer(DefaultLogBufferSize),
	}
}

// Start spawns the Vite dev server and Go watcher in background goroutines.
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
		inst.reloader,
		inst.appendLog,
		inst.setGoStatus,
		inst.setBuildResult,
		inst.onErrors,
	)
	if err := inst.goWatcher.Start(); err != nil {
		inst.vite.Stop()
		inst.setGoStatus(DevProcessStatusError)
		inst.setLastError(err.Error())
		return err
	}

	return nil
}

// Stop gracefully stops both the Vite process and Go watcher.
// Sub-processes are stopped BEFORE the context is cancelled so that their
// Stop methods can still look up and signal the process group.
func (inst *DevServerInstance) Stop() {
	inst.logger.Info("stopping dev server instance")

	// Stop sub-processes FIRST while the context is still alive,
	// so they can do graceful SIGTERM → SIGKILL on the process group.
	if inst.vite != nil {
		inst.vite.Stop()
	}
	if inst.goWatcher != nil {
		inst.goWatcher.Stop()
	}

	// NOW cancel the context (no-op for already-stopped processes).
	inst.cancel()

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
func (inst *DevServerInstance) GetLogs(count int) []LogEntry {
	inst.mu.RLock()
	defer inst.mu.RUnlock()

	if count <= 0 {
		return inst.logBuffer.Entries()
	}
	return inst.logBuffer.Last(count)
}

// VitePGID returns the process group ID of the Vite child process, or 0.
func (inst *DevServerInstance) VitePGID() int {
	if inst.vite == nil {
		return 0
	}
	return inst.vite.PGID()
}

// ============================================================================
// Internal state mutation helpers
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

func (inst *DevServerInstance) appendLog(entry LogEntry) {
	entry.PluginID = inst.pluginID
	if entry.Timestamp.IsZero() {
		entry.Timestamp = time.Now()
	}

	inst.mu.Lock()
	inst.logBuffer.Push(entry)
	inst.mu.Unlock()

	inst.onLogs(inst.pluginID, []LogEntry{entry})
}
