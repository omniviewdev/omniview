package devserver

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
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
	ctx               context.Context
	cancel            context.CancelFunc
	logger            logging.Logger
	pluginID          string
	devPath           string // absolute path to the plugin source directory
	vitePort          int
	buildOpts         BuildOpts
	reloader          PluginReloader
	pluginsRoot       *appstate.ScopedRoot
	generation        string
	runtimeGeneration string
	hasUI             bool
	hasBackend        bool

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
	buildStatus       LifecycleStage
	rpcStatus         LifecycleStage
	controllerStatus  LifecycleStage

	// Sub-components
	logBuffer *LogRingBuffer
	vite      *viteProcess
	goWatcher *goWatcherProcess
}

// NewDevServerInstance creates a new instance. Call Start() to begin.
func NewDevServerInstance(
	parentCtx context.Context,
	logger logging.Logger,
	pluginID string,
	devPath string,
	vitePort int,
	buildOpts BuildOpts,
	reloader PluginReloader,
	pluginsRoot *appstate.ScopedRoot,
	onStatus emitStatusFunc,
	onLogs emitLogsFunc,
	onErrors emitErrorsFunc,
) *DevServerInstance {
	ctx, cancel := context.WithCancel(parentCtx)

	return &DevServerInstance{
		ctx:               ctx,
		cancel:            cancel,
		logger:            logger.Named("instance").With(logging.Any("pluginID", pluginID)),
		pluginID:          pluginID,
		devPath:           devPath,
		vitePort:          vitePort,
		buildOpts:         buildOpts,
		reloader:          reloader,
		pluginsRoot:       pluginsRoot,
		generation:        uuid.NewString(),
		runtimeGeneration: uuid.NewString(),
		onStatus:          onStatus,
		onLogs:            onLogs,
		onErrors:          onErrors,
		mu:                sync.RWMutex{},
		mode:              DevServerModeManaged,
		viteStatus:        DevProcessStatusIdle,
		goStatus:          DevProcessStatusIdle,
		lastBuildDuration: 0,
		lastBuildTime:     time.Time{},
		lastError:         "",
		grpcConnected:     false,
		logBuffer:         NewLogRingBuffer(DefaultLogBufferSize),
		vite:              nil, // created by Start
		goWatcher:         nil, // created by Start
	}
}

// Start spawns the Vite dev server and Go watcher in background goroutines.
func (inst *DevServerInstance) Start() error {
	inst.logger.Infow(context.Background(), "starting dev server instance")

	metadata, err := sdktypes.LoadPluginMetadata(inst.devPath)
	if err != nil {
		return fmt.Errorf("load source capabilities: %w", err)
	}
	if metadata.ID != inst.pluginID {
		return fmt.Errorf("source plugin ID %q does not match %q", metadata.ID, inst.pluginID)
	}
	hasUI, hasBackend := metadata.HasUICapabilities(), metadata.HasBackendCapabilities()
	if !hasUI && !hasBackend {
		return fmt.Errorf("plugin has no supported development capabilities")
	}
	// The manager publishes this instance before Start; State can already run.
	inst.mu.Lock()
	inst.hasUI, inst.hasBackend = hasUI, hasBackend
	inst.mu.Unlock()
	inst.initializeStages()
	if hasUI {
		inst.vite = newViteProcess(inst.ctx, inst.logger, inst.pluginID, inst.devPath, inst.vitePort, inst.buildOpts, inst.appendLog, inst.setViteStatus)
		if err := inst.vite.Start(); err != nil {
			inst.setViteStatus(DevProcessStatusError)
			inst.setLastError(err.Error())
			return err
		}
	}
	if !hasBackend {
		return nil
	}

	// Start Go watcher.
	inst.goWatcher = newGoWatcherProcess(
		inst.ctx,
		inst.logger,
		inst.pluginID,
		inst.devPath,
		inst.buildOpts,
		inst.reloader,
		inst.pluginsRoot,
		inst.appendLog,
		inst.setGoStatus,
		inst.setBuildResult,
		inst.onErrors,
	)
	inst.goWatcher.runtimeError = func(err error) { inst.notifyLifecycle(false, false, err) }
	if err := inst.goWatcher.Start(); err != nil {
		if inst.vite != nil {
			inst.vite.Stop()
		}
		inst.setGoStatus(DevProcessStatusError)
		inst.setLastError(err.Error())
		return err
	}

	return nil
}

