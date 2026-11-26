//go:build !windows

package terminal

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/version"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// chunkSink is a Sink that keeps the events of each session as the host cut them, so that a test can see
// where a multi-byte character was split, and that can answer an output with an acknowledgement.
type chunkSink struct {
	mu       sync.Mutex
	chunks   map[string][][]byte
	ends     map[string][]End
	onOutput func(sessionID string, n int)
}

func newChunkSink() *chunkSink {
	return &chunkSink{mu: sync.Mutex{}, chunks: map[string][][]byte{}, ends: map[string][]End{}, onOutput: nil}
}

func (c *chunkSink) Output(sessionID string, data []byte) {
	c.mu.Lock()
	c.chunks[sessionID] = append(c.chunks[sessionID], data)
	acknowledge := c.onOutput
	c.mu.Unlock()
	if acknowledge != nil {
		acknowledge(sessionID, len(data))
	}
}

func (c *chunkSink) Closed(sessionID string, end End) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ends[sessionID] = append(c.ends[sessionID], end)
}

func (c *chunkSink) parts(sessionID string) [][]byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([][]byte(nil), c.chunks[sessionID]...)
}

func (c *chunkSink) output(sessionID string) []byte { return bytes.Join(c.parts(sessionID), nil) }

func (c *chunkSink) waitFor(t *testing.T, sessionID, want string) {
	t.Helper()
	require.Eventually(t, func() bool { return bytes.Contains(c.output(sessionID), []byte(want)) }, 20*time.Second, 5*time.Millisecond,
		"session %s never printed %q", sessionID, want)
}

func (c *chunkSink) waitEnd(t *testing.T, sessionID string, within time.Duration) End {
	t.Helper()
	var ends []End
	require.Eventually(t, func() bool {
		c.mu.Lock()
		defer c.mu.Unlock()
		ends = append([]End(nil), c.ends[sessionID]...)
		return len(ends) > 0
	}, within, 10*time.Millisecond, "session %s never closed", sessionID)
	require.Len(t, ends, 1, "exactly one CLOSE for session %s", sessionID)
	return ends[0]
}

func newChunkManager(t *testing.T, sink Sink) *Manager {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	m := NewManager(ctx, logging.NewNop(), sink)
	t.Cleanup(func() {
		for _, id := range m.running() {
			_ = m.CloseSession(id)
		}
		cancel()
	})
	return m
}

func physical(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	require.NoError(t, err)
	return resolved
}

// ended reports whether a process is gone, or is only a zombie nobody has reaped: in a container whose
// first process does not reap, a killed grandchild stays one, and on a machine so busy that launchd is late
// to reap an orphan it does too; kill(pid, 0) finds a zombie.
func ended(pid int) bool {
	return gone(pid) || exitedUnreaped(pid)
}

func send(t *testing.T, m *Manager, id, line string) {
	t.Helper()
	require.NoError(t, m.Write(id, 0, []byte(line+"\n")))
}

// (a) The shell is the user's login shell: its startup files run, so the terminal's PATH is what a normal
// terminal gives, whatever environment the host itself was started with.
func TestTheShellIsALoginShellSoTheUsersStartupFilesRunWhateverEnvironmentTheHostHas(t *testing.T) {
	shell := sh(t)
	home := t.TempDir()
	startup := "PATH=\"/omniview-login-test/bin:$PATH\"\nexport PATH\nOMNIVIEW_LOGIN_MARK=profile-ran\nexport OMNIVIEW_LOGIN_MARK\n"
	require.NoError(t, os.WriteFile(filepath.Join(home, ".profile"), []byte(startup), 0o600))
	// An application started from the Dock or Finder gets from launchd nothing but HOME, USER, SHELL and a
	// minimal PATH.
	for _, key := range []string{"LANG", "LC_ALL", "LC_CTYPE", "TERM", "ENV", "BASH_ENV", "OMNIVIEW_LOGIN_MARK"} {
		t.Setenv(key, "")
	}
	t.Setenv("HOME", home)
	t.Setenv("USER", "omniview-test")
	t.Setenv("SHELL", shell)
	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
	sink := newChunkSink()
	m := newChunkManager(t, sink)

	info, err := m.Start(Options{Command: []string{shell, "-c", "echo path=$PATH; echo mark=$OMNIVIEW_LOGIN_MARK; echo home=$HOME"}}, nil)
	require.NoError(t, err)
	end := sink.waitEnd(t, info.ID, 20*time.Second)
	require.Equal(t, EndExited, end.Reason)
	out := string(sink.output(info.ID))
	assert.Regexp(t, `path=/omniview-login-test/bin:.*/usr/bin`, out, "the user's startup file ran, on top of the system's PATH")
	assert.Contains(t, out, "mark=profile-ran")
	assert.Contains(t, out, "home="+home)
}

