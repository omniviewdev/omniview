// Package activityscript is the part of the seam's fixture processes that reports real activity on command: a plugin process that tells the host about tasks with progress and about alerts, through the plugin SDK's
// reporter, when (and only when) the check writes a line for it, so that the check can prove the window's Operations and Problems tools end to end against the real host and a real plugin process, not against a mock.
//
// The check appends lines to the file `activity-script` in the plugin's own directory (next to bin/), one command per line, fields separated by single spaces; the last field of a command is the rest of the line. Every line
// ends with a newline: a line without one is still being written and waits. The commands:
//
//	task begin <name> <total> <title...>             a task of <total> items, at 0 of <total>; <name> is the script's own name for it
//	task step <name> <current>                       the task is at <current> of its total
//	task finish <name> <state> [message...]          the task ends: <state> is succeeded, failed, cancelled or unknown
//	alert fire <key> <severity> <title...>           an alert for the key: <severity> is info, warning or error
//	alert fire <key> <severity> connection=<id> <title...>   the same, for the connection <id>
//	alert resolve <key>                              the alert for the key is resolved
//
// What came of each line is appended to `activity-script.log` in the same directory, one line each: `ok <n> <the command line>` or `error <n> <the error text>`, with n the 1-based number of the line in the script. The check
// waits for that line to know the host has the fact, instead of waiting for a time.
package activityscript

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/activity"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const (
	// scriptFile and logFile are the files of the script and of what came of it, in the plugin's own directory (next to bin/).
	scriptFile = "activity-script"
	logFile    = "activity-script.log"

	// pollEvery is how often the script is read.
	pollEvery = 100 * time.Millisecond

	// retryFor is how long a call that fails is tried again, on every tick, before the line is recorded as an error and skipped. Right after the process starts the host has not bound the reporter yet and every call fails; the
	// call that answers with an error after that is one the host will go on refusing (a task or an alert it does not know), and waiting longer would only hold up the lines behind it.
	retryFor = 10 * time.Second

	// The limits the host enforces on what a command says (the SDK's ValidateActivityPresentation and the host's alert key check), in bytes. A line over a limit is an error at once: the host would refuse it for the whole of retryFor.
	maxTitle   = 512
	maxMessage = 4096
	maxKey     = 1024

	unitsKind = "units"
	itemsUnit = "items"
)

// Reporter is the part of the SDK's activity reporter that the commands use; the SDK's `activity.Reporter` is one.
type Reporter interface {
	BeginTask(context.Context, activity.Spec) (activity.Record, error)
	ReportTask(context.Context, activity.ReportTaskRequest) (activity.Record, error)
	FinishTask(context.Context, activity.FinishTaskRequest) (activity.Record, error)
	UpsertAlert(context.Context, activity.AlertRequest) (activity.Record, error)
	ResolveAlert(context.Context, activity.ResolveAlertRequest) (activity.Record, error)
}

// Clock is the time of the runner: the wall clock, and in a test a clock that moves when the test says so.
type Clock interface {
	Now() time.Time
}

// wallClock is the time of the host.
type wallClock struct{}

func (wallClock) Now() time.Time { return time.Now() }

type kind int

const (
	kindTaskBegin kind = iota + 1
	kindTaskStep
	kindTaskFinish
	kindAlertFire
	kindAlertResolve
)

// command is one line of the script, parsed.
type command struct {
	kind                                            kind
	name, state, message, key, severity, connection string
	title                                           string
	total, current                                  uint64
}

// permanentError is a failure that trying again cannot change: a line that is not a command, a task the script never began. It is recorded at once, where a failed call of the host is tried again.
type permanentError string

func (e permanentError) Error() string { return string(e) }

func permanentf(format string, args ...any) error {
	return permanentError(fmt.Sprintf(format, args...))
}

// parse turns a line into a command, or says why it is not one.
func parse(line string) (command, error) {
	var c command
	line = strings.TrimSuffix(line, "\r")
	words := strings.SplitN(line, " ", 3) //nolint:mnd // The two words that name a command, and the rest of the line.
	if len(words) < 2 {                   //nolint:mnd // See above.
		return c, permanentf("not a command: %q", line)
	}
	rest := ""
	if len(words) == 3 { //nolint:mnd // See above.
		rest = words[2]
	}

	var err error
	switch words[0] + " " + words[1] {
	case "task begin":
		err = parseBegin(&c, rest)
	case "task step":
		err = parseStep(&c, rest)
	case "task finish":
		err = parseFinish(&c, rest)
	case "alert fire":
		err = parseFire(&c, rest)
	case "alert resolve":
		err = parseResolve(&c, rest)
	default:
		err = errors.New("unknown command")
	}
	if err != nil {
		return command{}, permanentf("%v: %q", err, line)
	}

	return c, nil
}

