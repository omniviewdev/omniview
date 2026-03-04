// Package pluginlog manages per-plugin log capture with file persistence,
// in-memory ring buffering, and callback-based real-time streaming.
//
// Each plugin process's stderr is captured by hashicorp/go-plugin and
// forwarded via hclog. This package provides an [io.Writer] per plugin
// that simultaneously:
//   - Persists log lines to a rotated file (e.g., plugin.kubernetes.log)
//   - Buffers recent entries in a ring buffer for fast historical access
//   - Invokes an optional callback for real-time UI streaming
//
// The Manager exposes Wails-bindable methods ([GetLogs], [ListStreams])
// so the Omniview UI can display plugin logs in a log viewer panel.
//
// Example:
//
//	mgr, _ := pluginlog.NewManager("/path/to/logs", pluginlog.DefaultRotation())
//	defer mgr.Close()
//
//	w := mgr.Stream("kubernetes")   // io.Writer for hclog
//	mgr.OnEmit(func(e LogEntry) { ... })  // real-time callback
//
//	// Later, from Wails binding:
//	entries := mgr.GetLogs("kubernetes", 100)
package pluginlog

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/natefinch/lumberjack.v2"
)

// RotationOptions configures log file rotation parameters.
type RotationOptions struct {
	MaxSizeMB  int  // maximum size in MB before rotation
	MaxBackups int  // number of old log files to keep
	MaxAgeDays int  // max days to retain old log files
	Compress   bool // compress rotated files with gzip
}

// DefaultRotation returns rotation settings suitable for plugin logs.
func DefaultRotation() RotationOptions {
	return RotationOptions{
		MaxSizeMB:  256,
		MaxBackups: 5,
		MaxAgeDays: 30,
		Compress:   true,
	}
}

// DefaultBufferSize is the default ring buffer capacity per plugin.
const DefaultBufferSize = 5000

// LogEntry represents a single log line from a plugin process.
// Field names and JSON tags intentionally match devserver.LogEntry
// for frontend consistency.
type LogEntry struct {
	Timestamp string `json:"timestamp"`
	PluginID  string `json:"pluginID"`
	Source    string `json:"source"` // "plugin" (from hclog) — extensible
	Level     string `json:"level"`  // "trace" | "debug" | "info" | "warn" | "error"
	Message   string `json:"message"`
}

// EmitFunc is called for each log entry. Implementations must be safe for
// concurrent calls from multiple plugin streams.
type EmitFunc func(entry LogEntry)

// Manager manages per-plugin log streams with persistence, buffering,
// and optional real-time emission. It is safe for concurrent use.
//
// Emission is subscription-gated: the emit callback only fires for plugins
// that have been explicitly subscribed via [Subscribe]. This prevents
// unnecessary serialization and transport overhead on the Wails event bus
// when no UI consumer is listening.
//
// Wails-bindable methods: GetLogs, ListStreams, SearchLogs, Subscribe, Unsubscribe.
type Manager struct {
	dir        string
	opts       RotationOptions
	bufferSize int

	mu      sync.Mutex
	streams map[string]*PluginLogStream

	emitMu sync.RWMutex
	emit   EmitFunc

	subMu         sync.RWMutex
	subscriptions map[string]int // pluginID → subscriber ref count
}

// NewManager creates a Manager that stores plugin log files in dir.
// The directory is created if it does not exist.
func NewManager(dir string, opts RotationOptions) (*Manager, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("pluginlog: create log directory: %w", err)
	}
	return &Manager{
		dir:           dir,
		opts:          opts,
		bufferSize:    DefaultBufferSize,
		streams:       make(map[string]*PluginLogStream),
		subscriptions: make(map[string]int),
	}, nil
}

// OnEmit registers a callback invoked for every log entry across all
// plugin streams. Only one callback is active at a time; subsequent calls
// replace the previous one. Pass nil to disable emission.
//
// This is the integration point for Wails event emission — the caller
// wraps runtime.EventsEmit in the callback to keep this package free
// of Wails dependencies.
func (m *Manager) OnEmit(fn EmitFunc) {
	m.emitMu.Lock()
	m.emit = fn
	m.emitMu.Unlock()
}

