//go:build !windows

package terminal

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/shellenv"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// recorder is a Sink that keeps what each session said, in order, and notes any output that
// arrives after the session's CLOSE.
type recorder struct {
	mu     sync.Mutex
	output map[string][]byte
	ends   map[string][]End
	late   map[string]int
}

func newRecorder() *recorder {
	return &recorder{mu: sync.Mutex{}, output: map[string][]byte{}, ends: map[string][]End{}, late: map[string]int{}}
}

func (r *recorder) Output(id string, data []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.ends[id]) > 0 {
		r.late[id]++
	}
	r.output[id] = append(r.output[id], data...)
}

func (r *recorder) Closed(id string, end End) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ends[id] = append(r.ends[id], end)
}

func (r *recorder) text(id string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return string(r.output[id])
}

func (r *recorder) closes(id string) []End {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]End(nil), r.ends[id]...)
}

func (r *recorder) afterClose(id string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.late[id]
}

// waitFor waits until what the session printed contains want, and returns everything it printed.
func (r *recorder) waitFor(t *testing.T, id, want string) string {
	t.Helper()
	require.Eventually(t, func() bool { return strings.Contains(r.text(id), want) }, 20*time.Second, 5*time.Millisecond,
		"session %s never printed %q; it printed %q", id, want, r.text(id))
	return r.text(id)
}

// waitEnd waits for the session's CLOSE and returns how it ended.
func (r *recorder) waitEnd(t *testing.T, id string) End {
	t.Helper()
	require.Eventually(t, func() bool { return len(r.closes(id)) > 0 }, 20*time.Second, 5*time.Millisecond,
		"session %s never closed; it printed %q", id, r.text(id))
	ends := r.closes(id)
	require.Len(t, ends, 1, "exactly one CLOSE for session %s", id)
	return ends[0]
}

// sh is the shell the tests start: every system the host runs on has it. Its login startup files are
// the tests' own: HOME is an empty directory.
func sh(t *testing.T) string {
	t.Helper()
	path, err := exec.LookPath("sh")
	require.NoError(t, err)
	return path
}

func newTestManager(t *testing.T) (*Manager, *recorder) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	rec := newRecorder()
	m := NewManager(ctx, logging.NewNop(), rec)
	t.Cleanup(func() {
		for _, s := range m.running() {
			_ = m.CloseSession(s)
		}
		cancel()
	})
	return m, rec
}

func (m *Manager) running() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	return ids
}

func (m *Manager) session(t *testing.T, id string) *session {
	t.Helper()
	m.mu.RLock()
	defer m.mu.RUnlock()
	s := m.sessions[id]
	require.NotNil(t, s, "no session %s", id)
	return s
}

// run starts the shell with a script for it to run (`sh -i -l -c script`).
func (m *Manager) run(t *testing.T, script string, opts Options) Session {
	t.Helper()
	opts.Command = []string{sh(t), "-c", script}
	info, err := m.Start(opts, nil)
	require.NoError(t, err)
	return info
}

func appErr(t *testing.T, err error) *apperror.AppError {
	t.Helper()
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	return app
}

func gone(pid int) bool {
	return errors.Is(syscall.Kill(pid, 0), syscall.ESRCH)
}

func requireGone(t *testing.T, pid int, what string) {
	t.Helper()
	require.Eventually(t, func() bool { return gone(pid) }, 10*time.Second, 5*time.Millisecond, "%s (pid %d) is still alive", what, pid)
}

var sizeLine = regexp.MustCompile(`(?m)^(\d+) (\d+)\r?$`)

// 1. INITIAL SIZE.

// A shell whose first act is `stty size` reports the size the caller asked for: the pty had it before
// the shell started.
func TestShellStartsAtTheRequestedSize(t *testing.T) {
	m, rec := newTestManager(t)
	info := m.run(t, "stty size", Options{Cols: 117, Rows: 33})
	assert.Equal(t, 117, info.Cols)
	assert.Equal(t, 33, info.Rows)
	text := rec.waitFor(t, info.ID, "33 117")
	assert.Regexp(t, sizeLine, text)
	assert.Equal(t, "33", sizeLine.FindStringSubmatch(text)[1])
	assert.Equal(t, "117", sizeLine.FindStringSubmatch(text)[2])
}

