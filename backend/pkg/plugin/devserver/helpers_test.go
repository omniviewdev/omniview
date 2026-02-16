package devserver

import (
	"context"
	"sync"
	"testing"

	"go.uber.org/zap"
)

// ============================================================================
// Mock: PluginReloader
// ============================================================================

type mockPluginReloader struct {
	mu           sync.Mutex
	callCount    int
	lastPluginID string
	err          error // configurable error to return
}

func (m *mockPluginReloader) ReloadPlugin(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.callCount++
	m.lastPluginID = id
	return m.err
}

func (m *mockPluginReloader) getCallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.callCount
}

func (m *mockPluginReloader) getLastPluginID() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastPluginID
}

// ============================================================================
// Mock: PluginRef
// ============================================================================

type mockPluginRef struct {
	devMode bool
	devPath string
	err     error
}

func (m *mockPluginRef) GetDevPluginInfo(_ string) (bool, string, error) {
	return m.devMode, m.devPath, m.err
}

// ============================================================================
// Callback recorders (thread-safe)
// ============================================================================

type statusRecorder struct {
	mu    sync.Mutex
	calls []statusCall
}

type statusCall struct {
	pluginID string
	state    DevServerState
}

func (r *statusRecorder) record(pluginID string, state DevServerState) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, statusCall{pluginID: pluginID, state: state})
}

func (r *statusRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

func (r *statusRecorder) last() statusCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls[len(r.calls)-1]
}

func (r *statusRecorder) all() []statusCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := make([]statusCall, len(r.calls))
	copy(cp, r.calls)
	return cp
}

type logRecorder struct {
	mu    sync.Mutex
	calls []logCall
}

type logCall struct {
	pluginID string
	entries  []LogEntry
}

func (r *logRecorder) record(pluginID string, entries []LogEntry) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, logCall{pluginID: pluginID, entries: entries})
}

func (r *logRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

func (r *logRecorder) last() logCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls[len(r.calls)-1]
}

type errorRecorder struct {
	mu    sync.Mutex
	calls []errorCall
}

type errorCall struct {
	pluginID string
	errors   []BuildError
}

func (r *errorRecorder) record(pluginID string, errors []BuildError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, errorCall{pluginID: pluginID, errors: errors})
}

func (r *errorRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

func (r *errorRecorder) last() errorCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls[len(r.calls)-1]
}

// ============================================================================
// Test instance factory
// ============================================================================

// newTestInstance creates a DevServerInstance wired to callback recorders.
// Returns (instance, statusRecorder, logRecorder, errorRecorder).
func newTestInstance(t *testing.T, pluginID string) (*DevServerInstance, *statusRecorder, *logRecorder, *errorRecorder) {
	t.Helper()

	sr := &statusRecorder{}
	lr := &logRecorder{}
	er := &errorRecorder{}

	inst := NewDevServerInstance(
		context.Background(),
		zap.NewNop().Sugar(),
		pluginID,
		t.TempDir(),
		15173,
		BuildOpts{},
		nil,
		sr.record,
		lr.record,
		er.record,
	)

	return inst, sr, lr, er
}
