package diagnostics

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nxadm/tail"
	"github.com/stretchr/testify/require"
)

// maxSinkLines bounds what the sink keeps, so a regression that replays a huge
// log fails with a readable message instead of a gigantic one.
const maxSinkLines = 32

// lineSink records what StartTail emits.
type lineSink struct {
	mu     sync.Mutex
	total  int
	lines  []string
	events []string
}

func (s *lineSink) emit(event, line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.total++
	if len(s.lines) < maxSinkLines {
		s.lines = append(s.lines, line)
		s.events = append(s.events, event)
	}
}

func (s *lineSink) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.total
}

func (s *lineSink) snapshot() (lines, events []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.lines...), append([]string(nil), s.events...)
}

func startedTail(t *testing.T, dir string, sink *lineSink) *BackendLogger {
	t.Helper()
	b := &BackendLogger{logDir: dir, watchers: map[string]*tail.Tail{}, emitLine: sink.emit}
	require.NoError(t, b.StartTail(context.Background(), "ui"))
	t.Cleanup(func() {
		b.watchLock.Lock()
		tl := b.watchers["ui"]
		delete(b.watchers, "ui")
		b.watchLock.Unlock()
		if tl != nil {
			_ = tl.Stop()
			tl.Cleanup()
		}
	})
	return b
}

// waitForTailAtOffset waits until the tail has positioned itself at offset.
// The tail seeks in its own goroutine, so a line appended before that would be
// skipped and the test would be flaky.
func waitForTailAtOffset(t *testing.T, b *BackendLogger, name string, offset int64) {
	t.Helper()
	b.watchLock.Lock()
	tl := b.watchers[name]
	b.watchLock.Unlock()
	require.NotNil(t, tl)
	require.Eventually(t, func() bool {
		current, err := tl.Tell()
		return err == nil && current == offset
	}, 10*time.Second, 5*time.Millisecond, "the tail never reached the end of the existing log")
}

func appendToLog(t *testing.T, path, text string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	require.NoError(t, err)
	_, err = f.WriteString(text)
	require.NoError(t, err)
	require.NoError(t, f.Close())
}

// appendUntilDelivered appends numbered lines to the log, one every 25 ms, until
// at least want have been appended and the sink has received exactly as many as
// were appended, and returns them. A tail that is still registering its file
// watch misses an append made at that moment until the next write wakes it, so
// one append would make a test flaky; the next one recovers it. It fails at
// once if more lines are emitted than were appended, which is what replaying
// the existing log or running a second tail looks like.
func appendUntilDelivered(t *testing.T, path string, sink *lineSink, want int) []string {
	t.Helper()
	var appended []string
	deadline := time.Now().Add(10 * time.Second)
	for {
		emitted := sink.count()
		require.LessOrEqual(t, emitted, len(appended), "more lines were emitted than were appended")
		if len(appended) >= want && emitted == len(appended) {
			return appended
		}
		require.True(t, time.Now().Before(deadline), "appended %d lines but only %d were emitted", len(appended), emitted)
		line := fmt.Sprintf(`{"line":"new-%d"}`, len(appended)+1)
		appendToLog(t, path, line+"\n")
		appended = append(appended, line)
		time.Sleep(25 * time.Millisecond)
	}
}

// The viewer loads the history with ReadLog, which returns at most
// maxReadLogBytes. StartTail must therefore emit only what is appended after it
// starts: replaying a log of any size as events would defeat that cap for a
// remote viewer.
func TestStartTail_EmitsOnlyLinesAppendedAfterItStarts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ui.log")
	oldLine := `{"line":"old"}` + "\n"
	history := strings.Repeat(oldLine, 2*maxReadLogBytes/len(oldLine))
	require.Greater(t, len(history), maxReadLogBytes)
	require.NoError(t, os.WriteFile(path, []byte(history), 0o600))

	sink := &lineSink{}
	b := startedTail(t, dir, sink)
	waitForTailAtOffset(t, b, "ui", int64(len(history)))

	appended := appendUntilDelivered(t, path, sink, 3)
	require.Never(t, func() bool { return sink.count() > len(appended) }, 300*time.Millisecond, 20*time.Millisecond)

	lines, events := sink.snapshot()
	require.Equal(t, appended, lines)
	require.Len(t, events, len(appended))
	for _, event := range events {
		require.Equal(t, "internal/log/update:ui", event)
	}
}

// Starting a tail that is already running is a no-op, so the viewer's repeated
// StartTail calls never double the emitted lines.
func TestStartTail_StartingTwiceEmitsEachLineOnce(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ui.log")
	history := "{\"line\":\"old\"}\n"
	require.NoError(t, os.WriteFile(path, []byte(history), 0o600))

	sink := &lineSink{}
	b := startedTail(t, dir, sink)
	require.NoError(t, b.StartTail(context.Background(), "ui"))
	waitForTailAtOffset(t, b, "ui", int64(len(history)))

	appended := appendUntilDelivered(t, path, sink, 2)
	require.Never(t, func() bool { return sink.count() > len(appended) }, 300*time.Millisecond, 20*time.Millisecond)

	lines, _ := sink.snapshot()
	require.Equal(t, appended, lines)
}