func TestShellStartsAtTheDefaultSizeWhenNoneIsGiven(t *testing.T) {
	m, rec := newTestManager(t)
	info := m.run(t, "stty size", Options{})
	assert.Equal(t, DefaultCols, info.Cols, "the answer states the size that was applied")
	assert.Equal(t, DefaultRows, info.Rows)
	rec.waitFor(t, info.ID, fmt.Sprintf("%d %d", DefaultRows, DefaultCols))
	one := m.run(t, "stty size", Options{Cols: 100})
	assert.Equal(t, 100, one.Cols)
	assert.Equal(t, DefaultRows, one.Rows, "a dimension that is not given takes its own default")
	rec.waitFor(t, one.ID, fmt.Sprintf("%d 100", DefaultRows))
}

func TestStartRefusesAnAbsurdSizeBeforeAnythingStarts(t *testing.T) {
	m, _ := newTestManager(t)
	before := openDescriptors(t)
	for name, tc := range map[string]struct {
		opts  Options
		field string
	}{
		"too many columns": {Options{Cols: MaxDimension + 1}, "cols"},
		"too many rows":    {Options{Rows: 65535}, "rows"},
		"negative columns": {Options{Cols: -1}, "cols"},
		"negative rows":    {Options{Rows: -80}, "rows"},
	} {
		_, err := m.Start(Options{Command: []string{sh(t)}, Cols: tc.opts.Cols, Rows: tc.opts.Rows}, nil)
		require.ErrorIs(t, err, ErrInvalid, name)
		app := appErr(t, err)
		assert.Equal(t, apperror.TypeValidation, app.Type, name)
		assert.Equal(t, "INVALID_REQUEST", app.Code, name)
		assert.Contains(t, app.Detail, tc.field, name+": the detail names the field")
	}
	assert.Empty(t, m.ListSessions(), "a refused size starts nothing")
	assert.Equal(t, before, openDescriptors(t), "a refused size leaks no descriptor")
	_, err := m.Start(Options{Command: []string{sh(t)}, Cols: MaxDimension, Rows: MaxDimension}, nil)
	require.NoError(t, err, "the largest size is a size")
}

func TestResizeAppliesInOrderAndRefusesWhatIsNotASize(t *testing.T) {
	m, rec := newTestManager(t)
	info, err := m.Start(Options{Command: []string{sh(t)}, Cols: 80, Rows: 24}, nil)
	require.NoError(t, err)
	require.NoError(t, m.Write(info.ID, 0, []byte("echo ready-$((1000+12))\n")))
	rec.waitFor(t, info.ID, "ready-1012")
	require.NoError(t, m.Resize(info.ID, 0, 33, 117))
	require.NoError(t, m.Write(info.ID, 0, []byte("stty size\n")))
	rec.waitFor(t, info.ID, "\n33 117")
	for _, bad := range [][2]int{{0, 80}, {24, 0}, {-1, 80}, {MaxDimension + 1, 80}, {24, MaxDimension + 1}} {
		resizeErr := m.Resize(info.ID, 0, bad[0], bad[1])
		require.ErrorIs(t, resizeErr, ErrInvalid, "rows %d cols %d", bad[0], bad[1])
	}
	require.NoError(t, m.Write(info.ID, 0, []byte("stty size\n")))
	require.Eventually(t, func() bool { return strings.Count(rec.text(info.ID), "\n33 117") >= 2 }, 20*time.Second, 5*time.Millisecond,
		"a refused resize leaves the size as it was")
}

func openDescriptors(t *testing.T) int {
	t.Helper()
	entries, err := os.ReadDir("/dev/fd")
	require.NoError(t, err)
	return len(entries)
}

// 2. HOW A SESSION ENDED.

func TestExitedWithACodeIsTypedAndFollowsTheLastOutput(t *testing.T) {
	m, rec := newTestManager(t)
	info := m.run(t, "echo goodbye-$((1000+3)); exit 3", Options{})
	end := rec.waitEnd(t, info.ID)
	assert.Equal(t, EndExited, end.Reason)
	require.NotNil(t, end.ExitCode)
	assert.Equal(t, 3, *end.ExitCode)
	assert.Empty(t, end.Signal)
	assert.Nil(t, end.Failure)
	assert.Contains(t, rec.text(info.ID), "goodbye-1003", "the output is delivered before the end")
	assert.Zero(t, rec.afterClose(info.ID))
	requireGone(t, info.PID, "the shell")
}