// (b) The terminal states what it is to the programs in it.
func TestTheShellIsToldItRunsInOmniviewAndWhatItsTerminalCan(t *testing.T) {
	shell := sh(t)
	defaultLang := "C.UTF-8"
	if runtime.GOOS == "darwin" {
		defaultLang = "en_US.UTF-8"
	}
	cases := []struct {
		name  string
		env   map[string]string
		wants []string
	}{
		{"no locale set: UTF-8 is the default", map[string]string{"LANG": "", "LC_ALL": "", "LC_CTYPE": ""}, []string{"lang=" + defaultLang}},
		{"a LANG the user set stays", map[string]string{"LANG": "fr_FR.UTF-8", "LC_ALL": "", "LC_CTYPE": ""}, []string{"lang=fr_FR.UTF-8"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("HOME", t.TempDir())
			t.Setenv("TERM", "dumb")
			t.Setenv("COLORTERM", "")
			t.Setenv("TERM_PROGRAM", "Apple_Terminal")
			t.Setenv("TERM_PROGRAM_VERSION", "1")
			for key, value := range tc.env {
				t.Setenv(key, value)
			}
			sink := newChunkSink()
			m := newChunkManager(t, sink)
			script := "echo term=$TERM; echo colorterm=$COLORTERM; echo program=$TERM_PROGRAM; echo version=$TERM_PROGRAM_VERSION; echo shell=$SHELL; echo lang=$LANG; echo lc_all=$LC_ALL"
			info, err := m.Start(Options{Command: []string{shell, "-c", script}}, nil)
			require.NoError(t, err)
			require.Equal(t, EndExited, sink.waitEnd(t, info.ID, 20*time.Second).Reason)
			out := string(sink.output(info.ID))
			for _, want := range append([]string{
				"term=xterm-256color\r\n", "colorterm=truecolor\r\n", "program=Omniview\r\n", "version=" + version.Version + "\r\n", "shell=" + info.Shell.Path + "\r\n",
			}, tc.wants...) {
				assert.Contains(t, out, want)
			}
		})
	}
}

func TestTerminalEnvironmentKeepsTheHostsAndStatesTheEmulatorOnce(t *testing.T) {
	base := []string{"PATH=/a:/b", "TERM=dumb", "SHELL=/bin/csh", "TERM_PROGRAM=iTerm.app", "COLORTERM=", "LANG=", "HOME=/h"}
	got := terminalEnvironment(base, "/bin/zsh", "/work", "1.2.3")
	assert.Contains(t, got, "PATH=/a:/b")
	assert.Contains(t, got, "HOME=/h")
	for _, want := range []string{"TERM=xterm-256color", "COLORTERM=truecolor", "TERM_PROGRAM=Omniview", "TERM_PROGRAM_VERSION=1.2.3", "SHELL=/bin/zsh", "LANG=" + defaultLocale()} {
		assert.Contains(t, got, want)
	}
	for _, key := range []string{"TERM", "COLORTERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "SHELL"} {
		count := 0
		for _, entry := range got {
			if strings.HasPrefix(entry, key+"=") {
				count++
			}
		}
		assert.Equal(t, 1, count, "%s is stated once", key)
	}

	got = terminalEnvironment([]string{"LC_ALL=de_DE.UTF-8"}, "/bin/sh", "/work", "v")
	for _, entry := range got {
		assert.False(t, strings.HasPrefix(entry, "LANG="), "a locale the user set is not overridden: %s", entry)
	}
}

