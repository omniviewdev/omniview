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
	PluginID          string           `json:"pluginID"`
	Mode              DevServerMode    `json:"mode"`
	DevPath           string           `json:"devPath"`
	VitePort          int              `json:"vitePort"`
	ViteURL           string           `json:"viteURL"`
	ViteStatus        DevProcessStatus `json:"viteStatus"`
	GoStatus          DevProcessStatus `json:"goStatus"`
	LastBuildDuration time.Duration    `json:"lastBuildDuration"`
	LastBuildTime     time.Time        `json:"lastBuildTime"`
	LastError         string           `json:"lastError"`
	GRPCConnected     bool             `json:"grpcConnected"`
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
type DevInfoFile struct {
	PID             int    `json:"pid"`
	Protocol        string `json:"protocol"`
	ProtocolVersion int    `json:"protocolVersion"`
	Addr            string `json:"addr"`
	VitePort        int    `json:"vitePort,omitempty"`
	PluginID        string `json:"pluginId,omitempty"`
	Version         string `json:"version,omitempty"`
	StartedAt       string `json:"startedAt,omitempty"`
}

// BuildOpts holds resolved paths to build tools.
type BuildOpts struct {
	GoPath   string
	PnpmPath string
	NodePath string
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