func TestExitedWithCodeZeroStatesZero(t *testing.T) {
	m, rec := newTestManager(t)
	info := m.run(t, "exit 0", Options{})
	end := rec.waitEnd(t, info.ID)
	assert.Equal(t, EndExited, end.Reason)
	require.NotNil(t, end.ExitCode, "zero is a status: the field is there")
	assert.Equal(t, 0, *end.ExitCode)
}

// Interactive shells ignore SIGTERM and SIGQUIT, so these end by the signals they do not ignore, or by
// the process the shell became: `exec` replaces the shell with a program that is killed from outside.
func TestKilledBySignalsIsTypedWithNameAndNumber(t *testing.T) {
	for _, tc := range []struct {
		name   string
		script string
		from   func(pid int) error
		signal string
		number syscall.Signal
	}{
		{"kill -KILL $$ in the shell", "kill -KILL $$; sleep 5", func(int) error { return nil }, "SIGKILL", syscall.SIGKILL},
		{"kill -HUP $$ in the shell", "kill -HUP $$; sleep 5", func(int) error { return nil }, "SIGHUP", syscall.SIGHUP},
		{"SIGTERM from outside", "echo up-$((1000+4)); exec sleep 300", func(pid int) error { return syscall.Kill(pid, syscall.SIGTERM) }, "SIGTERM", syscall.SIGTERM},
		{"SIGKILL from outside", "echo up-$((1000+4)); exec sleep 300", func(pid int) error { return syscall.Kill(pid, syscall.SIGKILL) }, "SIGKILL", syscall.SIGKILL},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, rec := newTestManager(t)
			info := m.run(t, tc.script, Options{})
			if strings.Contains(tc.script, "exec sleep") {
				rec.waitFor(t, info.ID, "up-1004")
				time.Sleep(100 * time.Millisecond) // the exec has happened once the echo before it is out and the shell is in sleep
			}
			require.NoError(t, tc.from(info.PID))
			end := rec.waitEnd(t, info.ID)
			assert.Equal(t, EndSignaled, end.Reason)
			assert.Equal(t, tc.signal, end.Signal)
			assert.Equal(t, int(tc.number), end.SignalNumber)
			assert.Nil(t, end.ExitCode, "a process that was killed has no exit code")
			assert.Zero(t, rec.afterClose(info.ID))
			requireGone(t, info.PID, "the shell")
		})
	}
}

// What a close of the session by its caller did, and nothing else, is what it says.
func TestClosedByCloseSessionIsTypedAndNothingFollowsTheCall(t *testing.T) {
	m, rec := newTestManager(t)
	info := m.run(t, "yes flood-$((1000+5))", Options{})
	rec.waitFor(t, info.ID, "flood-1005")
	require.NoError(t, m.CloseSession(info.ID))
	ends := rec.closes(info.ID)
	require.Len(t, ends, 1, "the CLOSE has been delivered when the call returns")
	assert.Equal(t, EndClosed, ends[0].Reason)
	assert.Equal(t, ClosedByRequest, ends[0].ClosedBy)
	assert.Nil(t, ends[0].ExitCode)
	requireGone(t, info.PID, "the shell")
	delivered := len(rec.text(info.ID))
	time.Sleep(300 * time.Millisecond)
	assert.Len(t, rec.text(info.ID), delivered, "no output follows the call, even from a flood")
	assert.Zero(t, rec.afterClose(info.ID))
	assert.Len(t, rec.closes(info.ID), 1, "one CLOSE only")
	err := m.CloseSession(info.ID)
	require.Error(t, err)
	assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, err).Type, "a closed session is not found")
	assert.Empty(t, m.ListSessions())
}