// (c) and (d) The caller says where the shell starts, and the host names the directory the shell is in now.
func TestTheShellStartsWhereTheCallerSaidAndTheHostNamesItsCurrentDirectory(t *testing.T) {
	shell := sh(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	work := t.TempDir()
	sub := filepath.Join(work, "sub dir")
	require.NoError(t, os.Mkdir(sub, 0o700))
	file := filepath.Join(work, "file")
	require.NoError(t, os.WriteFile(file, nil, 0o600))
	sink := newChunkSink()
	m := newChunkManager(t, sink)

	byDefault, err := m.Start(Options{Command: []string{shell}}, nil)
	require.NoError(t, err)
	assert.Equal(t, home, byDefault.Cwd, "the default is the user's home")
	dir, err := m.Cwd(byDefault.ID)
	require.NoError(t, err)
	assert.Equal(t, physical(t, home), physical(t, dir.Path))

	info, err := m.Start(Options{Command: []string{shell}, Cwd: work}, nil)
	require.NoError(t, err)
	assert.Equal(t, work, info.Cwd, "the answer states where the shell started")
	dir, err = m.Cwd(info.ID)
	require.NoError(t, err)
	assert.Empty(t, dir.Reason)
	assert.Equal(t, physical(t, work), physical(t, dir.Path), "the shell started where it was told to")

	// The shell moves and the fact follows: it is read when asked, nothing polls.
	send(t, m, info.ID, "cd 'sub dir'")
	wantSub := physical(t, sub)
	require.Eventually(t, func() bool {
		now, askErr := m.Cwd(info.ID)
		if askErr != nil || now.Path == "" {
			return false
		}
		resolved, resolveErr := filepath.EvalSymlinks(now.Path)
		return resolveErr == nil && resolved == wantSub
	}, 20*time.Second, 10*time.Millisecond, "the host names the directory the shell moved to")

	for name, cwd := range map[string]string{"relative": "some/where", "missing": filepath.Join(work, "missing"), "a file": file} {
		_, startErr := m.Start(Options{Command: []string{shell}, Cwd: cwd}, nil)
		require.ErrorIs(t, startErr, ErrInvalid, name)
		assert.Contains(t, appErr(t, startErr).Detail, "cwd", name)
	}
	_, err = m.Cwd("no-such-session")
	require.Error(t, err)
}

// (e) Closing a terminal hangs up first and kills only what ignored the hangup, after the grace.
func TestClosingHangsUpAtOnceAndKillsWhatIgnoresTheHangupOnlyAfterTheGrace(t *testing.T) {
	shell := sh(t)
	t.Setenv("HOME", t.TempDir())
	sink := newChunkSink()
	m := newChunkManager(t, sink)

	// The grace is a timer of the hangup, on the wall clock by design (clock.go). A test that handed it the real 1.5 s
	// and asserted that a close took less (or more) was decided by how fast the machine ran the shell. These pass a
	// grace that no test lives to see (an hour), so that what ends the shell is the hangup or nothing, and wait for
	// the event.
	t.Run("a shell at its prompt ends by the hangup alone", func(t *testing.T) {
		info, err := m.Start(Options{Command: []string{shell}}, nil)
		require.NoError(t, err)
		send(t, m, info.ID, "echo ready-$((40+2))")
		sink.waitFor(t, info.ID, "ready-42")
		s := m.session(t, info.ID)
		go s.hangup(time.Hour)
		select {
		case <-s.exited:
		case <-time.After(30 * time.Second):
			require.FailNow(t, "the hangup did not end a shell that does not ignore it, and no kill was due")
		}
		sink.waitEnd(t, info.ID, 20*time.Second)
		assert.True(t, gone(info.PID))
	})

	t.Run("a close ends a shell at its prompt, delivers one CLOSE and leaves nothing", func(t *testing.T) {
		info, err := m.Start(Options{Command: []string{shell}}, nil)
		require.NoError(t, err)
		send(t, m, info.ID, "echo ready-$((40+2))")
		sink.waitFor(t, info.ID, "ready-42")
		require.NoError(t, m.CloseSession(info.ID))
		assert.Empty(t, m.running(), "CloseSession returned with the session gone, not because closeWait passed")
		end := sink.waitEnd(t, info.ID, 20*time.Second)
		assert.Equal(t, EndClosed, end.Reason)
		assert.Equal(t, ClosedByRequest, end.ClosedBy)
		assert.True(t, gone(info.PID))
	})

	t.Run("a program that ignores the hangup lives until the grace and is killed by it", func(t *testing.T) {
		perl, lookErr := exec.LookPath("perl")
		if lookErr != nil {
			t.Skip("no perl on this machine: not run")
		}
		info, err := m.Start(Options{Command: []string{shell}}, nil)
		require.NoError(t, err)
		send(t, m, info.ID, "trap '' HUP")
		send(t, m, info.ID, "echo trapped-$((40+2))")
		sink.waitFor(t, info.ID, "trapped-42")
		// The program takes the hangup and says so: the signal having arrived is the event the survival is observed from.
		send(t, m, info.ID, perl+` -e '$|=1; $SIG{HUP}=sub{print "got-hup-",40+2,"\n"}; print "armed-",40+2,"\n"; sleep 1 while 1'`)
		sink.waitFor(t, info.ID, "armed-42")
		var foreground Foreground
		require.Eventually(t, func() bool {
			busy, busyErr := m.Busy(info.ID)
			if busyErr != nil || busy.State != StateBusy {
				return false
			}
			foreground = busy
			return true
		}, 20*time.Second, 10*time.Millisecond)

		// The hangup, and a grace that does not come: what ignores it lives. The wait for what the program printed
		// is for an event; the one after it, that nothing ended, can only get weaker on a busy machine.
		s := m.session(t, info.ID)
		go s.hangup(time.Hour)
		sink.waitFor(t, info.ID, "got-hup-42")
		select {
		case <-s.exited:
			require.FailNow(t, "what ignores the hangup ended before any grace was over")
		case <-time.After(300 * time.Millisecond):
		}
		assert.False(t, ended(foreground.PGID), "the program that ignored the hangup lives")

		// The close of the host: its grace passes (it is the only thing that can end this shell), and it kills.
		require.NoError(t, m.CloseSession(info.ID))
		assert.Empty(t, m.running(), "CloseSession returned with the session gone, not because closeWait passed")
		assert.Equal(t, EndClosed, sink.waitEnd(t, info.ID, 20*time.Second).Reason)
		assert.True(t, gone(info.PID))
		require.Eventually(t, func() bool { return ended(foreground.PGID) }, 10*time.Second, 20*time.Millisecond, "the program that ignored the hangup was killed")
	})
}

// A shell that hangs up its jobs when it is hung up, as bash and zsh do, takes its background jobs with it.
func TestClosingHangsUpTheBackgroundJobsOfABashShell(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("no bash on this machine")
	}
	t.Setenv("HOME", t.TempDir())
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	info, err := m.Start(Options{Command: []string{bash}}, nil)
	require.NoError(t, err)
	send(t, m, info.ID, "sleep 587 & echo job-$!")
	var job int
	require.Eventually(t, func() bool {
		found := regexp.MustCompile(`job-(\d+)`).FindSubmatch(sink.output(info.ID))
		if found == nil {
			return false
		}
		job, _ = strconv.Atoi(string(found[1]))
		return job > 0
	}, 20*time.Second, 10*time.Millisecond)
	t.Cleanup(func() { _ = syscall.Kill(job, syscall.SIGKILL) })
	require.False(t, gone(job))
	waitForTheJobToExec(t, job)
	waitForThePromptAfterTheJob(t, sink, info)
	require.NoError(t, m.CloseSession(info.ID))
	require.Eventually(t, func() bool { return ended(job) }, 10*time.Second, 20*time.Millisecond, "the background job was hung up with its shell")
}

