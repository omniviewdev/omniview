package pluginlog

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// ---- Manager lifecycle ----

func TestNewManager_CreatesDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "logs")

	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("log dir not created: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("expected directory")
	}
}

func TestNewManager_InvalidPath(t *testing.T) {
	_, err := NewManager("/dev/null/impossible", DefaultRotation())
	if err == nil {
		t.Fatal("expected error for invalid path")
	}
}

func TestLogDir(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	if mgr.LogDir() != dir {
		t.Fatalf("LogDir: got %q, want %q", mgr.LogDir(), dir)
	}
}

func TestClose_FlushesData(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	s := mgr.Stream("closable")
	fmt.Fprintln(s, "before close")

	if err := mgr.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "plugin.closable.log"))
	if err != nil {
		t.Fatalf("read after close: %v", err)
	}
	if !strings.Contains(string(data), "before close") {
		t.Fatalf("content missing: got %q", data)
	}
}

// ---- Stream: file persistence ----

func TestStream_CreatesLogFile(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	s := mgr.Stream("kubernetes")
	fmt.Fprintln(s, "hello from k8s plugin")

	logPath := filepath.Join(dir, "plugin.kubernetes.log")
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("log file not created: %v", err)
	}
	if !strings.Contains(string(data), "hello from k8s plugin") {
		t.Fatalf("log content: got %q", data)
	}
}

func TestStream_ReturnsSameInstance(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	s1 := mgr.Stream("test")
	s2 := mgr.Stream("test")
	if s1 != s2 {
		t.Fatal("expected same stream for same pluginID")
	}
}

func TestStream_IsolatesPlugins(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	fmt.Fprintln(mgr.Stream("alpha"), "alpha line")
	fmt.Fprintln(mgr.Stream("beta"), "beta line")

	dataA, _ := os.ReadFile(filepath.Join(dir, "plugin.alpha.log"))
	dataB, _ := os.ReadFile(filepath.Join(dir, "plugin.beta.log"))

	if !strings.Contains(string(dataA), "alpha line") {
		t.Fatalf("alpha log: got %q", dataA)
	}
	if !strings.Contains(string(dataB), "beta line") {
		t.Fatalf("beta log: got %q", dataB)
	}
	// Verify no cross-contamination.
	if strings.Contains(string(dataA), "beta") {
		t.Fatal("alpha log contains beta data")
	}
}

// ---- Stream: ring buffer ----

func TestGetLogs_ReturnsBufferedEntries(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	s := mgr.Stream("buf-test")
	for i := range 10 {
		fmt.Fprintf(s, "line %d\n", i)
	}

	entries := mgr.GetLogs("buf-test", 0)
	if len(entries) != 10 {
		t.Fatalf("expected 10 entries, got %d", len(entries))
	}
	// Verify chronological order.
	if !strings.Contains(entries[0].Message, "line 0") {
		t.Fatalf("first entry: got %q", entries[0].Message)
	}
	if !strings.Contains(entries[9].Message, "line 9") {
		t.Fatalf("last entry: got %q", entries[9].Message)
	}
}

func TestGetLogs_CountLimitsResults(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	s := mgr.Stream("count-test")
	for i := range 20 {
		fmt.Fprintf(s, "line %d\n", i)
	}

	last5 := mgr.GetLogs("count-test", 5)
	if len(last5) != 5 {
		t.Fatalf("expected 5 entries, got %d", len(last5))
	}
	// Should be the 5 most recent.
	if !strings.Contains(last5[0].Message, "line 15") {
		t.Fatalf("first of last-5: got %q", last5[0].Message)
	}
}

func TestGetLogs_UnknownPlugin_ReturnsNil(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	entries := mgr.GetLogs("nonexistent", 10)
	if entries != nil {
		t.Fatalf("expected nil, got %v", entries)
	}
}

// ---- Stream: emit callback ----