// A session that is closed is not "exited" however it died: the host's request is what ended it.
func TestClosedByTheWindowIsTypedAndEndsEveryShellOfTheOwnerOnly(t *testing.T) {
	m, rec := newTestManager(t)
	var mine, theirs []Session
	for range 3 {
		info, err := m.Start(Options{Command: []string{sh(t)}}, "window-1")
		require.NoError(t, err)
		mine = append(mine, info)
	}
	for range 2 {
		info, err := m.Start(Options{Command: []string{sh(t)}}, "window-2")
		require.NoError(t, err)
		theirs = append(theirs, info)
	}
	free, err := m.Start(Options{Command: []string{sh(t)}}, nil)
	require.NoError(t, err)

	assert.Equal(t, 3, m.CloseOwned("window-1", ClosedByWindow))
	for _, info := range mine {
		ends := rec.closes(info.ID)
		require.Len(t, ends, 1, "delivered when CloseOwned returns")
		assert.Equal(t, EndClosed, ends[0].Reason)
		assert.Equal(t, ClosedByWindow, ends[0].ClosedBy)
		requireGone(t, info.PID, "a shell of the retired window")
	}
	assert.Len(t, m.ListSessions(), 3, "the other window's shells and the unowned one are still there")
	for _, info := range append(theirs, free) {
		assert.False(t, gone(info.PID))
		assert.Empty(t, rec.closes(info.ID))
	}
	assert.Zero(t, m.CloseOwned("window-1", ClosedByWindow), "ending a window's shells twice ends none twice")
	assert.Zero(t, m.CloseOwned(nil, ClosedByWindow), "no owner is no owner")
}

// The pty is the session's: when it fails under a shell that is still running, the session says it
// failed and the shell does not outlive it.
func TestAFailedPtyIsTypedAndTheShellIsEnded(t *testing.T) {
	m, rec := newTestManager(t)
	info, err := m.Start(Options{Command: []string{sh(t)}}, nil)
	require.NoError(t, err)
	require.NoError(t, m.Write(info.ID, 0, []byte("echo ready-$((1000+13))\n")))
	rec.waitFor(t, info.ID, "ready-1013")
	require.NoError(t, m.session(t, info.ID).master.Close(), "something closes the pty under the session")
	end := rec.waitEnd(t, info.ID)
	assert.Equal(t, EndFailed, end.Reason)
	require.NotNil(t, end.Failure)
	assert.Equal(t, StageRead, end.Failure.Stage)
	assert.NotEmpty(t, end.Failure.Message)
	assert.Nil(t, end.ExitCode)
	requireGone(t, info.PID, "the shell of a failed pty")
}

// The shell binary is missing: nothing starts, the caller is told in typed words, and nothing is left behind.
func TestAMissingShellIsRefusedTypedAndLeavesNothing(t *testing.T) {
	m, _ := newTestManager(t)
	before := openDescriptors(t)
	// A machine where no shell of the stated order exists: the refusal names the path that was asked for.
	m.resolve = func(command []string) (string, []string, error) {
		return "", nil, fmt.Errorf("%w: tried the shell asked for %q: not found; $SHELL \"/x/fish\": not found", shellenv.ErrUnavailable, command[0])
	}
	_, err := m.Start(Options{Command: []string{"/nonexistent/bin/zsh"}}, nil)
	require.ErrorIs(t, err, shellenv.ErrUnavailable)
	app := appErr(t, err)
	assert.Equal(t, TypeShellUnavailable, app.Type)
	assert.Equal(t, "SHELL_UNAVAILABLE", app.Code)
	assert.Equal(t, 422, app.Status)
	assert.Contains(t, app.Detail, "/nonexistent/bin/zsh", "the refusal names the path it tried")
	m.resolve = shellenv.Resolve

	_, err = m.Start(Options{Command: []string{"/bin/cat"}}, nil)
	require.ErrorIs(t, err, shellenv.ErrUnsupported)
	assert.Equal(t, TypeShellUnsupported, appErr(t, err).Type)
	assert.Equal(t, "SHELL_UNSUPPORTED", appErr(t, err).Code)

	assert.Empty(t, m.ListSessions())
	assert.Equal(t, before, openDescriptors(t), "a shell that does not start leaks no pty")
	m.mu.RLock()
	assert.Empty(t, m.starting, "its id is not held")
	m.mu.RUnlock()
}

// What the shell wrote before it exited is all delivered, then the CLOSE, then nothing: not once in 25.
func TestTheLastOutputIsDeliveredBeforeTheCloseWhateverTheShellDoes(t *testing.T) {
	m, rec := newTestManager(t)
	for i := range 25 {
		info := m.run(t, "i=0; while [ $i -lt 400 ]; do echo line-$i; i=$((i+1)); done; echo tail-end; exit 4", Options{})
		end := rec.waitEnd(t, info.ID)
		require.NotNil(t, end.ExitCode, "run %d", i)
		assert.Equal(t, 4, *end.ExitCode)
		assert.Contains(t, rec.text(info.ID), "line-399\r\ntail-end\r\n", "run %d lost the tail of its output", i)
		assert.Zero(t, rec.afterClose(info.ID), "run %d delivered output after its CLOSE", i)
	}
}

