package activityscript

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// waitFor is how long a test waits for an event that must come; it only ever decides a test that has already failed, so a slow machine cannot turn a pass into a failure.
const waitFor = 10 * time.Second

// fakeClock is a clock that moves when the test moves it.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newClock() *fakeClock {
	return &fakeClock{now: time.Date(2030, 1, 2, 3, 4, 5, 123456789, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// fakeReporter records every attempt, in order. It fails the first `failFirst` attempts the way a host that has not bound the reporter yet does, and every attempt of a method named in `failing` the way a host that does not know
// the task or the alert does. A successful attempt signals on `signal`.
type fakeReporter struct {
	mu        sync.Mutex
	failFirst int
	failing   map[string]error
	attempts  int
	succeeded int
	order     []string
	begins    []activity.Spec
	reports   []activity.ReportTaskRequest
	finishes  []activity.FinishTaskRequest
	upserts   []activity.AlertRequest
	resolves  []activity.ResolveAlertRequest
	signal    chan string
}

func newReporter() *fakeReporter {
	return &fakeReporter{failing: map[string]error{}, signal: make(chan string, 64)}
}

// attempt counts one call and says what the host answers: the record on success.
func (f *fakeReporter) attempt(method string) (activity.Record, error) {
	f.attempts++
	f.order = append(f.order, method)
	if f.attempts <= f.failFirst {
		return activity.Record{}, errors.New("the host has not bound the reporter")
	}
	if err := f.failing[method]; err != nil {
		return activity.Record{}, err
	}
	f.succeeded++
	f.signal <- method

	return activity.Record{ID: fmt.Sprintf("rec-%d", f.succeeded)}, nil
}

func (f *fakeReporter) BeginTask(_ context.Context, spec activity.Spec) (activity.Record, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.begins = append(f.begins, spec)

	return f.attempt("BeginTask")
}

func (f *fakeReporter) ReportTask(_ context.Context, request activity.ReportTaskRequest) (activity.Record, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reports = append(f.reports, request)

	return f.attempt("ReportTask")
}

func (f *fakeReporter) FinishTask(_ context.Context, request activity.FinishTaskRequest) (activity.Record, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.finishes = append(f.finishes, request)

	return f.attempt("FinishTask")
}

func (f *fakeReporter) UpsertAlert(_ context.Context, request activity.AlertRequest) (activity.Record, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upserts = append(f.upserts, request)

	return f.attempt("UpsertAlert")
}

func (f *fakeReporter) ResolveAlert(_ context.Context, request activity.ResolveAlertRequest) (activity.Record, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resolves = append(f.resolves, request)

	return f.attempt("ResolveAlert")
}

func (f *fakeReporter) attemptCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()

	return f.attempts
}

func (f *fakeReporter) methods() []string {
	f.mu.Lock()
	defer f.mu.Unlock()

	return append([]string(nil), f.order...)
}

// writeScript puts `text` as the whole script in a fresh directory.
func writeScript(t *testing.T, text string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "activity-script"), []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}

	return dir
}