func TestOnEmit_CallbackReceivesEntries(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	var received []LogEntry
	var mu sync.Mutex
	mgr.OnEmit(func(e LogEntry) {
		mu.Lock()
		received = append(received, e)
		mu.Unlock()
	})

	mgr.Subscribe("emit-test")
	s := mgr.Stream("emit-test")
	fmt.Fprintln(s, "emitted line 1")
	fmt.Fprintln(s, "emitted line 2")

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 2 {
		t.Fatalf("expected 2 emitted entries, got %d", len(received))
	}
	if received[0].PluginID != "emit-test" {
		t.Fatalf("PluginID: got %q", received[0].PluginID)
	}
	if !strings.Contains(received[0].Message, "emitted line 1") {
		t.Fatalf("Message: got %q", received[0].Message)
	}
}

func TestOnEmit_NilDisablesEmission(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	var count atomic.Int32
	mgr.OnEmit(func(e LogEntry) {
		count.Add(1)
	})

	mgr.Subscribe("nil-test")
	s := mgr.Stream("nil-test")
	fmt.Fprintln(s, "line 1")

	mgr.OnEmit(nil)
	fmt.Fprintln(s, "line 2")

	if count.Load() != 1 {
		t.Fatalf("expected 1 emission, got %d", count.Load())
	}
}

func TestOnEmit_ReplacesCallback(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	var first, second atomic.Int32
	mgr.OnEmit(func(e LogEntry) { first.Add(1) })

	mgr.Subscribe("replace-test")
	s := mgr.Stream("replace-test")
	fmt.Fprintln(s, "line for first")

	mgr.OnEmit(func(e LogEntry) { second.Add(1) })
	fmt.Fprintln(s, "line for second")

	if first.Load() != 1 {
		t.Fatalf("first callback: got %d calls", first.Load())
	}
	if second.Load() != 1 {
		t.Fatalf("second callback: got %d calls", second.Load())
	}
}

// ---- Stream: hclog line parsing ----

func TestParseLine_HclogFormat(t *testing.T) {
	line := `2024-01-15T10:30:00.000Z [DEBUG] kubernetes: cache synced for pods`
	entry := parseLine("kubernetes", line)

	if entry.Timestamp != "2024-01-15T10:30:00.000Z" {
		t.Fatalf("Timestamp: got %q", entry.Timestamp)
	}
	if entry.Level != "debug" {
		t.Fatalf("Level: got %q", entry.Level)
	}
	if entry.Message != "kubernetes: cache synced for pods" {
		t.Fatalf("Message: got %q", entry.Message)
	}
	if entry.PluginID != "kubernetes" {
		t.Fatalf("PluginID: got %q", entry.PluginID)
	}
	if entry.Source != "plugin" {
		t.Fatalf("Source: got %q", entry.Source)
	}
}

func TestParseLine_PlainText(t *testing.T) {
	line := "some unstructured log line"
	entry := parseLine("test", line)

	if entry.Level != "info" {
		t.Fatalf("Level: got %q, want info", entry.Level)
	}
	if entry.Message != line {
		t.Fatalf("Message: got %q", entry.Message)
	}
	if entry.Timestamp == "" {
		t.Fatal("Timestamp should be set")
	}
}

func TestParseLine_ErrorLevel(t *testing.T) {
	line := `2024-01-15T10:30:00.000Z [ERROR] kubernetes: connection refused`
	entry := parseLine("k8s", line)

	if entry.Level != "error" {
		t.Fatalf("Level: got %q, want error", entry.Level)
	}
}

// ---- ListStreams ----

func TestListStreams_SortedAlphabetically(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	mgr.Stream("charlie")
	mgr.Stream("alpha")
	mgr.Stream("bravo")

	streams := mgr.ListStreams()
	if len(streams) != 3 {
		t.Fatalf("expected 3 streams, got %d", len(streams))
	}
	if streams[0] != "alpha" || streams[1] != "bravo" || streams[2] != "charlie" {
		t.Fatalf("unexpected order: %v", streams)
	}
}