// 3. WHAT HOLDS THE TERMINAL.

func busyState(m *Manager, id string) Foreground {
	got, err := m.Busy(id)
	if err != nil {
		return Foreground{State: "error", Name: err.Error(), PGID: 0, Reason: ""}
	}
	return got
}

func TestForegroundIsIdleForAShellAtItsPromptBusyForAProgramAndNotBusyForABackgroundJob(t *testing.T) {
	m, rec := newTestManager(t)
	info, err := m.Start(Options{Command: []string{sh(t)}}, nil)
	require.NoError(t, err)
	require.NoError(t, m.Write(info.ID, 0, []byte("echo ready-$((1000+6))\n")))
	rec.waitFor(t, info.ID, "ready-1006")
	assert.Equal(t, StateIdle, busyState(m, info.ID).State, "a shell at its prompt")

	require.NoError(t, m.Write(info.ID, 0, []byte("sleep 59\n")))
	require.Eventually(t, func() bool { return busyState(m, info.ID).State == StateBusy }, 10*time.Second, 10*time.Millisecond,
		"the program in the foreground")
	got := busyState(m, info.ID)
	assert.Equal(t, "sleep", got.Name, "the platform names the foreground program")
	assert.Positive(t, got.PGID)
	assert.NotEqual(t, info.PID, got.PGID, "the foreground group is not the shell's")
	assert.Empty(t, got.Reason)

	require.NoError(t, m.Write(info.ID, 0, []byte{3})) // ^C ends it
	require.Eventually(t, func() bool { return busyState(m, info.ID).State == StateIdle }, 10*time.Second, 10*time.Millisecond,
		"the shell has the terminal back")

	require.NoError(t, m.Write(info.ID, 0, []byte("sleep 58 & echo bg-$!\n")))
	// The typed command contains "bg-$!": only the shell's own output is "bg-" and a number.
	bgPid := regexp.MustCompile(`bg-(\d+)`)
	require.Eventually(t, func() bool { return bgPid.MatchString(rec.text(info.ID)) }, 20*time.Second, 5*time.Millisecond)
	background, err := strconv.Atoi(bgPid.FindStringSubmatch(rec.text(info.ID))[1])
	require.NoError(t, err)
	t.Cleanup(func() { _ = syscall.Kill(background, syscall.SIGKILL) }) // it outlives its shell: stop it by its pid
	for range 10 {
		assert.Equal(t, StateIdle, busyState(m, info.ID).State, "a background job does not hold the terminal")
		time.Sleep(20 * time.Millisecond)
	}
}

func TestForegroundOfASessionThatIsGoneIsNotFound(t *testing.T) {
	m, rec := newTestManager(t)
	info := m.run(t, "exit 0", Options{})
	rec.waitEnd(t, info.ID)
	_, err := m.Busy(info.ID)
	require.Error(t, err)
	assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, err).Type)
}

func TestForegroundStatesAreDistinctAndAPlatformThatCannotTellSaysUnknown(t *testing.T) {
	assert.Equal(t, Foreground{State: StateIdle, Name: "", PGID: 0, Reason: ""}, foregroundOf(100, 100))
	assert.Equal(t, StateBusy, foregroundOf(100, 200).State)
	assert.Equal(t, 200, foregroundOf(100, 200).PGID)
	unknown := UnknownForeground(ReasonQueryFailed)
	assert.Equal(t, StateUnknown, unknown.State)
	assert.Equal(t, ReasonQueryFailed, unknown.Reason)
	assert.NotEqual(t, StateIdle, unknown.State, "unknown is not a guess of idle")
	assert.NotEqual(t, StateBusy, unknown.State, "unknown is not a guess of busy")
}

// 4. WHICH SHELL, WHERE.