// appendScript adds `text` to the script, as the check does.
func appendScript(t *testing.T, dir, text string) {
	t.Helper()
	file, err := os.OpenFile(filepath.Join(dir, "activity-script"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.WriteString(text); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
}

// logLines are the lines of the log, none when there is no log.
func logLines(t *testing.T, dir string) []string {
	t.Helper()
	text, err := os.ReadFile(filepath.Join(dir, "activity-script.log"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}

	return completeLines(string(text))
}

func wantLog(t *testing.T, dir string, want ...string) {
	t.Helper()
	got := logLines(t, dir)
	if len(got) == 0 && len(want) == 0 {
		return
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("log:\n got %q\nwant %q", got, want)
	}
}

func tick(t *testing.T, runner *Runner) {
	t.Helper()
	if err := runner.Tick(context.Background()); err != nil {
		t.Fatalf("Tick: %v", err)
	}
}

func units(current, total string) *resourcev2.ActivityProgress {
	return &resourcev2.ActivityProgress{Kind: "units", Message: "", Current: current, Total: total, Unit: "items", Label: ""}
}

func TestParse(t *testing.T) {
	t.Parallel()

	valid := []struct {
		line string
		want command
	}{
		{"task begin a 5 Import alpha items", command{kind: kindTaskBegin, name: "a", total: 5, title: "Import alpha items"}},
		{"task step a 3", command{kind: kindTaskStep, name: "a", current: 3}},
		{"task finish a succeeded", command{kind: kindTaskFinish, name: "a", state: "succeeded"}},
		{"task finish a failed Acme refused the item", command{kind: kindTaskFinish, name: "a", state: "failed", message: "Acme refused the item"}},
		{"alert fire k1 warning Acme alpha is slow", command{kind: kindAlertFire, key: "k1", severity: "warning", title: "Acme alpha is slow"}},
		{"alert fire k1 error connection=c-1 Acme alpha is down", command{kind: kindAlertFire, key: "k1", severity: "error", connection: "c-1", title: "Acme alpha is down"}},
		{"alert resolve k1", command{kind: kindAlertResolve, key: "k1"}},
		{"task step a 3\r", command{kind: kindTaskStep, name: "a", current: 3}},
	}
	for _, test := range valid {
		got, err := parse(test.line)
		if err != nil {
			t.Errorf("parse(%q): %v", test.line, err)

			continue
		}
		if got != test.want {
			t.Errorf("parse(%q):\n got %+v\nwant %+v", test.line, got, test.want)
		}
	}

	invalid := []string{
		"",
		"frob x",
		"task",
		"task begin a",
		"task begin a 5",
		"task begin a 5 ",
		"task begin a 0 Title",
		"task begin a x Title",
		"task begin a 5 " + strings.Repeat("t", 513),
		"task step a",
		"task step a -1",
		"task step a x",
		"task finish a",
		"task finish a done",
		"task finish a succeeded " + strings.Repeat("m", 4097),
		"alert fire k1 loud Title",
		"alert fire k1 info",
		"alert fire k1 info connection=c-1",
		"alert fire k1 info connection= Title",
		"alert fire " + strings.Repeat("k", 1025) + " info Title",
		"alert resolve",
		"alert resolve " + strings.Repeat("k", 1025),
	}
	for _, line := range invalid {
		if got, err := parse(line); err == nil {
			t.Errorf("parse(%.40q) = %+v, want an error", line, got)
		}
	}
}

func TestCompleteLinesAreThoseThatEndWithANewline(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		text string
		want []string
	}{
		{"", nil},
		{"a", nil},
		{"a\n", []string{"a"}},
		{"a\nb", []string{"a"}},
		{"a\n\nb\n", []string{"a", "", "b"}},
	} {
		if got := completeLines(test.text); !reflect.DeepEqual(got, test.want) {
			t.Errorf("completeLines(%q) = %q, want %q", test.text, got, test.want)
		}
	}
}

func TestLinesAlreadyInTheScriptAreNeverExecuted(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "alert fire k1 info Acme alpha\nalert resolve k1\n")
	runner := New(dir, reporter, newClock())
	tick(t, runner)
	if got := reporter.attemptCount(); got != 0 {
		t.Fatalf("%d calls for lines that were there before the runner started, want 0", got)
	}

	appendScript(t, dir, "alert fire k2 info Acme beta\n")
	tick(t, runner)
	wantLog(t, dir, "ok 3 alert fire k2 info Acme beta")

	// A process the host starts again counts what the first one did as done, and does it no more.
	again := newReporter()
	tick(t, New(dir, again, newClock()))
	if got := again.attemptCount(); got != 0 {
		t.Fatalf("a restarted process replayed %d calls", got)
	}
	appendScript(t, dir, "alert resolve k2\n")
	tick(t, New(dir, again, newClock()))
	wantLog(t, dir, "ok 3 alert fire k2 info Acme beta")
	if got := again.attemptCount(); got != 0 {
		t.Fatalf("a runner made after the line was written replayed it: %d calls", got)
	}
}

func TestACommandReachesTheReporterAsWritten(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	clock := newClock()
	dir := writeScript(t, "")
	runner := New(dir, reporter, clock)
	appendScript(t, dir, strings.Join([]string{
		"task begin a 5 Import alpha items",
		"task step a 3",
		"task finish a failed Acme refused item 4",
		"alert fire k1 error connection=c-1 Acme alpha is down",
		"alert fire k2 info Acme beta",
		"alert resolve k1",
		"",
	}, "\n"))
	tick(t, runner)

	wantLog(t, dir,
		"ok 1 task begin a 5 Import alpha items",
		"ok 2 task step a 3",
		"ok 3 task finish a failed Acme refused item 4",
		"ok 4 alert fire k1 error connection=c-1 Acme alpha is down",
		"ok 5 alert fire k2 info Acme beta",
		"ok 6 alert resolve k1",
	)
	wantMethods := []string{"BeginTask", "ReportTask", "FinishTask", "UpsertAlert", "UpsertAlert", "ResolveAlert"}
	if got := reporter.methods(); !reflect.DeepEqual(got, wantMethods) {
		t.Fatalf("calls %q, want %q", got, wantMethods)
	}

	if want := []activity.Spec{{Presentation: activity.Presentation{Title: "Import alpha items", Progress: units("0", "5")}}}; !reflect.DeepEqual(reporter.begins, want) {
		t.Errorf("BeginTask %+v, want %+v", reporter.begins, want)
	}
	// The record id the host gave to the begin is the id of the step and of the finish.
	observed := "2030-01-02T03:04:05.123456789Z"
	wantReports := []activity.ReportTaskRequest{{ID: "rec-1", State: "running", ObservedAt: observed, Presentation: activity.Presentation{Title: "Import alpha items", Progress: units("3", "5")}}}
	if !reflect.DeepEqual(reporter.reports, wantReports) {
		t.Errorf("ReportTask %+v, want %+v", reporter.reports, wantReports)
	}
	wantFinishes := []activity.FinishTaskRequest{{ID: "rec-1", State: "failed", Presentation: &activity.Presentation{Title: "Import alpha items", Message: "Acme refused item 4"}}}
	if !reflect.DeepEqual(reporter.finishes, wantFinishes) {
		t.Errorf("FinishTask %+v, want %+v", reporter.finishes, wantFinishes)
	}
	if len(reporter.upserts) != 2 || len(reporter.resolves) != 1 {
		t.Fatalf("%d UpsertAlert and %d ResolveAlert calls, want 2 and 1", len(reporter.upserts), len(reporter.resolves))
	}
	first := reporter.upserts[0]
	if first.Key != "k1" || first.Severity != "error" || first.Presentation.Title != "Acme alpha is down" || first.Source == nil || first.Source.ConnectionID != "c-1" {
		t.Errorf("first UpsertAlert %+v", first)
	}
	if second := reporter.upserts[1]; second.Key != "k2" || second.Severity != "info" || second.Presentation.Title != "Acme beta" || (second.Source != nil && second.Source.ConnectionID != "") {
		t.Errorf("second UpsertAlert %+v", second)
	}
	if len(reporter.resolves) != 1 || reporter.resolves[0].Key != "k1" {
		t.Errorf("ResolveAlert %+v", reporter.resolves)
	}
}

func TestAFinishedTaskNameIsForgotten(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "")
	runner := New(dir, reporter, newClock())
	appendScript(t, dir, "task begin a 2 Import alpha\ntask finish a succeeded\ntask step a 1\ntask begin a 2 Import alpha again\n")
	tick(t, runner)

	wantLog(t, dir,
		"ok 1 task begin a 2 Import alpha",
		"ok 2 task finish a succeeded",
		`error 3 unknown task "a"`,
		"ok 4 task begin a 2 Import alpha again",
	)
}