// parseBegin reads `<name> <total> <title...>`.
func parseBegin(c *command, rest string) error {
	words := strings.SplitN(rest, " ", 3) //nolint:mnd // Name, total and the title.
	if len(words) < 3 || words[0] == "" {
		return errors.New("want: task begin <name> <total> <title...>")
	}
	total, err := strconv.ParseUint(words[1], 10, 64)
	if err != nil || total == 0 {
		return errors.New("the total must be a whole number above 0")
	}
	if err = checkText("title", words[2], maxTitle, true); err != nil {
		return err
	}
	c.kind, c.name, c.total, c.title = kindTaskBegin, words[0], total, words[2]

	return nil
}

// parseStep reads `<name> <current>`.
func parseStep(c *command, rest string) error {
	words := strings.Split(rest, " ")
	if len(words) != 2 || words[0] == "" {
		return errors.New("want: task step <name> <current>")
	}
	current, err := strconv.ParseUint(words[1], 10, 64)
	if err != nil {
		return errors.New("the current must be a whole number, 0 or above")
	}
	c.kind, c.name, c.current = kindTaskStep, words[0], current

	return nil
}

// parseFinish reads `<name> <state> [message...]`.
func parseFinish(c *command, rest string) error {
	words := strings.SplitN(rest, " ", 3) //nolint:mnd // Name, state and the message.
	if len(words) < 2 || words[0] == "" {
		return errors.New("want: task finish <name> <state> [message...]")
	}
	switch words[1] {
	case "succeeded", "failed", "cancelled", "unknown":
	default:
		return errors.New("the state must be succeeded, failed, cancelled or unknown")
	}
	message := ""
	if len(words) == 3 { //nolint:mnd // See above.
		message = words[2]
	}
	if err := checkText("message", message, maxMessage, false); err != nil {
		return err
	}
	c.kind, c.name, c.state, c.message = kindTaskFinish, words[0], words[1], message

	return nil
}

// parseFire reads `<key> <severity> [connection=<id>] <title...>`.
func parseFire(c *command, rest string) error {
	words := strings.SplitN(rest, " ", 3) //nolint:mnd // Key, severity and the rest.
	if len(words) < 3 || words[0] == "" {
		return errors.New("want: alert fire <key> <severity> [connection=<id>] <title...>")
	}
	if len(words[0]) > maxKey {
		return errors.New("the key is too long")
	}
	switch words[1] {
	case "info", "warning", "error":
	default:
		return errors.New("the severity must be info, warning or error")
	}
	title := words[2]
	if text, found := strings.CutPrefix(title, "connection="); found {
		id, afterID, hasTitle := strings.Cut(text, " ")
		if id == "" || !hasTitle {
			return errors.New("want a connection id and a title after connection=")
		}
		c.connection, title = id, afterID
	}
	if err := checkText("title", title, maxTitle, true); err != nil {
		return err
	}
	c.kind, c.key, c.severity, c.title = kindAlertFire, words[0], words[1], title

	return nil
}

// parseResolve reads `<key>`.
func parseResolve(c *command, rest string) error {
	if rest == "" || strings.Contains(rest, " ") || len(rest) > maxKey {
		return errors.New("want: alert resolve <key>")
	}
	c.kind, c.key = kindAlertResolve, rest

	return nil
}

// checkText says whether `text` is within the host's limit, and not empty when it must not be.
func checkText(what, text string, limit int, required bool) error {
	if required && text == "" {
		return fmt.Errorf("the %s is empty", what)
	}
	if len(text) > limit {
		return fmt.Errorf("the %s is over %d bytes", what, limit)
	}

	return nil
}

// completeLines are the lines of the text that end with a newline, without it: a line the check is still writing is not one yet.
func completeLines(text string) []string {
	end := strings.LastIndexByte(text, '\n')
	if end < 0 {
		return nil
	}

	return strings.Split(text[:end], "\n")
}

// giveUp says whether a line whose call has failed since `since` has been tried for long enough.
func giveUp(since, now time.Time) bool { return now.Sub(since) >= retryFor }

// task is what the runner keeps of a task it began: the id the host gave it, and what a step must say again.
type task struct {
	id    string
	title string
	total uint64
}

// outcome is what came of a line, waiting to be appended to the log.
type outcome struct {
	n    int
	line string
	err  error
}