// Subscribe registers interest in real-time log emission for a plugin.
// The emit callback will only fire for plugins with at least one subscriber.
// Multiple calls increment a reference count — each must be paired with
// [Unsubscribe]. Returns the current subscriber count for the plugin.
//
// This method is designed to be Wails-bound so the frontend can opt in
// to real-time log streaming when the user opens a log viewer.
func (m *Manager) Subscribe(pluginID string) int {
	m.subMu.Lock()
	defer m.subMu.Unlock()
	m.subscriptions[pluginID]++
	return m.subscriptions[pluginID]
}

// Unsubscribe decrements the subscriber count for a plugin. When the count
// reaches zero, real-time emission stops for that plugin. Returns the
// remaining subscriber count (0 means no more emission).
//
// This method is designed to be Wails-bound so the frontend can opt out
// when the user closes the log viewer.
func (m *Manager) Unsubscribe(pluginID string) int {
	m.subMu.Lock()
	defer m.subMu.Unlock()
	if m.subscriptions[pluginID] > 0 {
		m.subscriptions[pluginID]--
	}
	count := m.subscriptions[pluginID]
	if count == 0 {
		delete(m.subscriptions, pluginID)
	}
	return count
}

// isSubscribed reports whether the given plugin has any active subscribers.
func (m *Manager) isSubscribed(pluginID string) bool {
	m.subMu.RLock()
	defer m.subMu.RUnlock()
	return m.subscriptions[pluginID] > 0
}

// Stream returns the PluginLogStream for the named plugin, creating it
// on first call. The returned stream implements io.Writer for use as an
// hclog Output target.
func (m *Manager) Stream(pluginID string) *PluginLogStream {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.streams[pluginID]; ok {
		return s
	}

	lj := &lumberjack.Logger{
		Filename:   filepath.Join(m.dir, fmt.Sprintf("plugin.%s.log", pluginID)),
		MaxSize:    m.opts.MaxSizeMB,
		MaxBackups: m.opts.MaxBackups,
		MaxAge:     m.opts.MaxAgeDays,
		Compress:   m.opts.Compress,
	}

	s := &PluginLogStream{
		pluginID: pluginID,
		file:     lj,
		buffer:   newRingBuffer(m.bufferSize),
		mgr:      m,
	}
	m.streams[pluginID] = s
	return s
}

// GetLogs returns recent log entries for a plugin. If count <= 0, all
// buffered entries are returned. Entries are in chronological order
// (oldest first).
//
// This method is designed to be Wails-bound for UI hydration.
func (m *Manager) GetLogs(pluginID string, count int) []LogEntry {
	m.mu.Lock()
	s, ok := m.streams[pluginID]
	m.mu.Unlock()
	if !ok {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if count <= 0 {
		return s.buffer.Entries()
	}
	return s.buffer.Last(count)
}

// ListStreams returns the plugin IDs of all active log streams, sorted
// alphabetically.
//
// This method is designed to be Wails-bound for UI discovery.
func (m *Manager) ListStreams() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	ids := make([]string, 0, len(m.streams))
	for id := range m.streams {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// SearchLogs returns buffered log entries for a plugin whose message
// matches the given regex pattern. Returns an error if the pattern is
// invalid.
//
// This method is designed to be Wails-bound for UI search.
func (m *Manager) SearchLogs(pluginID, pattern string) ([]LogEntry, error) {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("pluginlog: invalid pattern: %w", err)
	}

	m.mu.Lock()
	s, ok := m.streams[pluginID]
	m.mu.Unlock()
	if !ok {
		return nil, nil
	}

	s.mu.Lock()
	all := s.buffer.Entries()
	s.mu.Unlock()

	var matches []LogEntry
	for _, e := range all {
		if re.MatchString(e.Message) {
			matches = append(matches, e)
		}
	}
	return matches, nil
}

// LogDir returns the directory where plugin log files are stored.
func (m *Manager) LogDir() string {
	return m.dir
}

// Close closes all managed log streams, flushing any buffered data.
// After Close, the Manager should not be used.
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var firstErr error
	for id, s := range m.streams {
		if err := s.file.Close(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("pluginlog: close stream for %q: %w", id, err)
		}
	}
	m.streams = nil
	return firstErr
}