func TestObservedAtOnlyGoesForwardWhenTheClockStandsStill(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "")
	runner := New(dir, reporter, newClock())
	appendScript(t, dir, "task begin a 5 Import alpha\ntask step a 1\ntask step a 2\nalert fire k1 info Acme alpha\nalert resolve k1\n")
	tick(t, runner)

	// The host drops a report that is not newer than the last one it has, so two of them in the same instant would lose the second.
	if len(reporter.reports) != 2 || len(reporter.upserts) != 1 || len(reporter.resolves) != 1 {
		t.Fatalf("calls %q, want two steps, one fire and one resolve", reporter.methods())
	}
	stamps := []string{reporter.reports[0].ObservedAt, reporter.reports[1].ObservedAt, reporter.upserts[0].ObservedAt, reporter.resolves[0].ObservedAt}
	want := []string{
		"2030-01-02T03:04:05.123456789Z",
		"2030-01-02T03:04:05.12345679Z",
		"2030-01-02T03:04:05.123456791Z",
		"2030-01-02T03:04:05.123456792Z",
	}
	if !reflect.DeepEqual(stamps, want) {
		t.Fatalf("ObservedAt %q, want %q", stamps, want)
	}
}

func TestALineWithoutANewlineWaits(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "")
	runner := New(dir, reporter, newClock())
	appendScript(t, dir, "task begin a 5 Imp")
	tick(t, runner)
	if got := reporter.attemptCount(); got != 0 {
		t.Fatalf("a line that was still being written was executed (%d calls)", got)
	}

	appendScript(t, dir, "ort alpha\n")
	tick(t, runner)
	if len(reporter.begins) != 1 || reporter.begins[0].Presentation.Title != "Import alpha" {
		t.Fatalf("BeginTask %+v, want one with the title %q", reporter.begins, "Import alpha")
	}
	wantLog(t, dir, "ok 1 task begin a 5 Import alpha")
}