// ---- SearchLogs ----

func TestSearchLogs_MatchesPattern(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	s := mgr.Stream("search-test")
	fmt.Fprintln(s, "error: connection refused")
	fmt.Fprintln(s, "info: cache synced")
	fmt.Fprintln(s, "error: timeout exceeded")

	matches, err := mgr.SearchLogs("search-test", "error:")
	if err != nil {
		t.Fatalf("SearchLogs: %v", err)
	}
	if len(matches) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(matches))
	}
}

func TestSearchLogs_InvalidPattern(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	mgr.Stream("search-test")
	_, err = mgr.SearchLogs("search-test", "[invalid")
	if err == nil {
		t.Fatal("expected error for invalid regex")
	}
}

func TestSearchLogs_UnknownPlugin(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	matches, err := mgr.SearchLogs("nonexistent", ".*")
	if err != nil {
		t.Fatalf("SearchLogs: %v", err)
	}
	if matches != nil {
		t.Fatalf("expected nil, got %v", matches)
	}
}

// ---- Ring buffer ----

func TestRingBuffer_Overflow(t *testing.T) {
	rb := newRingBuffer(3)
	for i := range 5 {
		rb.Push(LogEntry{Message: fmt.Sprintf("msg-%d", i)})
	}

	entries := rb.Entries()
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	// Should have the 3 most recent.
	if entries[0].Message != "msg-2" {
		t.Fatalf("oldest: got %q", entries[0].Message)
	}
	if entries[2].Message != "msg-4" {
		t.Fatalf("newest: got %q", entries[2].Message)
	}
}

func TestRingBuffer_Last(t *testing.T) {
	rb := newRingBuffer(10)
	for i := range 7 {
		rb.Push(LogEntry{Message: fmt.Sprintf("msg-%d", i)})
	}

	last3 := rb.Last(3)
	if len(last3) != 3 {
		t.Fatalf("expected 3, got %d", len(last3))
	}
	if last3[0].Message != "msg-4" {
		t.Fatalf("got %q", last3[0].Message)
	}
	if last3[2].Message != "msg-6" {
		t.Fatalf("got %q", last3[2].Message)
	}
}

func TestRingBuffer_LastMoreThanCount(t *testing.T) {
	rb := newRingBuffer(10)
	rb.Push(LogEntry{Message: "only"})

	last5 := rb.Last(5)
	if len(last5) != 1 {
		t.Fatalf("expected 1, got %d", len(last5))
	}
}

func TestRingBuffer_Clear(t *testing.T) {
	rb := newRingBuffer(5)
	rb.Push(LogEntry{Message: "a"})
	rb.Push(LogEntry{Message: "b"})
	rb.Clear()

	if len(rb.Entries()) != 0 {
		t.Fatal("expected empty after clear")
	}
}

// ---- Concurrency ----

func TestStream_ConcurrentWrites(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	var emitCount atomic.Int32
	mgr.OnEmit(func(e LogEntry) { emitCount.Add(1) })

	mgr.Subscribe("concurrent")
	s := mgr.Stream("concurrent")
	var wg sync.WaitGroup
	for i := range 100 {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			fmt.Fprintf(s, "goroutine %d\n", n)
		}(i)
	}
	wg.Wait()

	entries := mgr.GetLogs("concurrent", 0)
	if len(entries) != 100 {
		t.Fatalf("expected 100 buffered entries, got %d", len(entries))
	}
	if emitCount.Load() != 100 {
		t.Fatalf("expected 100 emissions, got %d", emitCount.Load())
	}
}

// ---- Subscription-gated emission ----

