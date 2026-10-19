package devserver

import (
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func init() {
	application.RegisterEvent[DevServerState](EventDevServerStatus)
	application.RegisterEvent[[]LogEntry](EventDevServerLog)
	application.RegisterEvent[DevServerErrorPayload](EventDevServerError)
}

// ============================================================================
// Event constants
// ============================================================================

const (
	// EventDevServerStatus is emitted whenever any field in DevServerState changes.
	// Payload: DevServerState.
	EventDevServerStatus = "plugin/devserver/status"

	// EventDevServerLog is emitted for batched log lines from Vite or Go build.
	// Payload: []LogEntry (each entry contains pluginID).
	EventDevServerLog = "plugin/devserver/log"

	// EventDevServerError is emitted for structured build errors.
	// Payload: (pluginID string, errors []BuildError).
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
)

// DevProcessStatus describes the current status of either the Vite process or the Go watcher.
type DevProcessStatus string

const (
	DevProcessStatusIdle          DevProcessStatus = "idle"
	DevProcessStatusStarting      DevProcessStatus = "starting"
	DevProcessStatusBuilding      DevProcessStatus = "building"
	DevProcessStatusRunning       DevProcessStatus = "running"
	DevProcessStatusReady         DevProcessStatus = "ready"
	DevProcessStatusError         DevProcessStatus = "error"
	DevProcessStatusStopped       DevProcessStatus = "stopped"
	DevProcessStatusNotApplicable DevProcessStatus = "n/a"
)

// ============================================================================
// State types (JSON-serializable for frontend)
// ============================================================================

// DevServerState is the JSON-serializable state of a single plugin's dev server.
// This is sent to the frontend via Wails events and returned from query methods.
type DevServerState struct {
	PluginID          string           `json:"pluginID"`
	Mode              DevServerMode    `json:"mode"`
	DevPath           string           `json:"devPath"`
	VitePort          int              `json:"vitePort"`
	ViteURL           string           `json:"viteURL"`
	ViteStatus        DevProcessStatus `json:"viteStatus"`
	GoStatus          DevProcessStatus `json:"goStatus"`
	LastBuildDuration time.Duration    `json:"lastBuildDuration"`
	LastBuildTime     string           `json:"lastBuildTime"`
	LastError         string           `json:"lastError"`
	GRPCConnected     bool             `json:"grpcConnected"`
	Generation        string           `json:"generation"`
	HMRURL            string           `json:"hmrURL"`
	BuildStatus       LifecycleStage   `json:"buildStatus"`
	RPCStatus         LifecycleStage   `json:"rpcStatus"`
	ControllerStatus  LifecycleStage   `json:"controllerStatus"`
	Ready             bool             `json:"ready"`
}

// LifecycleStage distinguishes successful compilation from a live plugin.
type LifecycleStage string

const (
	StagePending       LifecycleStage = "pending"
	StageBuilding      LifecycleStage = "building"
	StageReady         LifecycleStage = "ready"
	StageError         LifecycleStage = "error"
	StageStopped       LifecycleStage = "stopped"
	StageNotApplicable LifecycleStage = "n/a"
)

// LogEntry is a single log line from either the Vite process or the Go build.
type LogEntry struct {
	Timestamp string `json:"timestamp"`
	Source    string `json:"source"` // "vite" | "go-build" | "go-watch" | "manager"
	Level     string `json:"level"`  // "info" | "warn" | "error" | "debug"
	Message   string `json:"message"`
	PluginID  string `json:"pluginID"`
}

// LogEntry sources and levels.
const (
	logSourceVite    = "vite"
	logSourceGoBuild = "go-build"
	logSourceGoWatch = "go-watch"
	logLevelInfo     = "info"
	logLevelError    = "error"
)

// newLogEntry builds a LogEntry. Timestamp and PluginID are left empty; the
// instance fills them in when the entry is appended.
func newLogEntry(source, level, message string) LogEntry {
	return LogEntry{
		Timestamp: "",
		Source:    source,
		Level:     level,
		Message:   message,
		PluginID:  "",
	}
}

// DevServerErrorPayload wraps a plugin ID and its build errors into a single
// event payload so it can be registered with RegisterEvent[T].
type DevServerErrorPayload struct {
	PluginID string       `json:"pluginID"`
	Errors   []BuildError `json:"errors"`
}

// BuildError is a structured build error parsed from Go compiler output.
type BuildError struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Message string `json:"message"`
}

// BuildOpts holds resolved paths to build tools.
type BuildOpts struct {
	GoPath                    string
	PnpmPath                  string
	PnpmArgs                  []string
	NodePath                  string
	Environment               []string
	StateRoot                 string
	ExpectedSDKRevision       string
	ViteStarted               func(devcontract.ProcessIdentity) error
	ViteOwner                 devsession.ProcessOwner
	ProcessSupervisor         *devsession.ProcessBridgeClient
	ExplicitPnpmPath          string
	ExplicitNodePath          string
	Generation                string
	DisableDependencyWatching bool
	Workspace                 *devcontract.ResolvedWorkspace
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
		head:    0,
		count:   0,
		cap:     capacity,
	}
}

// Push adds an entry to the ring buffer, overwriting the oldest if full.
func (rb *LogRingBuffer) Push(entry LogEntry) {
	idx := (rb.head + rb.count) % rb.cap
	rb.entries[idx] = entry
	if rb.count == rb.cap {
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