func TestACallThatFailsIsTriedAgainOnTheNextTicks(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	reporter.failFirst = 3
	clock := newClock()
	dir := writeScript(t, "")
	runner := New(dir, reporter, clock)
	appendScript(t, dir, "alert fire k1 info Acme alpha\nalert resolve k1\n")

	for i := range 3 {
		tick(t, runner)
		wantLog(t, dir)
		if got := reporter.methods(); len(got) != i+1 {
			t.Fatalf("tick %d: calls %q, want %d attempts of the first line and none of the second", i+1, got, i+1)
		}
		clock.Advance(100 * time.Millisecond)
	}

	tick(t, runner)
	wantLog(t, dir, "ok 1 alert fire k1 info Acme alpha", "ok 2 alert resolve k1")
	wantMethods := []string{"UpsertAlert", "UpsertAlert", "UpsertAlert", "UpsertAlert", "ResolveAlert"}
	if got := reporter.methods(); !reflect.DeepEqual(got, wantMethods) {
		t.Fatalf("calls %q, want %q", got, wantMethods)
	}
}

func TestACallThatKeepsFailingIsSkippedAfterTenSecondsAndOrderHolds(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	reporter.failing["ResolveAlert"] = errors.New("alert unavailable")
	clock := newClock()
	dir := writeScript(t, "")
	runner := New(dir, reporter, clock)
	appendScript(t, dir, "alert resolve gone\nalert fire k1 info Acme alpha\nalert resolve gone-too\n")

	tick(t, runner)
	clock.Advance(10*time.Second - time.Nanosecond)
	tick(t, runner)
	wantLog(t, dir)
	if got := reporter.methods(); !reflect.DeepEqual(got, []string{"ResolveAlert", "ResolveAlert"}) {
		t.Fatalf("calls %q: a later line ran before the earlier one was settled", got)
	}

	// Ten seconds: the first line is recorded as an error and skipped, the second goes, and the third starts its own ten seconds.
	clock.Advance(time.Nanosecond)
	tick(t, runner)
	wantLog(t, dir, "error 1 alert unavailable", "ok 2 alert fire k1 info Acme alpha")
	clock.Advance(10*time.Second - time.Nanosecond)
	tick(t, runner)
	wantLog(t, dir, "error 1 alert unavailable", "ok 2 alert fire k1 info Acme alpha")

	clock.Advance(time.Nanosecond)
	tick(t, runner)
	wantLog(t, dir, "error 1 alert unavailable", "ok 2 alert fire k1 info Acme alpha", "error 3 alert unavailable")
}

func TestALineThatCannotRunIsAnErrorAtOnceAndDoesNotBlockTheNext(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "")
	runner := New(dir, reporter, newClock())
	appendScript(t, dir, strings.Join([]string{
		"frob x",
		"task step nope 1",
		"task begin a 5 Import alpha",
		"task begin a 5 Import alpha twice",
		"task step a 6",
		"alert resolve k1",
		"",
	}, "\n"))
	tick(t, runner)

	lines := logLines(t, dir)
	wantPrefixes := []string{
		"error 1 ",
		`error 2 unknown task "nope"`,
		"ok 3 task begin a 5 Import alpha",
		`error 4 task "a" is already begun`,
		"error 5 step 6 is past the total 5",
		"ok 6 alert resolve k1",
	}
	if len(lines) != len(wantPrefixes) {
		t.Fatalf("log %q, want %d lines", lines, len(wantPrefixes))
	}
	for i, prefix := range wantPrefixes {
		if !strings.HasPrefix(lines[i], prefix) {
			t.Errorf("log line %d is %q, want it to start with %q", i+1, lines[i], prefix)
		}
	}
	if got := reporter.methods(); !reflect.DeepEqual(got, []string{"BeginTask", "ResolveAlert"}) {
		t.Fatalf("calls %q: a line that cannot run must not reach the host", got)
	}
}