func TestTheAnswerNamesTheShellAndTheDirectoryItStartedIn(t *testing.T) {
	m, rec := newTestManager(t)
	shell := sh(t)
	home := os.Getenv("HOME")
	info := m.run(t, "pwd; echo shell-$((1000+7))", Options{})
	assert.Equal(t, shell, info.Shell.Path, "the resolved executable")
	target, err := filepath.EvalSymlinks(shell)
	require.NoError(t, err)
	assert.Equal(t, filepath.Base(target), info.Shell.Name, "the shell's own name, not the name of a link to it")
	assert.Equal(t, home, info.Cwd)
	assert.Positive(t, info.PID)
	assert.False(t, gone(info.PID))
	assert.Equal(t, defaultLimits(), info.Limits)
	assert.False(t, info.CreatedAt.IsZero())
	text := rec.waitFor(t, info.ID, "shell-1007")
	assert.Contains(t, strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n"), home, "the shell is in the directory the answer says")
}

func TestTheShellNameIsTheTargetOfALinkAndTheLoginShellIsNamedWhenNoCommandIsGiven(t *testing.T) {
	m, _ := newTestManager(t)
	link := filepath.Join(t.TempDir(), "my-favourite-shell")
	require.NoError(t, os.Symlink(sh(t), link))
	info, err := m.Start(Options{Command: []string{link}}, nil)
	require.NoError(t, err)
	assert.Equal(t, link, info.Shell.Path, "the path is the executable the caller named")
	target, err := filepath.EvalSymlinks(sh(t))
	require.NoError(t, err)
	assert.Equal(t, filepath.Base(target), info.Shell.Name)

	t.Setenv("SHELL", sh(t))
	login, err := m.Start(Options{}, nil)
	require.NoError(t, err)
	assert.Equal(t, sh(t), login.Shell.Path, "the account's login shell when no command is given")
}

func TestASessionIdInUseIsRefusedAndTheFirstShellIsKept(t *testing.T) {
	m, rec := newTestManager(t)
	first, err := m.Start(Options{ID: "chosen-by-the-caller", Command: []string{sh(t)}}, nil)
	require.NoError(t, err)
	assert.Equal(t, "chosen-by-the-caller", first.ID)
	_, err = m.Start(Options{ID: "chosen-by-the-caller", Command: []string{sh(t)}}, nil)
	require.ErrorIs(t, err, ErrIDInUse)
	assert.Equal(t, "ALREADY_EXISTS", appErr(t, err).Code)
	assert.False(t, gone(first.PID), "the first shell is not orphaned by the second start")
	assert.Len(t, m.ListSessions(), 1)
	require.NoError(t, m.CloseSession(first.ID))
	assert.Len(t, rec.closes(first.ID), 1)
	_, err = m.Start(Options{ID: "chosen-by-the-caller", Command: []string{sh(t)}}, nil)
	require.NoError(t, err, "the id is free once the session is gone")

	_, err = m.Start(Options{ID: strings.Repeat("x", maxIDLength+1), Command: []string{sh(t)}}, nil)
	require.ErrorIs(t, err, ErrInvalid)
	_, err = m.Start(Options{Command: []string{sh(t)}}, []string{"not", "comparable"})
	require.ErrorIs(t, err, ErrInvalid)
}

func TestListGetAttachAndDetachKeepTheirMeaning(t *testing.T) {
	m, rec := newTestManager(t)
	info := m.run(t, "echo history-$((1000+8)); sleep 60", Options{})
	rec.waitFor(t, info.ID, "history-1008")
	listed := m.ListSessions()
	require.Len(t, listed, 1)
	assert.Equal(t, info.ID, listed[0].ID)
	assert.False(t, listed[0].Attached)
	got, err := m.GetSession(info.ID)
	require.NoError(t, err)
	assert.Equal(t, info.ID, got.ID)
	attached, buffer, err := m.AttachSession(info.ID)
	require.NoError(t, err)
	assert.True(t, attached.Attached)
	assert.Contains(t, string(buffer), "history-1008", "attach returns what the session printed so far")
	detached, err := m.DetachSession(info.ID)
	require.NoError(t, err)
	assert.False(t, detached.Attached)
}

// 5. ORDER AND BOUND, ON A REAL PTY.

// 1,000 writes and resizes from 16 callers at once, numbered: the shell reads every line in the order
// the lines were numbered and the pty ends at the size of the last resize.
func TestInputAndResizeReachTheShellInTheOrderTheyWereNumbered(t *testing.T) {
	const total = 1000
	m, rec := newTestManager(t)
	info := m.run(t, "stty -echo; cat", Options{Cols: 80, Rows: 24})
	rec.waitFor(t, info.ID, "")
	time.Sleep(200 * time.Millisecond) // stty -echo has run once cat answers
	var next int
	var mu sync.Mutex
	var wg sync.WaitGroup
	lastRows, lastCols := 0, 0
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				mu.Lock()
				next++
				seq := next
				mu.Unlock()
				if seq > total {
					return
				}
				var err error
				if seq%2 == 0 {
					err = m.Write(info.ID, uint64(seq), []byte(fmt.Sprintf("n%04d\n", seq)))
				} else {
					rows, cols := 10+seq%90, 20+seq%180
					err = m.Resize(info.ID, uint64(seq), rows, cols)
					if seq == total-1 {
						lastRows, lastCols = rows, cols
					}
				}
				assert.NoError(t, err, "operation %d", seq)
			}
		}()
	}
	wg.Wait()
	rec.waitFor(t, info.ID, fmt.Sprintf("n%04d", total))
	lines := strings.Fields(rec.text(info.ID))
	want := make([]string, 0, total/2)
	for seq := 2; seq <= total; seq += 2 {
		want = append(want, fmt.Sprintf("n%04d", seq))
	}
	assert.Equal(t, want, lines, "the lines came in the order they were numbered")

	var winsize *unix.Winsize
	require.NoError(t, control(m.session(t, info.ID).master, func(fd int) error {
		var err error
		winsize, err = unix.IoctlGetWinsize(fd, unix.TIOCGWINSZ)
		return err
	}))
	assert.Equal(t, lastRows, int(winsize.Row), "the pty has the size of the last resize that was sent")
	assert.Equal(t, lastCols, int(winsize.Col))
}