// Stop gracefully stops both the Vite process and Go watcher.
// Sub-processes are stopped BEFORE the context is cancelled so that their
// Stop methods can still look up and signal the process group.
func (inst *DevServerInstance) Stop() error {
	inst.logger.Infow(context.Background(), "stopping dev server instance")
	var viteErr, goErr error

	// Stop sub-processes FIRST while the context is still alive,
	// so they can do graceful SIGTERM → SIGKILL on the process group.
	if inst.vite != nil {
		viteErr = inst.vite.Stop()
	}
	if inst.goWatcher != nil {
		goErr = inst.goWatcher.Stop()
	}

	// NOW cancel the context (no-op for already-stopped processes).
	inst.cancel()

	stopErr := errors.Join(viteErr, goErr)
	if stopErr != nil {
		inst.setLastError(stopErr.Error())
	}
	if viteErr != nil {
		inst.setViteStatus(DevProcessStatusError)
	} else {
		inst.setViteStatus(DevProcessStatusStopped)
	}
	if goErr != nil {
		inst.setGoStatus(DevProcessStatusError)
	} else {
		inst.setGoStatus(DevProcessStatusStopped)
	}

	if stopErr == nil {
		inst.logger.Infow(context.Background(), "dev server instance stopped")
	}
	return stopErr
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
		LastBuildTime:     inst.lastBuildTime.Format(time.RFC3339),
		Generation:        inst.generation,
		HMRURL:            strings.Replace(viteURL, "http://", "ws://", 1),
		BuildStatus:       inst.buildStatus,
		RPCStatus:         inst.rpcStatus,
		ControllerStatus:  inst.controllerStatus,
		Ready:             (inst.hasUI || inst.hasBackend) && (!inst.hasUI || inst.viteStatus == DevProcessStatusReady) && (!inst.hasBackend || (inst.buildStatus == StageReady && inst.rpcStatus == StageReady && inst.controllerStatus == StageReady)) && inst.mode == DevServerModeManaged,
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

// TriggerRebuild triggers an explicit Go rebuild + transfer + reload cycle.
func (inst *DevServerInstance) TriggerRebuild() error {
	if inst.goWatcher == nil {
		return nil
	}
	return inst.goWatcher.handleRebuild("manual-trigger")
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
	switch status {
	case DevProcessStatusBuilding:
		inst.buildStatus = StageBuilding
		if inst.hasBackend {
			inst.runtimeGeneration = uuid.NewString()
			inst.grpcConnected = false
			inst.rpcStatus, inst.controllerStatus = StagePending, StagePending
		}
	case DevProcessStatusError:
		inst.buildStatus = StageError
	case DevProcessStatusReady:
		inst.buildStatus = StageReady
	case DevProcessStatusStopped:
		inst.buildStatus, inst.rpcStatus, inst.controllerStatus = StageStopped, StageStopped, StageStopped
		inst.grpcConnected = false
	}
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
	}
	inst.mu.Unlock()

	inst.onStatus(inst.pluginID, inst.State())
}

func (inst *DevServerInstance) appendLog(entry LogEntry) {
	entry.PluginID = inst.pluginID
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().Format(time.RFC3339)
	}

	inst.mu.Lock()
	inst.logBuffer.Push(entry)
	inst.mu.Unlock()

	inst.onLogs(inst.pluginID, []LogEntry{entry})
}

func (inst *DevServerInstance) initializeStages() {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	inst.buildStatus, inst.rpcStatus, inst.controllerStatus = StagePending, StagePending, StagePending
	if !inst.hasBackend {
		inst.goStatus = DevProcessStatusNotApplicable
		inst.buildStatus, inst.rpcStatus, inst.controllerStatus = StageNotApplicable, StageNotApplicable, StageNotApplicable
	}
	if !inst.hasUI {
		inst.viteStatus = DevProcessStatusNotApplicable
	}
}

// notifyLifecycle is called only from the actual host load/health/shutdown path.
// Neither compilation nor an advertised PID is a connection observation.
func (inst *DevServerInstance) notifyLifecycle(rpc, controllers bool, err error) {
	inst.notifyLifecycleGeneration("", rpc, controllers, err)
}

func (inst *DevServerInstance) notifyLifecycleGeneration(generation string, rpc, controllers bool, err error) bool {
	inst.mu.Lock()
	if generation != "" && generation != inst.runtimeGeneration {
		inst.mu.Unlock()
		return false
	}
	if inst.hasBackend {
		if err == nil && rpc && controllers && inst.buildStatus == StageReady && inst.viteStatus != DevProcessStatusError && (inst.rpcStatus == StageError || inst.controllerStatus == StageError) {
			inst.lastError = ""
		}
		inst.grpcConnected = rpc && err == nil
		inst.rpcStatus, inst.controllerStatus = StagePending, StagePending
		if rpc {
			inst.rpcStatus = StageReady
		}
		if controllers {
			inst.controllerStatus = StageReady
		}
		if err != nil {
			inst.lastError = err.Error()
			inst.rpcStatus, inst.controllerStatus = StageError, StageError
		}
	}
	inst.mu.Unlock()
	inst.onStatus(inst.pluginID, inst.State())
	return true
}