// Runner executes the lines of the script, in order, once each.
type Runner struct {
	script, log string
	reporter    Reporter
	clock       Clock
	// executed is the number of lines that are done, recorded as ok or as an error; the next one to run is the line after them. It starts at the lines already in the script, so that a process the host starts
	// again does not replay what an earlier one did.
	executed int
	// baselined says whether executed is known. A script that is missing at the start is an empty baseline; one that cannot be read is an unknown baseline, and nothing runs until a tick has read it: a runner that
	// guessed 0 would replay, on the first read that works, every command an earlier process has done. The lines written between the start and that read count as part of the baseline.
	baselined bool
	// failingSince is when the call of the line next to run first failed, zero while it has not.
	failingSince time.Time
	tasks        map[string]task
	// observed is the last ObservedAt given: the host drops a report that is not newer than the last it has, and two calls in the same instant of a coarse clock would lose the second.
	observed time.Time
	// callTimeout is the longest one call of the reporter may take: a host that accepts a call and never answers must not hold the runner, and it must not hold a line past retryFor either.
	callTimeout time.Duration
	// pending is the outcome of the line that was done last, until it is in the log. The call is made: it is never made again, only the append is.
	pending *outcome
}

// New is a runner for the script in `directory`; the lines already there count as executed.
func New(directory string, reporter Reporter, clock Clock) *Runner {
	r := &Runner{
		script: filepath.Join(directory, scriptFile), log: filepath.Join(directory, logFile),
		reporter: reporter, clock: clock, executed: 0, baselined: false, failingSince: time.Time{}, tasks: map[string]task{}, observed: time.Time{},
		callTimeout: retryFor, pending: nil,
	}
	// A failure is not lost: the first tick reads again, and says so if it fails again.
	_, _ = r.read()

	return r
}

// read is the complete lines of the script. The first time it works, the lines that are there are taken as done; a missing script has none, and one that cannot be read is an error that says the baseline is unknown.
func (r *Runner) read() ([]string, error) {
	text, err := os.ReadFile(r.script)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		if !r.baselined {
			return nil, fmt.Errorf("the script cannot be read, so which of its lines are done is not known: %w", err)
		}

		return nil, err
	}
	lines := completeLines(string(text))
	if !r.baselined {
		r.executed, r.baselined = len(lines), true
	}

	return lines, nil
}

// Tick executes the lines that are new since the last tick, in order, until one of them has to wait for the next tick. The error is the script that cannot be read (an initialization failure while the baseline is unknown),
// the log that cannot be written (the outcome stays and is appended on the next tick, before anything runs), or the end of the context.
func (r *Runner) Tick(ctx context.Context) error {
	lines, err := r.read()
	if err != nil {
		return err
	}
	for {
		// What a line that was reported came to is told before anything else, and before the end of the context is honoured: the check waits for it.
		if err = r.flush(); err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if r.executed >= len(lines) {
			return nil
		}

		line := strings.TrimSuffix(lines[r.executed], "\r")
		err = r.runBounded(ctx, line)
		var permanent permanentError
		if err != nil && !errors.As(err, &permanent) {
			if ctx.Err() != nil {
				// The call was cut short by the end of the context: it says nothing about the host.
				return ctx.Err()
			}
			now := r.clock.Now()
			if r.failingSince.IsZero() {
				r.failingSince = now
			}
			if !giveUp(r.failingSince, now) {
				return nil
			}
		}

		r.failingSince = time.Time{}
		r.executed++
		r.pending = &outcome{n: r.executed, line: line, err: err}
	}
}

// runBounded is run with a deadline on the call of the reporter.
func (r *Runner) runBounded(ctx context.Context, line string) error {
	callCtx, cancel := context.WithTimeout(ctx, r.callTimeout)
	defer cancel()

	return r.run(callCtx, line)
}

// flush appends the pending outcome to the log. It is dropped when it is written, or when some of it was written and a second attempt would repeat that part; it stays when nothing was.
func (r *Runner) flush() error {
	if r.pending == nil {
		return nil
	}
	written, err := r.record(r.pending.n, r.pending.line, r.pending.err)
	if err == nil || written {
		r.pending = nil
	}

	return err
}

// Run ticks on every value of `ticks` until the context ends.
func (r *Runner) Run(ctx context.Context, ticks <-chan time.Time) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			// A script or a log that cannot be used has nowhere else to be told, and the next tick tries again.
			_ = r.Tick(ctx)
		}
	}
}