// waitForTheJobToExec waits until the job (`sleep`) is the program and no longer a fork of its shell: a hangup that reaches it before is lost.
func waitForTheJobToExec(t *testing.T, job int) {
	t.Helper()
	became, known := waitForExec(job, "sleep", 20*time.Second)
	if !known {
		t.Log("NOT RUN: no /proc/<pid>/comm: the wait for the job to exec")
		return
	}
	require.True(t, became, "the job never became `sleep`")
}

// waitForThePromptAfterTheJob waits until the shell is at its prompt after the job's command: the prompt after it has been drawn,
// which the integration says with its second input-start mark (the first is the first prompt). With the integration bash runs its
// prompt commands as a non-interactive shell, which does not hang its jobs up, between the end of a command and the first hook that
// sets a handler (T5-inject-bash.md, the known gap: tens of microseconds, longer in wall time when the machine is busy); a test that
// closed the instant the job is named would fall into it by its own timing. A bash with no integration has no such window; one whose
// integration is `unconfirmed` (it was slow to start) has it.
func waitForThePromptAfterTheJob(t *testing.T, sink *chunkSink, info Session) {
	t.Helper()
	if info.Integration.State == IntegrationOn || info.Integration.State == IntegrationUnconfirmed {
		require.Eventually(t, func() bool { return bytes.Count(sink.output(info.ID), []byte("\x1b]133;B")) >= 2 },
			20*time.Second, 5*time.Millisecond, "the prompt after the job's command was never drawn")
	}
	// Whatever the integration says: a bash with none is in readline's redisplay after it has drawn its prompt too.
	waiting, known := waitingForInput(info.PID, 20*time.Second)
	if !known {
		t.Log("NOT RUN: this machine cannot say whether the shell waits for input (no /proc/<pid>/syscall or wchan): the close may land in readline's redisplay")
		return
	}
	require.True(t, waiting, "the shell never waited for input at its prompt")
}