func TestSubscribe_EmitsOnlyWhenSubscribed(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	var count atomic.Int32
	mgr.OnEmit(func(e LogEntry) { count.Add(1) })

	s := mgr.Stream("gated")

	// No subscriber — should NOT emit.
	fmt.Fprintln(s, "line 1 (no subscriber)")
	if count.Load() != 0 {
		t.Fatalf("expected 0 emissions without subscriber, got %d", count.Load())
	}

	// Subscribe — should emit.
	mgr.Subscribe("gated")
	fmt.Fprintln(s, "line 2 (subscribed)")
	if count.Load() != 1 {
		t.Fatalf("expected 1 emission after subscribe, got %d", count.Load())
	}

	// Unsubscribe — should stop emitting.
	mgr.Unsubscribe("gated")
	fmt.Fprintln(s, "line 3 (unsubscribed)")
	if count.Load() != 1 {
		t.Fatalf("expected still 1 emission after unsubscribe, got %d", count.Load())
	}

	// All lines should still be buffered regardless of subscription.
	entries := mgr.GetLogs("gated", 0)
	if len(entries) != 3 {
		t.Fatalf("expected 3 buffered entries, got %d", len(entries))
	}
}

func TestSubscribe_RefCounting(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	var count atomic.Int32
	mgr.OnEmit(func(e LogEntry) { count.Add(1) })

	s := mgr.Stream("refcount")

	// Two subscribers.
	n1 := mgr.Subscribe("refcount")
	n2 := mgr.Subscribe("refcount")
	if n1 != 1 || n2 != 2 {
		t.Fatalf("subscribe counts: got %d, %d; want 1, 2", n1, n2)
	}

	fmt.Fprintln(s, "line with 2 subs")
	if count.Load() != 1 {
		t.Fatalf("expected 1 emission, got %d", count.Load())
	}

	// Remove one subscriber — should still emit (count=1).
	remaining := mgr.Unsubscribe("refcount")
	if remaining != 1 {
		t.Fatalf("expected 1 remaining, got %d", remaining)
	}
	fmt.Fprintln(s, "line with 1 sub")
	if count.Load() != 2 {
		t.Fatalf("expected 2 emissions, got %d", count.Load())
	}

	// Remove last subscriber — should stop emitting.
	remaining = mgr.Unsubscribe("refcount")
	if remaining != 0 {
		t.Fatalf("expected 0 remaining, got %d", remaining)
	}
	fmt.Fprintln(s, "line with 0 subs")
	if count.Load() != 2 {
		t.Fatalf("expected still 2 emissions, got %d", count.Load())
	}
}

func TestUnsubscribe_NeverSubscribed(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	// Unsubscribe for a plugin that was never subscribed — should not panic.
	remaining := mgr.Unsubscribe("phantom")
	if remaining != 0 {
		t.Fatalf("expected 0, got %d", remaining)
	}
}

func TestSubscribe_IsolatesPlugins(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir, DefaultRotation())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	var alphaEmits, betaEmits atomic.Int32
	mgr.OnEmit(func(e LogEntry) {
		switch e.PluginID {
		case "alpha":
			alphaEmits.Add(1)
		case "beta":
			betaEmits.Add(1)
		}
	})

	sA := mgr.Stream("alpha")
	sB := mgr.Stream("beta")

	// Only subscribe to alpha.
	mgr.Subscribe("alpha")

	fmt.Fprintln(sA, "alpha line")
	fmt.Fprintln(sB, "beta line")

	if alphaEmits.Load() != 1 {
		t.Fatalf("expected 1 alpha emission, got %d", alphaEmits.Load())
	}
	if betaEmits.Load() != 0 {
		t.Fatalf("expected 0 beta emissions, got %d", betaEmits.Load())
	}
}

// ---- DefaultRotation ----

func TestDefaultRotation(t *testing.T) {
	opts := DefaultRotation()
	if opts.MaxSizeMB <= 0 || opts.MaxBackups <= 0 || opts.MaxAgeDays <= 0 {
		t.Fatal("default rotation options should have positive values")
	}
}