// record appends what came of line number n to the log; written says whether any of it reached the file.
func (r *Runner) record(n int, line string, err error) (bool, error) {
	text := fmt.Sprintf("ok %d %s\n", n, line)
	if err != nil {
		text = fmt.Sprintf("error %d %s\n", n, strings.NewReplacer("\r", " ", "\n", " ").Replace(err.Error()))
	}

	file, openErr := os.OpenFile(r.log, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if openErr != nil {
		return false, openErr
	}
	wrote, writeErr := file.WriteString(text)
	if writeErr != nil {
		return wrote > 0, errors.Join(writeErr, file.Close())
	}

	return true, file.Close()
}

// observedAt is the ObservedAt of the next report: now, and never not after the last one.
func (r *Runner) observedAt() string {
	now := r.clock.Now().UTC()
	if !now.After(r.observed) {
		now = r.observed.Add(time.Nanosecond)
	}
	r.observed = now

	return now.Format(time.RFC3339Nano)
}

// run executes one line: the error is the host's, or a permanentError.
func (r *Runner) run(ctx context.Context, line string) error {
	c, err := parse(line)
	if err != nil {
		return err
	}

	switch c.kind {
	case kindTaskBegin:
		return r.begin(ctx, c)
	case kindTaskStep:
		return r.step(ctx, c)
	case kindTaskFinish:
		return r.finish(ctx, c)
	case kindAlertFire:
		return r.fire(ctx, c)
	case kindAlertResolve:
		_, err = r.reporter.ResolveAlert(ctx, activity.ResolveAlertRequest{Key: c.key, ObservedAt: r.observedAt()})

		return err
	}

	return permanentf("unknown command: %q", line)
}

func (r *Runner) begin(ctx context.Context, c command) error {
	if _, found := r.tasks[c.name]; found {
		return permanentf("task %q is already begun", c.name)
	}
	record, err := r.reporter.BeginTask(ctx, activity.Spec{Presentation: presentation(c.title, "", progress(0, c.total)), Source: nil, Severity: "", ParentID: ""})
	if err != nil {
		return err
	}
	r.tasks[c.name] = task{id: record.ID, title: c.title, total: c.total}

	return nil
}

func (r *Runner) step(ctx context.Context, c command) error {
	t, found := r.tasks[c.name]
	if !found {
		return permanentf("unknown task %q", c.name)
	}
	if c.current > t.total {
		return permanentf("step %d is past the total %d", c.current, t.total)
	}
	_, err := r.reporter.ReportTask(ctx, activity.ReportTaskRequest{
		ID: t.id, Presentation: presentation(t.title, "", progress(c.current, t.total)), State: "running", ObservedAt: r.observedAt(),
	})

	return err
}

func (r *Runner) finish(ctx context.Context, c command) error {
	t, found := r.tasks[c.name]
	if !found {
		return permanentf("unknown task %q", c.name)
	}
	final := presentation(t.title, c.message, nil)
	if _, err := r.reporter.FinishTask(ctx, activity.FinishTaskRequest{ID: t.id, State: c.state, Presentation: &final}); err != nil {
		return err
	}
	delete(r.tasks, c.name)

	return nil
}

func (r *Runner) fire(ctx context.Context, c command) error {
	_, err := r.reporter.UpsertAlert(ctx, activity.AlertRequest{
		Spec: activity.Spec{
			Presentation: presentation(c.title, "", nil), Source: &activity.Source{PluginID: "", ConnectionID: c.connection, Resource: nil}, Severity: c.severity, ParentID: "",
		},
		Key: c.key, ObservedAt: r.observedAt(),
	})

	return err
}

func presentation(title, message string, progress *resourcev2.ActivityProgress) activity.Presentation {
	return activity.Presentation{Title: title, Message: message, Details: "", Progress: progress, Metrics: nil, Actions: nil}
}

// progress is "current of total items": the host wants the numbers as decimal text, and the current not past the total.
func progress(current, total uint64) *resourcev2.ActivityProgress {
	return &resourcev2.ActivityProgress{Kind: unitsKind, Message: "", Current: strconv.FormatUint(current, 10), Total: strconv.FormatUint(total, 10), Unit: itemsUnit, Label: ""}
}

// Start runs the script of the plugin this process belongs to, polled every 100 ms, until the returned function is called. The script is next to bin/, where the other control files of the fixtures are.
func Start(reporter Reporter) func() {
	executable, err := os.Executable()
	if err != nil {
		return func() {}
	}

	return start(filepath.Join(filepath.Dir(executable), ".."), reporter)
}

// start is Start for the script in `directory`: the stop function ends the polling and waits for the tick that is running.
func start(directory string, reporter Reporter) func() {
	runner := New(directory, reporter, wallClock{})
	ctx, cancel := context.WithCancel(context.Background())
	ticker := time.NewTicker(pollEvery)
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer ticker.Stop()
		runner.Run(ctx, ticker.C)
	}()

	return func() {
		cancel()
		<-done
	}
}