// A shell that does not read stalls its own session's input and nothing else: another session answers,
// a third starts, a fourth closes, and the stalled session itself closes and lets its writer go.
func TestASessionWhoseShellDoesNotReadDoesNotBlockAnother(t *testing.T) {
	m, rec := newTestManager(t)
	stuck := m.run(t, "stty raw -echo; echo up-$((1000+9)); sleep 600", Options{})
	rec.waitFor(t, stuck.ID, "up-1009")
	flood := make([]byte, 16<<20)
	blocked := make(chan error, 1)
	go func() { blocked <- m.Write(stuck.ID, 0, flood) }()
	select {
	case err := <-blocked:
		require.FailNow(t, "a 16 MiB write into a shell that does not read cannot complete", "%v", err)
	case <-time.After(500 * time.Millisecond):
	}

	other, err := m.Start(Options{Command: []string{sh(t)}}, nil)
	require.NoError(t, err, "a start is not blocked by another session's stalled write")
	require.NoError(t, m.Write(other.ID, 0, []byte("echo alive-$((1000+10))\n")))
	rec.waitFor(t, other.ID, "alive-1010")
	require.NoError(t, m.Resize(other.ID, 0, 30, 100))
	require.NoError(t, m.CloseSession(other.ID), "a close is not blocked by another session's stalled write")

	stopped := m.session(t, stuck.ID).queue.stopped
	require.NoError(t, m.CloseSession(stuck.ID), "the stalled session closes")
	select {
	case writeErr := <-blocked:
		require.Error(t, writeErr, "its writer is answered when the session ends, not left waiting")
	case <-time.After(10 * time.Second):
		require.FailNow(t, "the writer of a closed session was never answered")
	}
	select {
	case <-stopped:
	case <-time.After(10 * time.Second):
		require.FailNow(t, "the input goroutine of a closed session did not stop: its write is still blocked in the kernel")
	}
	requireGone(t, stuck.PID, "the stalled shell")
}

// Flooding a session whose shell does not read is answered with a typed refusal, not silence.
func TestFloodingASessionIsRefusedTypedWhileTheShellDoesNotRead(t *testing.T) {
	m, rec := newTestManager(t)
	stuck := m.run(t, "stty raw -echo; echo up-$((1000+11)); sleep 600", Options{})
	rec.waitFor(t, stuck.ID, "up-1011")
	big := make([]byte, 16<<20)
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = m.Write(stuck.ID, 0, big)
		}()
	}
	// The first write blocks inside the pty; the others wait behind it until the bytes bound is met.
	require.Eventually(t, func() bool {
		err := m.Write(stuck.ID, 0, []byte("x"))
		return errors.Is(err, ErrInputBacklog)
	}, 10*time.Second, 10*time.Millisecond, "a flood must be refused once the session holds as much as it may")
	err := m.Write(stuck.ID, 0, []byte("x"))
	require.ErrorIs(t, err, ErrInputBacklog)
	assert.Equal(t, "INPUT_BACKLOG", appErr(t, err).Code)
	require.NoError(t, m.CloseSession(stuck.ID))
	wg.Wait()
}
