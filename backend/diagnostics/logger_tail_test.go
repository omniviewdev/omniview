package diagnostics

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

const (
	// maxSinkLines bounds what the sink keeps, so a regression that replays a huge
	// log fails with a readable message instead of a gigantic one.
	maxSinkLines = 32

	// deliveryTimeout is how long a test waits for the tail to deliver a line.
	// The tail polls the file every 250 ms, so this is generous even under -race.
	deliveryTimeout = 10 * time.Second

	// quietPeriod is how long a test watches for lines that should not arrive:
	// more than two poll intervals.
	quietPeriod = 600 * time.Millisecond
)

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

// newTailLogger returns a logger over dir whose tailed lines go to sink, and
// that stops whatever it still follows when the test ends.
func newTailLogger(t *testing.T, dir string, sink *lineSink) *BackendLogger {
	t.Helper()
	b := &BackendLogger{logDir: dir, watchers: map[string]*runningTail{}, emitLine: sink.emit}
	t.Cleanup(func() {
		for _, name := range tailNames(b) {
			require.NoError(t, b.StopTail(context.Background(), name))
		}
	})
	return b
}

// tailNames lists the logs b follows, sorted.
func tailNames(b *BackendLogger) []string {
	b.watchLock.Lock()
	defer b.watchLock.Unlock()
	names := make([]string, 0, len(b.watchers))
	for name := range b.watchers {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

func runningTailOf(t *testing.T, b *BackendLogger, name string) *runningTail {
	t.Helper()
	b.watchLock.Lock()
	defer b.watchLock.Unlock()
	running := b.watchers[name]
	require.NotNil(t, running)
	return running
}

func fileSize(t *testing.T, path string) int64 {
	t.Helper()
	info, err := os.Stat(path)
	require.NoError(t, err)
	return info.Size()
}

// startUITail starts the tail of ui.log and waits until it sits at the end of
// the file, so everything appended afterwards is new to it. The tail seeks in
// its own goroutine; a line appended before that would count as history and the
// test would be flaky.
func startUITail(t *testing.T, b *BackendLogger, path string) {
	t.Helper()
	require.NoError(t, b.StartTail(context.Background(), "ui"))
	running := runningTailOf(t, b, "ui")
	end := fileSize(t, path)
	require.Eventually(t, func() bool {
		offset, err := running.tail.Tell()
		return err == nil && offset == end
	}, deliveryTimeout, 5*time.Millisecond, "the tail never reached the end of the log at %d", end)
}

func appendToLog(t *testing.T, path, text string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	require.NoError(t, err)
	_, err = f.WriteString(text)
	require.NoError(t, err)
	require.NoError(t, f.Close())
}

// appendLines appends n log lines and returns them.
func appendLines(t *testing.T, path string, n int, prefix string) []string {
	t.Helper()
	lines := make([]string, 0, n)
	for i := 1; i <= n; i++ {
		line := fmt.Sprintf(`{"line":"%s-%d"}`, prefix, i)
		appendToLog(t, path, line+"\n")
		lines = append(lines, line)
	}
	return lines
}

func waitForEmitted(t *testing.T, sink *lineSink, want int) {
	t.Helper()
	require.Eventually(t, func() bool { return sink.count() >= want },
		deliveryTimeout, 10*time.Millisecond, "the tail did not emit %d lines", want)
}

// requireNoMoreEmitted fails if the sink receives anything beyond want lines
// within the quiet period.
func requireNoMoreEmitted(t *testing.T, sink *lineSink, want int) {
	t.Helper()
	require.Never(t, func() bool { return sink.count() != want }, quietPeriod, 20*time.Millisecond,
		"lines were emitted beyond the %d expected", want)
}

// openDescriptors counts this process's open file descriptors, the one that
// lists them included. It reads the names only: statting every entry of
// /dev/fd fails on macOS for descriptors that cannot be statted.
func openDescriptors(t *testing.T) int {
	t.Helper()
	dir, err := os.Open("/dev/fd")
	require.NoError(t, err)
	names, err := dir.Readdirnames(-1)
	require.NoError(t, err)
	require.NoError(t, dir.Close())
	return len(names)
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
	b := newTailLogger(t, dir, sink)
	startUITail(t, b, path)

	appended := appendLines(t, path, 3, "new")
	waitForEmitted(t, sink, len(appended))
	lines, events := sink.snapshot()
	require.Equal(t, appended, lines)
	require.Len(t, events, len(appended))
	for _, event := range events {
		require.Equal(t, "internal/log/update:ui", event)
	}
	requireNoMoreEmitted(t, sink, len(appended))
}

// Starting a tail that is already running is a no-op, so the viewer's repeated
// StartTail calls never double the emitted lines.
func TestStartTail_StartingTwiceEmitsEachLineOnce(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ui.log")
	require.NoError(t, os.WriteFile(path, []byte("{\"line\":\"old\"}\n"), 0o600))

	sink := &lineSink{}
	b := newTailLogger(t, dir, sink)
	startUITail(t, b, path)
	require.NoError(t, b.StartTail(context.Background(), "ui"))

	appended := appendLines(t, path, 2, "new")
	waitForEmitted(t, sink, len(appended))
	lines, _ := sink.snapshot()
	require.Equal(t, appended, lines)
	requireNoMoreEmitted(t, sink, len(appended))
}

// Only one tail exists at a time. The bound is a backstop: the host serves just
// the UI log, but nothing about a tail's cost depends on which file it follows.
func TestStartTail_OnlyOneTailExistsAtATime(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"ui.log", "other.log"} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("{\"line\":\"old\"}\n"), 0o600))
	}
	ctx := context.Background()
	b := newTailLogger(t, dir, &lineSink{})

	require.NoError(t, b.StartTail(ctx, "ui"))
	err := b.StartTail(ctx, "other")
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, apperror.TypeResourceLimit, appErr.Type)
	require.Equal(t, []string{"ui"}, tailNames(b), "the refused tail must not have been started")

	require.NoError(t, b.StartTail(ctx, "ui"), "starting the running tail again is not an error")
	require.Equal(t, []string{"ui"}, tailNames(b))

	require.NoError(t, b.StopTail(ctx, "ui"))
	require.NoError(t, b.StopTail(ctx, "ui"), "stopping a tail that is not running is not an error")
	require.Empty(t, tailNames(b))

	require.NoError(t, b.StartTail(ctx, "other"), "a stopped tail leaves room for another")
	require.Equal(t, []string{"other"}, tailNames(b))
}