func TestRunTicksOnEveryValueUntilTheContextEnds(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "")
	runner := New(dir, reporter, newClock())
	ticks := make(chan time.Time)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		runner.Run(ctx, ticks)
	}()

	send := func() {
		t.Helper()
		select {
		case ticks <- time.Time{}:
		case <-done:
			t.Fatal("Run ended before the context did")
		case <-time.After(waitFor):
			t.Fatal("Run did not take a tick")
		}
	}

	appendScript(t, dir, "alert fire k1 info Acme alpha\n")
	send()
	select {
	case method := <-reporter.signal:
		if method != "UpsertAlert" {
			t.Fatalf("call %q, want UpsertAlert", method)
		}
	case <-time.After(waitFor):
		t.Fatal("the line was not executed")
	}

	appendScript(t, dir, "alert resolve k1\n")
	send()
	select {
	case method := <-reporter.signal:
		if method != "ResolveAlert" {
			t.Fatalf("call %q, want ResolveAlert", method)
		}
	case <-time.After(waitFor):
		t.Fatal("the second line was not executed")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(waitFor):
		t.Fatal("Run did not end with its context")
	}
	wantLog(t, dir, "ok 1 alert fire k1 info Acme alpha", "ok 2 alert resolve k1")
}

func TestStartPollsTheScriptUntilStopped(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "alert fire old info Acme before the start\n")
	stop := start(dir, reporter)
	appendScript(t, dir, "alert fire k1 info Acme alpha\n")

	select {
	case <-reporter.signal:
	case <-time.After(waitFor):
		stop()
		t.Fatal("the line was not executed by the poll")
	}
	stop()
	// Stopped means no tick is running and none comes: the line written now stays unexecuted.
	appendScript(t, dir, "alert fire k2 info Acme beta\n")
	if got := reporter.attemptCount(); got != 1 {
		t.Fatalf("%d calls, want 1 (the line before the start is not replayed)", got)
	}
	wantLog(t, dir, "ok 2 alert fire k1 info Acme alpha")
}

// cancelAfterReporter is a reporter whose host answers an alert and then the process is told to stop, as a shutdown that comes the instant the call succeeds.
type cancelAfterReporter struct {
	*fakeReporter
	cancel context.CancelFunc
}

func (c cancelAfterReporter) UpsertAlert(ctx context.Context, request activity.AlertRequest) (activity.Record, error) {
	record, err := c.fakeReporter.UpsertAlert(ctx, request)
	c.cancel()

	return record, err
}

// silentReporter is a host that accepts every call and never answers: a call ends only with its context.
type silentReporter struct {
	*fakeReporter
	calls   chan struct{}
	endedBy chan error
}

func newSilentReporter() silentReporter {
	return silentReporter{fakeReporter: newReporter(), calls: make(chan struct{}, 64), endedBy: make(chan error, 64)}
}

func (s silentReporter) UpsertAlert(ctx context.Context, _ activity.AlertRequest) (activity.Record, error) {
	s.calls <- struct{}{}
	<-ctx.Done()
	s.endedBy <- ctx.Err()

	return activity.Record{}, ctx.Err()
}

// tickWithin runs a tick and fails the test when it does not return: a tick that waits on the host for ever is the fault.
func tickWithin(ctx context.Context, t *testing.T, runner *Runner) error {
	t.Helper()
	result := make(chan error, 1)
	go func() { result <- runner.Tick(ctx) }()
	select {
	case err := <-result:
		return err
	case <-time.After(waitFor):
		t.Fatal("Tick did not return: a call of the reporter has no deadline")

		return nil
	}
}

func TestAScriptThatCannotBeReadAtStartIsNotAnEmptyBaseline(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "alert fire old1 info Acme before\nalert resolve old1\n")
	path := filepath.Join(dir, "activity-script")
	if err := os.Chmod(path, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := os.ReadFile(path); err == nil {
		t.Skip("the script is readable with mode 0 (running as a user that bypasses file modes)")
	}
	runner := New(dir, reporter, newClock())

	// The baseline is unknown: the tick says so, and nothing is dispatched from it.
	if err := runner.Tick(context.Background()); err == nil {
		t.Fatal("Tick = nil while the script cannot be read, want the initialization failure")
	}
	if got := reporter.attemptCount(); got != 0 {
		t.Fatalf("%d calls from an unknown baseline, want 0", got)
	}

	// The script becomes readable: the lines that were there at the start still count as done, and a new one runs.
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	tick(t, runner)
	if got := reporter.attemptCount(); got != 0 {
		t.Fatalf("%d calls replayed the lines that were there before the runner started, want 0", got)
	}
	appendScript(t, dir, "alert fire k2 info Acme beta\n")
	tick(t, runner)
	wantLog(t, dir, "ok 3 alert fire k2 info Acme beta")
	if got := reporter.attemptCount(); got != 1 {
		t.Fatalf("%d calls, want 1", got)
	}
}