// waitForExec waits until the process has become the program of that name (Linux, /proc/<pid>/comm): a shell's background job is a fork of the
// shell until its exec, and a hangup that reaches it there is lost (zsh's handler in the child queues the signal, and the exec drops it:
// seen with the job still named `zsh` when the hangup came, in 17 of 33 such runs on a busy machine, in none of 87 once it was `sleep`). It
// reports whether it became it, and whether the machine can tell.
func waitForExec(pid int, name string, within time.Duration) (bool, bool) {
	path := "/proc/" + strconv.Itoa(pid) + "/comm"
	if _, err := os.Stat("/proc/self/comm"); err != nil {
		return false, false
	}
	deadline := time.Now().Add(within)
	for {
		if data, err := os.ReadFile(path); err == nil && strings.TrimSpace(string(data)) == name {
			return true, true
		}
		if time.Now().After(deadline) {
			return false, true
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func TestWaitForExecWaitsUntilTheProcessIsTheProgram(t *testing.T) {
	if _, err := os.Stat("/proc/self/comm"); err != nil {
		t.Skip("NOT RUN: no /proc/<pid>/comm on this machine")
	}
	cmd := exec.Command("sh", "-c", "sleep 0.4; exec sleep 30")
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	became, known := waitForExec(cmd.Process.Pid, "sleep", 10*time.Second)
	assert.True(t, known)
	assert.True(t, became)
	comm, err := os.ReadFile("/proc/" + strconv.Itoa(cmd.Process.Pid) + "/comm")
	require.NoError(t, err)
	assert.Equal(t, "sleep", strings.TrimSpace(string(comm)), "it returned when the exec was done, not before")
	became, _ = waitForExec(cmd.Process.Pid, "cat", 200*time.Millisecond)
	assert.False(t, became, "it is not another program")
}

// waitingForInput waits until the process is blocked in a system call that waits for input to be readable (Linux: a `read`, or the
// `select` or `poll` that a shell makes while it waits for a key). That is a shell that has drawn its
// prompt and done what it does around it: before it, bash is still in readline's redisplay (state R) and a hangup that lands there does
// not hang its jobs up (with or without the integration: seen on plain bash). It is the event itself, so one observation is enough. A
// process asleep for another reason (a `wait4` for a hook's fork, a `write` to a full pty, a `nanosleep`) is not it. It reports whether
// the process was seen waiting, and whether the machine can tell (`/proc/<pid>/syscall`, or `wchan`).
func waitingForInput(pid int, within time.Duration) (bool, bool) {
	deadline := time.Now().Add(within)
	for {
		seen, tell := waitsForInputNow(pid)
		if !tell {
			return false, false
		}
		if seen {
			return true, true
		}
		if time.Now().After(deadline) {
			return false, true
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// Limits (outside CI, which is ubuntu amd64): the wchan fallback matches `wait_woken`, which a `write` blocked on a full pty is in too, and
// a 32-bit bash on an amd64 kernel makes its system calls with the i386 numbers, which the table does not have.
//
// waitsForInputNow looks once. /proc/<pid>/syscall gives the system call the process is in: one that waits for input to be readable (`read`,
// `select`, `pselect6`, `poll`, `ppoll`: bash waits in a `select` of its terminal, zsh in a `read` of its own descriptor for it, fish in a
// `poll`). A `wait4` for a hook's fork, a `write` to a full pty and a `nanosleep` are other calls. Where the numbers are not known (an
// architecture this table lacks) the kernel's name for where the process sleeps, wchan, is read instead.
func waitsForInputNow(pid int) (bool, bool) {
	if waiting, known := syscallWaitsForInput(pid); known {
		return waiting, true
	}
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/wchan")
	if err != nil {
		return false, false
	}
	return wchanWaitsForInput(strings.TrimSpace(string(data))), true
}

// wchanWaitsForInput says whether the kernel function a process sleeps in (wchan) is one that waits for input to be readable: a tty
// read, a select or poll, a read of an empty pipe. Not a pipe write, a wait for a child, or a sleep.
func wchanWaitsForInput(name string) bool {
	for _, waits := range []string{"n_tty_read", "do_select", "do_sys_poll", "poll_schedule_timeout", "wait_woken"} {
		if strings.Contains(name, waits) {
			return true
		}
	}
	return false
}

func TestTheWchanThatWaitsForInputIsAReadAndNotAWriteOrAChildOrASleep(t *testing.T) {
	for name, want := range map[string]bool{
		"n_tty_read": true, "do_select": true, "do_sys_poll": true, "poll_schedule_timeout.constprop.0": true, "wait_woken": true,
		"pipe_read": false, "pipe_write": false, "do_wait": false, "hrtimer_nanosleep": false, "0": false, "": false,
	} {
		assert.Equal(t, want, wchanWaitsForInput(name), name)
	}
}

// syscallWaitsForInput reads /proc/<pid>/syscall: the number of the system call the process is in, or `running`. It does not know the
// numbers of every architecture (then it says it cannot tell).
func syscallWaitsForInput(pid int) (bool, bool) {
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/syscall")
	if err != nil {
		return false, false
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return false, false
	}
	if fields[0] == "running" {
		return false, true
	}
	number, err := strconv.Atoi(fields[0])
	if err != nil || number < 0 {
		return false, false
	}
	var read int
	var selects []int
	switch runtime.GOARCH {
	case "amd64":
		read, selects = 0, []int{7, 23, 270, 271}
	case "arm64":
		read, selects = 63, []int{72, 73}
	default:
		return false, false
	}
	if slices.Contains(selects, number) {
		return true, true // select and poll take pointers: the number is all there is to check
	}
	if number != read || len(fields) < 2 {
		return false, true
	}
	// A read waits for input when it reads the terminal; a shell blocked in a hook's `$(…)` reads a pipe. The shell reads its terminal on
	// whatever fd it likes (zsh: not 0), so the first argument is looked up.
	fd, err := strconv.ParseInt(strings.TrimPrefix(fields[1], "0x"), 16, 32)
	if err != nil {
		return false, true
	}
	target, err := os.Readlink("/proc/" + strconv.Itoa(pid) + "/fd/" + strconv.FormatInt(fd, 10))
	if err != nil {
		return false, true
	}
	return strings.HasPrefix(target, "/dev/pts/") || target == "/dev/tty", true
}

func TestWaitingForInputIsAProcessBlockedReadingItsStdinAndNothingElse(t *testing.T) {
	if _, err := os.Stat("/proc/self/syscall"); err != nil {
		t.Skip("NOT RUN: no /proc/<pid>/syscall on this machine")
	}
	// cat on a terminal nobody types on is blocked in read(0) of a tty: it waits for input.
	master, slave, err := pty.Open()
	require.NoError(t, err)
	t.Cleanup(func() { _ = master.Close(); _ = slave.Close() })
	reader := exec.Command("cat")
	reader.Stdin = slave
	require.NoError(t, reader.Start())
	t.Cleanup(func() { _ = reader.Process.Kill(); _ = reader.Wait() })
	waiting, known := waitingForInput(reader.Process.Pid, 5*time.Second)
	assert.True(t, known)
	assert.True(t, waiting, "cat is blocked reading a terminal")

	// A shell blocked in the `$(…)` of a hook reads a pipe: that is the window the wait is there to avoid.
	piper := exec.Command("cat")
	pipeIn, err := piper.StdinPipe()
	require.NoError(t, err)
	require.NoError(t, piper.Start())
	t.Cleanup(func() { _ = pipeIn.Close(); _ = piper.Process.Kill(); _ = piper.Wait() })
	waiting, _ = waitingForInput(piper.Process.Pid, 400*time.Millisecond)
	assert.False(t, waiting, "a process blocked reading a pipe does not wait for input")

	// sleep is asleep (nanosleep), and a shell waiting for a child is in wait4: neither waits for input.
	sleeper := exec.Command("sh", "-c", "sleep 30; true")
	require.NoError(t, sleeper.Start())
	t.Cleanup(func() { _ = sleeper.Process.Kill(); _ = sleeper.Wait() })
	waiting, _ = waitingForInput(sleeper.Process.Pid, 400*time.Millisecond)
	assert.False(t, waiting, "a shell that waits for its child does not wait for input")
	napper := exec.Command("sleep", "30")
	require.NoError(t, napper.Start())
	t.Cleanup(func() { _ = napper.Process.Kill(); _ = napper.Wait() })
	waiting, _ = waitingForInput(napper.Process.Pid, 400*time.Millisecond)
	assert.False(t, waiting, "a process asleep for a time does not wait for input")
}

// A bash that is slow to start says `unconfirmed` for its integration (it has not said `ready` in 500 ms) and still has it: the test
// waits for the prompt then too. (A prompt command that takes 0.3 s puts the second prompt well after the job's output.) (It did not, and closed inside the hooks' window about one run in twenty on a busy machine.)
func TestTheWaitForThePromptAfterTheJobWaitsForASlowBashToo(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("no bash on this machine")
	}
	if reason := integrationShellSkip("bash", func() (int, int, error) { return probeBashVersion(bash) }); reason != "" {
		t.Skipf("NOT RUN: %s", reason)
	}
	home := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(home, ".bash_profile"), []byte("sleep 1\nPROMPT_COMMAND='sleep 0.3'\n"), 0o600))
	t.Setenv("HOME", home)
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	info, err := m.Start(Options{Command: []string{bash}}, nil)
	require.NoError(t, err)
	require.Equal(t, IntegrationUnconfirmed, info.Integration.State, "a bash that takes a second to start has not said ready in 500 ms")
	send(t, m, info.ID, "echo job-$$")
	jobLine := regexp.MustCompile(`job-\d`)
	require.Eventually(t, func() bool { return jobLine.Match(sink.output(info.ID)) }, 20*time.Second, 5*time.Millisecond)
	waitForThePromptAfterTheJob(t, sink, info)
	assert.GreaterOrEqual(t, bytes.Count(sink.output(info.ID), []byte("\x1b]133;B")), 2, "the shell is at the prompt after its line")
}

// (g) The host passes the shell's bytes untouched: a multi-byte character cut between two reads arrives
// as the same bytes, for the caller's decoder to join.
func TestAMultibyteCharacterSplitAtAnyByteBoundaryPassesThroughUntouched(t *testing.T) {
	shell := sh(t)
	t.Setenv("HOME", t.TempDir())
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	octal := func(b []byte) string {
		var out strings.Builder
		for _, c := range b {
			fmt.Fprintf(&out, "\\%03o", c)
		}
		return out.String()
	}
	for name, seq := range map[string][]byte{
		"two bytes (e acute)":  {0xc3, 0xa9},
		"three bytes (euro)":   {0xe2, 0x82, 0xac},
		"four bytes (emoji)":   {0xf0, 0x9f, 0x98, 0x80},
		"wide character (中)":   {0xe4, 0xb8, 0xad},
		"combining mark (e+´)": {0x65, 0xcc, 0x81},
	} {
		for cut := 1; cut < len(seq); cut++ {
			t.Run(fmt.Sprintf("%s cut after byte %d", name, cut), func(t *testing.T) {
				script := fmt.Sprintf("printf 'x%s'; sleep 0.3; printf '%sy'", octal(seq[:cut]), octal(seq[cut:]))
				info, err := m.Start(Options{Command: []string{shell, "-c", script}}, nil)
				require.NoError(t, err)
				require.Equal(t, EndExited, sink.waitEnd(t, info.ID, 20*time.Second).Reason)

				want := append(append([]byte("x"), seq...), 'y')
				require.True(t, bytes.Contains(sink.output(info.ID), want), "the bytes arrived untouched; got %q", sink.output(info.ID))
				head := append([]byte("x"), seq[:cut]...)
				tail := append(append([]byte(nil), seq[cut:]...), 'y')
				split := false
				parts := sink.parts(info.ID)
				for i := 1; i < len(parts); i++ {
					if bytes.HasSuffix(parts[i-1], head) && bytes.HasPrefix(parts[i], tail) {
						split = true
					}
				}
				assert.True(t, split, "the host delivered the character in two events, cut inside it; it delivered %q", parts)
			})
		}
	}
}