// PluginLogStream captures log output for a single plugin process.
// It implements [io.Writer] so it can be used as the hclog Output target.
//
// Each write is simultaneously persisted to a rotated log file, parsed
// into a [LogEntry], buffered in a ring buffer, and optionally emitted
// via the Manager's callback.
type PluginLogStream struct {
	pluginID string
	file     *lumberjack.Logger
	buffer   *ringBuffer
	mgr      *Manager

	mu sync.Mutex
}

// Write implements [io.Writer]. It receives hclog-formatted output,
// persists it to file, and processes each line into the ring buffer.
//
// hclog output may contain multiple lines per Write call, so we split
// on newlines and process each independently.
func (s *PluginLogStream) Write(p []byte) (int, error) {
	// Always persist the raw bytes to file.
	n, err := s.file.Write(p)

	// Parse each line into a LogEntry for buffering and emission.
	scanner := bufio.NewScanner(strings.NewReader(string(p)))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		entry := parseLine(s.pluginID, line)

		s.mu.Lock()
		s.buffer.Push(entry)
		s.mu.Unlock()

		// Only emit to the frontend if this plugin has active subscribers.
		if s.mgr.isSubscribed(s.pluginID) {
			s.mgr.emitMu.RLock()
			fn := s.mgr.emit
			s.mgr.emitMu.RUnlock()
			if fn != nil {
				fn(entry)
			}
		}
	}

	return n, err
}

// hclog output format (default): "2024-01-15T10:30:00.000Z [DEBUG] plugin-name: message here"
// hclog output format (json):    {"@level":"debug","@message":"...","@timestamp":"..."}
// We handle the text format since that's what go-plugin uses by default.
var hclogLineRe = regexp.MustCompile(
	`^(\d{4}-\d{2}-\d{2}T[\d:.Z+-]+)\s+\[(\w+)]\s+(.*)$`,
)

// parseLine extracts structured fields from an hclog-formatted line.
// Falls back to treating the entire line as the message if parsing fails.
func parseLine(pluginID, line string) LogEntry {
	entry := LogEntry{
		Timestamp: time.Now().Format(time.RFC3339),
		PluginID:  pluginID,
		Source:    "plugin",
		Level:     "info",
		Message:   line,
	}

	if m := hclogLineRe.FindStringSubmatch(line); m != nil {
		entry.Timestamp = m[1]
		entry.Level = strings.ToLower(m[2])
		entry.Message = m[3]
	}

	return entry
}

// ringBuffer is a fixed-size circular buffer for LogEntry values.
type ringBuffer struct {
	entries []LogEntry
	head    int
	count   int
	cap     int
}

func newRingBuffer(capacity int) *ringBuffer {
	return &ringBuffer{
		entries: make([]LogEntry, capacity),
		cap:     capacity,
	}
}

// Push adds an entry, overwriting the oldest if full.
func (rb *ringBuffer) Push(entry LogEntry) {
	idx := (rb.head + rb.count) % rb.cap
	rb.entries[idx] = entry
	if rb.count == rb.cap {
		rb.head = (rb.head + 1) % rb.cap
	} else {
		rb.count++
	}
}

// Entries returns all entries in chronological order (oldest first).
func (rb *ringBuffer) Entries() []LogEntry {
	result := make([]LogEntry, rb.count)
	for i := range rb.count {
		result[i] = rb.entries[(rb.head+i)%rb.cap]
	}
	return result
}

// Last returns the most recent n entries in chronological order.
func (rb *ringBuffer) Last(n int) []LogEntry {
	if n > rb.count {
		n = rb.count
	}
	result := make([]LogEntry, n)
	start := rb.count - n
	for i := range n {
		result[i] = rb.entries[(rb.head+start+i)%rb.cap]
	}
	return result
}

// Clear resets the buffer.
func (rb *ringBuffer) Clear() {
	rb.head = 0
	rb.count = 0
}

// Compile-time interface check.
var _ io.Writer = (*PluginLogStream)(nil)