// StopTail does not return before the tail is gone, and nothing is emitted
// after it returns, however the file grows.
func TestStopTail_ReturnsOnlyOnceTheTailHasEnded(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ui.log")
	require.NoError(t, os.WriteFile(path, []byte("{\"line\":\"old\"}\n"), 0o600))
	sink := &lineSink{}
	b := newTailLogger(t, dir, sink)
	startUITail(t, b, path)
	running := runningTailOf(t, b, "ui")

	require.NoError(t, b.StopTail(context.Background(), "ui"))

	select {
	case <-running.done:
	default:
		t.Fatal("StopTail returned while the goroutine emitting the tail's lines was still running")
	}
	appendLines(t, path, 2, "after-stop")
	requireNoMoreEmitted(t, sink, 0)
}

// A tail that is stopped and started again follows the file afresh: it delivers
// what is appended while it runs, once, and nothing from the earlier runs or from
// the time it was stopped. The tracker of the library's inotify mode can be left
// deaf by this sequence, which is why the tail polls.
func TestStartTail_AfterStopTailDeliversAgain(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ui.log")
	require.NoError(t, os.WriteFile(path, []byte("{\"line\":\"old\"}\n"), 0o600))
	sink := &lineSink{}
	b := newTailLogger(t, dir, sink)

	var want []string
	for cycle := 1; cycle <= 3; cycle++ {
		startUITail(t, b, path)
		want = append(want, appendLines(t, path, 2, fmt.Sprintf("cycle%d", cycle))...)
		waitForEmitted(t, sink, len(want))
		require.NoError(t, b.StopTail(context.Background(), "ui"))

		appendToLog(t, path, `{"line":"while stopped"}`+"\n")
		requireNoMoreEmitted(t, sink, len(want))
	}
	lines, _ := sink.snapshot()
	require.Equal(t, want, lines)
}

// The viewer starts and stops the tail as the user opens and closes it, and a
// remote client can do so as fast as it likes: every cycle must give back the
// goroutines and the file handle it took, or the host runs out of descriptors.
func TestStartStopTail_CyclesGiveBackGoroutinesAndDescriptors(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("open descriptors are counted through /dev/fd")
	}
	const (
		cycles = 200
		// The test binary may start a helper goroutine or open a descriptor of its
		// own while this runs; a leak costs at least one of each per cycle.
		goroutineSlack  = 3
		descriptorSlack = 2
	)
	dir := t.TempDir()
	path := filepath.Join(dir, "ui.log")
	require.NoError(t, os.WriteFile(path, []byte("{\"line\":\"old\"}\n"), 0o600))
	sink := &lineSink{}
	b := newTailLogger(t, dir, sink)
	ctx := context.Background()

	cycle := func(i int) {
		require.NoError(t, b.StartTail(ctx, "ui"))
		if i%50 == 0 {
			// Some tails get to do their work before they are stopped...
			startUITail(t, b, path)
			before := sink.count()
			appendToLog(t, path, `{"line":"x"}`+"\n")
			waitForEmitted(t, sink, before+1)
		}
		// ...most are stopped right away, when they are least settled.
		require.NoError(t, b.StopTail(ctx, "ui"))
	}

	cycle(0) // starts whatever the process keeps for good: timers, the poller
	goroutines, descriptors := runtime.NumGoroutine(), openDescriptors(t)
	for i := 1; i <= cycles; i++ {
		cycle(i)
	}

	// The polling watcher of a stopped tail may sleep for up to one poll interval
	// before it notices that and exits.
	deadline := time.Now().Add(5 * time.Second)
	for runtime.NumGoroutine() > goroutines+goroutineSlack && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	require.LessOrEqual(t, runtime.NumGoroutine(), goroutines+goroutineSlack,
		"goroutines after %d start/stop cycles", cycles)
	require.LessOrEqual(t, openDescriptors(t), descriptors+descriptorSlack,
		"open descriptors after %d start/stop cycles", cycles)
}