func TestAMissingScriptAtStartIsAnEmptyBaseline(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := t.TempDir()
	runner := New(dir, reporter, newClock())
	tick(t, runner)
	appendScript(t, dir, "alert fire k1 info Acme alpha\n")
	tick(t, runner)
	wantLog(t, dir, "ok 1 alert fire k1 info Acme alpha")
}

func TestACallThatNeverAnswersEndsAtItsDeadlineAndIsRetried(t *testing.T) {
	t.Parallel()

	reporter := newSilentReporter()
	clock := newClock()
	dir := writeScript(t, "")
	runner := New(dir, reporter, clock)
	runner.callTimeout = 20 * time.Millisecond
	appendScript(t, dir, "alert fire k1 info Acme alpha\nalert resolve k1\n")

	// The call ends by its deadline, not by the context of the tick: the line is tried again on the next tick, and the one behind it waits.
	if err := tickWithin(context.Background(), t, runner); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	if got := <-reporter.endedBy; !errors.Is(got, context.DeadlineExceeded) {
		t.Fatalf("the call ended with %v, want its deadline", got)
	}
	wantLog(t, dir)
	if err := tickWithin(context.Background(), t, runner); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	if got := len(reporter.calls); got != 2 {
		t.Fatalf("%d calls of the first line, want 2 (one per tick) and none of the second", got)
	}

	// Ten seconds of it: the line is an error and the next one goes on.
	clock.Advance(retryFor)
	if err := tickWithin(context.Background(), t, runner); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	wantLog(t, dir, "error 1 context deadline exceeded", "ok 2 alert resolve k1")
}

func TestACallThatNeverAnswersEndsWithTheShutdown(t *testing.T) {
	t.Parallel()

	reporter := newSilentReporter()
	dir := writeScript(t, "")
	runner := New(dir, reporter, newClock())
	appendScript(t, dir, "alert fire k1 info Acme alpha\n")
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-reporter.calls
		cancel()
	}()

	if err := tickWithin(ctx, t, runner); !errors.Is(err, context.Canceled) {
		t.Fatalf("Tick = %v, want the cancellation", err)
	}
	wantLog(t, dir)
}

func TestAReportThatSucceedsIsAcknowledgedBeforeTheShutdownIsHonoured(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := New(dir, cancelAfterReporter{fakeReporter: reporter, cancel: cancel}, newClock())
	appendScript(t, dir, "alert fire k1 info Acme alpha\nalert fire k2 info Acme beta\n")

	if err := runner.Tick(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("Tick = %v, want the cancellation", err)
	}
	wantLog(t, dir, "ok 1 alert fire k1 info Acme alpha")
	if got := reporter.attemptCount(); got != 1 {
		t.Fatalf("%d calls, want 1: the next command must not start once the shutdown is there", got)
	}
}

func TestAResultThatCannotBeLoggedIsKeptAndNeverReportedTwice(t *testing.T) {
	t.Parallel()

	reporter := newReporter()
	dir := writeScript(t, "")
	runner := New(dir, reporter, newClock())
	appendScript(t, dir, "alert fire k1 info Acme alpha\nalert resolve k1\n")
	// The log cannot be opened: a directory is in its place.
	logPath := filepath.Join(dir, "activity-script.log")
	if err := os.Mkdir(logPath, 0o700); err != nil {
		t.Fatal(err)
	}

	for range 2 {
		if err := runner.Tick(context.Background()); err == nil {
			t.Fatal("Tick = nil while the log cannot be written, want the error")
		}
	}
	if got := reporter.methods(); !reflect.DeepEqual(got, []string{"UpsertAlert"}) {
		t.Fatalf("calls %q: the report is made once, and the line behind it waits for its result to be logged", got)
	}

	if err := os.Remove(logPath); err != nil {
		t.Fatal(err)
	}
	tick(t, runner)
	wantLog(t, dir, "ok 1 alert fire k1 info Acme alpha", "ok 2 alert resolve k1")
	if got := reporter.methods(); !reflect.DeepEqual(got, []string{"UpsertAlert", "ResolveAlert"}) {
		t.Fatalf("calls %q, want each line reported once", got)
	}
}
