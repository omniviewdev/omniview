//go:build !windows

package terminal

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

// The cases of the independent review of #658 (docs/ui-next/status/T1-go.md, section 2.8.9), each a test
// that failed on the head the review read.

// countSink keeps how much a session said and how it ended, and nothing of what it said: a flood is
// counted, not held.
type countSink struct {
	mu     sync.Mutex
	bytes  int
	ends   []End
	late   int
	closed bool
}

func (c *countSink) Output(_ string, data []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bytes += len(data)
	if c.closed {
		c.late++
	}
}

func (c *countSink) Closed(_ string, end End) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	c.ends = append(c.ends, end)
}

func (c *countSink) snapshot() (int, []End, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.bytes, append([]End(nil), c.ends...), c.late
}

func (c *countSink) waitEnd(t *testing.T, within time.Duration) End {
	t.Helper()
	require.Eventually(t, func() bool { _, ends, _ := c.snapshot(); return len(ends) > 0 }, within, 10*time.Millisecond, "the session never closed")
	_, ends, _ := c.snapshot()
	require.Len(t, ends, 1, "exactly one CLOSE")
	return ends[0]
}

// pidIn waits for a file a shell was told to write a pid into and returns the pid.
func pidIn(t *testing.T, path string) int {
	t.Helper()
	var pid int
	require.Eventually(t, func() bool {
		data, err := os.ReadFile(path)
		if err != nil {
			return false
		}
		value, convErr := strconv.Atoi(strings.TrimSpace(string(data)))
		pid = value
		return convErr == nil && pid > 0
	}, 20*time.Second, 10*time.Millisecond, "no pid was written to %s", path)
	t.Cleanup(func() { _ = syscall.Kill(pid, syscall.SIGKILL) })
	return pid
}

// quietHome is a HOME for shells whose first-run behaviour would take a test's typed lines: zsh runs its
// new-user wizard (zsh-newuser-install, which asks for input) when none of its startup files exist, and no
// shell finds a startup file that does anything.
func quietHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	for _, name := range []string{".zshenv", ".zprofile", ".zshrc", ".zlogin", ".bash_profile", ".bashrc", ".profile"} {
		require.NoError(t, os.WriteFile(filepath.Join(home, name), nil, 0o600))
	}
	t.Setenv("HOME", home)
	return home
}

func loginShells(t *testing.T) map[string]string {
	t.Helper()
	found := map[string]string{}
	for _, name := range []string{"bash", "zsh"} {
		if path, err := exec.LookPath(name); err == nil {
			found[name] = path
		}
	}
	if len(found) == 0 {
		t.Skip("neither bash nor zsh on this machine")
	}
	return found
}

// B2. A graceful host shutdown (SIGTERM or SIGINT: Wails cancels the application context first) ends a
// terminal the way closing it does: the shell and its foreground program are hung up, so a background job
// the user did not nohup or disown ends with the terminal. It used to kill the shell alone, and the jobs
// outlived the host.
func TestAGracefulShutdownHangsUpTheBackgroundJobsOfEveryShell(t *testing.T) {
	for name, path := range loginShells(t) {
		t.Run(name, func(t *testing.T) {
			quietHome(t)
			sink := newChunkSink()
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			m := NewManager(ctx, logging.NewNop(), sink)
			info, err := m.Start(Options{Command: []string{path}}, nil)
			require.NoError(t, err)
			pidFile := filepath.Join(t.TempDir(), "job")
			send(t, m, info.ID, "sleep 60011 & echo $! > "+pidFile)
			job := pidIn(t, pidFile)
			// The shell has finished the line that started the job when it runs the next one: a quit is
			// not signalled to a shell that is still building its job table (zsh then has no job to hang up).
			send(t, m, info.ID, "echo ready-$((40+2))")
			sink.waitFor(t, info.ID, "ready-42")
			// With the integration, the shell is at its prompt once the prompt after that line has been drawn (its input-start mark;
			// the first two are the first prompt and the one after the job's line): the host's quit is not signalled into the
			// moment the hooks of bash run, which are a non-interactive shell for a hangup (T5-inject-bash.md, the known gap).
			if bytes.Contains(sink.output(info.ID), []byte("\x1b]133;A")) {
				require.Eventually(t, func() bool { return bytes.Count(sink.output(info.ID), []byte("\x1b]133;B")) >= 3 },
					20*time.Second, 5*time.Millisecond, "the prompt after the line was never drawn")
			}
			require.False(t, ended(job))

			cancel()

			end := sink.waitEnd(t, info.ID, 20*time.Second)
			assert.Equal(t, EndClosed, end.Reason)
			assert.Equal(t, ClosedByShutdown, end.ClosedBy)
			require.Eventually(t, func() bool { return ended(job) }, 10*time.Second, 20*time.Millisecond,
				"the background job outlived the host's shutdown")
			assert.True(t, ended(info.PID))
		})
	}
}

// S-b. The kill at the end of the grace goes to the foreground group that is there THEN. A shell that
// ignores the hangup and starts a program after it began (here: when the first foreground program ends,
// which the test lets happen 300 ms into the grace) used to keep that program: the group was read once,
// at the start, and signalled by number 1.5 s later.
func TestTheKillAtTheGraceTargetsTheForegroundThatIsThereThenAndNotTheOneTheHangupFound(t *testing.T) {
	shells := loginShells(t)
	shells["sh"] = sh(t)
	for name, path := range shells {
		t.Run(name, func(t *testing.T) {
			quietHome(t)
			dir := t.TempDir()
			gate := filepath.Join(dir, "gate")
			pidFile := filepath.Join(dir, "pid")
			require.NoError(t, unix.Mkfifo(gate, 0o600))
			sink := newChunkSink()
			m := newChunkManager(t, sink)
			info, err := m.Start(Options{Command: []string{path}}, nil)
			require.NoError(t, err)
			send(t, m, info.ID, "trap '' HUP")
			send(t, m, info.ID, "cat "+gate+"; sh -c 'echo $$ > "+pidFile+"; exec sleep 60012'")
			require.Eventually(t, func() bool {
				busy, busyErr := m.Busy(info.ID)
				return busyErr == nil && busy.State == StateBusy
			}, 20*time.Second, 10*time.Millisecond, "cat never became the foreground")

			closed := make(chan error, 1)
			begin := time.Now()
			go func() { closed <- m.CloseSession(info.ID) }()
			time.Sleep(300 * time.Millisecond)
			// The first foreground program ends now, after the hangup began and was ignored.
			openGate(t, gate)
			pid := pidIn(t, pidFile)

			select {
			case closeErr := <-closed:
				require.NoError(t, closeErr)
			case <-time.After(10 * time.Second):
				t.Fatal("CloseSession did not return")
			}
			assert.GreaterOrEqual(t, time.Since(begin), HangupGrace-200*time.Millisecond, "the shell ignored the hangup: it lived to the grace")
			require.Eventually(t, func() bool { return ended(pid) }, 10*time.Second, 20*time.Millisecond,
				"the program the shell started after the hangup began was not killed")
			assert.True(t, ended(info.PID))
		})
	}
}

// openGate writes a line into a FIFO a program is reading, and fails the test, instead of hanging it, when
// nobody is: opening a FIFO for writing blocks until a reader is there.
func openGate(t *testing.T, gate string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		fd, err := syscall.Open(gate, syscall.O_WRONLY|syscall.O_NONBLOCK, 0)
		if err == nil {
			file := os.NewFile(uintptr(fd), gate)
			_, writeErr := file.WriteString("go\n")
			require.NoError(t, writeErr)
			require.NoError(t, file.Close())
			return
		}
		if !errors.Is(err, syscall.ENXIO) || time.Now().After(deadline) {
			t.Fatalf("nobody reads the gate (the program in the foreground is gone): %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// B3. A process of the shell's session that keeps the pty open and writing (`while :; do ...; done &` is
// what `npm run dev &` is) used to keep a Linux session alive for as long as it wrote: the shell had
// exited, there was no CLOSE, the session was listed, CloseSession answered 404 and output kept coming.
// The drain after the exit is capped: the CLOSE comes about drainCap after the exit, with the exit facts,
// and what the process writes after that is dropped and counted.
func TestASessionEndsAfterTheDrainCapEvenWhileAnOrphanKeepsTheTerminalOpenAndWriting(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("no bash on this machine")
	}
	for variant, job := range map[string]string{
		"a job that ticks": "while :; do echo JOBLOG; sleep 0.2; done &",
		"a flood":          "yes ORPHAN &",
	} {
		t.Run(variant, func(t *testing.T) {
			quietHome(t)
			pidFile := filepath.Join(t.TempDir(), "orphan")
			sink := &countSink{}
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			m := NewManager(ctx, logging.NewNop(), sink)
			info, startErr := m.Start(Options{Command: []string{bash}}, nil)
			require.NoError(t, startErr)
			send(t, m, info.ID, job+" echo $! > "+pidFile)
			_ = pidIn(t, pidFile)

			exitedAt := time.Now()
			send(t, m, info.ID, "exit")
			end := sink.waitEnd(t, drainCap+10*time.Second)
			took := time.Since(exitedAt)
			assert.Equal(t, EndExited, end.Reason, "the exit facts are the shell's own")
			require.NotNil(t, end.ExitCode)
			assert.Equal(t, 0, *end.ExitCode)
			assert.Less(t, took, drainCap+4*time.Second, "the CLOSE came %s after the exit", took)
			if runtime.GOOS == "linux" {
				assert.True(t, end.DrainCapped, "the pty was still open and written to at the cap: the end says so")
				if variant == "a flood" {
					assert.Positive(t, end.DroppedBytes, "what the flood wrote after the cap is counted")
				}
			}
			_, listed := m.sessionOf(info.ID)
			assert.False(t, listed, "the session is gone")
			assert.Equal(t, 404, appErr(t, m.CloseSession(info.ID)).Status, "a session that ended is not found")

			_, _, late := sink.snapshot()
			assert.Zero(t, late, "no output after the CLOSE")
			time.Sleep(500 * time.Millisecond)
			_, _, late = sink.snapshot()
			assert.Zero(t, late, "no output after the CLOSE, later either")
		})
	}
}

func (m *Manager) sessionOf(id string) (*session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	return s, ok
}

// S-a. The shell gets the user's LAUNCH environment and the few variables the terminal sets on purpose:
// nothing the host added to its own environment after it launched, and nothing of the host's own or of the
// terminal it was launched from. `WAILS_MCP_TOKEN` (the MCP bearer) and the other WAILS_ variables used to
// reach the shell.
func TestTheShellGetsTheLaunchEnvironmentAndNothingTheHostAddedAfterLaunch(t *testing.T) {
	shell := sh(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	launch := []string{
		"HOME=" + home, "PATH=/usr/bin:/bin", "USER=omniview-test", "LOGNAME=omniview-test",
		"KEEP_USER_VARIABLE=kept", "SSH_AUTH_SOCK=/tmp/agent.sock", "KUBECONFIG=/tmp/kube",
		// What a dev supervisor puts in the host's launch environment, and what a terminal the host was
		// launched from puts in it: not this terminal's.
		"WAILS_MCP_TOKEN=SECRET-MCP-BEARER", "WAILS_MCP_HOST=127.0.0.1", "WAILS_MCP_PORT=1", "WAILS_SERVER_HOST=127.0.0.1",
		"WAILS_SERVER_PORT=2", "WAILS_VITE_PORT=3", "FRONTEND_DEVSERVER_URL=http://127.0.0.1:3",
		"ITERM_SESSION_ID=w0t0p0", "ITERM_PROFILE=Default", "LC_TERMINAL=iTerm2", "KITTY_WINDOW_ID=1", "WEZTERM_PANE=1",
		"ALACRITTY_WINDOW_ID=1", "GHOSTTY_RESOURCES_DIR=/x", "VSCODE_INJECTION=1", "VSCODE_GIT_ASKPASS_NODE=/x",
		"TERMINAL_EMULATOR=JetBrains-JediTerm", "WT_SESSION=x", "__CFBundleIdentifier=com.example", "TERM_SESSION_ID=abc",
		"TMUX=/tmp/tmux-1/default,1,0", "TMUX_PANE=%1", "STY=1.x", "VTE_VERSION=1", "COLUMNS=211", "LINES=50",
		"OMNIVIEW_UI=next", "PLUGIN_ID=x", "GOWORK=off",
	}
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	// After it launched, the host adds to its own environment (the profile's TMPDIR, the XDG directories,
	// its own flags, what a framework publishes). None of it is the user's.
	added := []string{
		"HOST_ADDED_AFTER_LAUNCH", "WAILS_ADDED_AFTER_LAUNCH", "OMNIVIEW_ADDED_AFTER_LAUNCH", "XDG_DATA_HOME", "XDG_CACHE_HOME",
		"TMPDIR", "OMNIVIEW_STARTUP_REPORT", "ANYTHING_ELSE_THE_HOST_SETS",
	}
	for _, key := range added {
		t.Setenv(key, "set-by-the-host")
	}

	dump := func(base []string, label string) map[string]string {
		m.base = func() []string { return base }
		info, startErr := m.Start(Options{Command: []string{shell, "-c", "env"}}, nil)
		require.NoError(t, startErr, label)
		require.Equal(t, EndExited, sink.waitEnd(t, info.ID, 20*time.Second).Reason, label)
		got := map[string]string{}
		for _, line := range strings.Split(strings.ReplaceAll(string(sink.output(info.ID)), "\r", ""), "\n") {
			if key, value, ok := strings.Cut(line, "="); ok && key != "" && !strings.ContainsAny(key, " \t") {
				got[key] = value
			}
		}
		return got
	}
	child := dump(launch, "the launch environment")
	// What the login shell and the terminal add on their own: found by starting the same shell from a
	// near-empty launch environment, so that a distribution's profile is not mistaken for the host's doing.
	control := dump([]string{"HOME=" + home, "PATH=/usr/bin:/bin"}, "the control")

	for _, key := range added {
		_, present := child[key]
		assert.False(t, present, "%s was added by the host after launch and reached the shell", key)
	}
	for key := range child {
		_, fromLaunch := lookup(launch, key)
		_, fromControl := control[key]
		if !fromLaunch && !fromControl {
			t.Errorf("%s=%q reached the shell: it is neither the user's launch environment nor what the terminal and the login shell set on purpose", key, child[key])
		}
	}
	for _, key := range []string{
		"WAILS_MCP_TOKEN", "WAILS_MCP_HOST", "WAILS_MCP_PORT", "WAILS_SERVER_HOST", "WAILS_SERVER_PORT", "WAILS_VITE_PORT", "FRONTEND_DEVSERVER_URL",
		"ITERM_SESSION_ID", "ITERM_PROFILE", "LC_TERMINAL", "KITTY_WINDOW_ID", "WEZTERM_PANE", "ALACRITTY_WINDOW_ID", "GHOSTTY_RESOURCES_DIR",
		"VSCODE_INJECTION", "VSCODE_GIT_ASKPASS_NODE", "TERMINAL_EMULATOR", "WT_SESSION", "TERM_SESSION_ID",
		"TMUX", "TMUX_PANE", "STY", "VTE_VERSION", "COLUMNS", "LINES", "OMNIVIEW_UI", "PLUGIN_ID", "GOWORK",
	} {
		_, present := child[key]
		assert.False(t, present, "%s reached the shell", key)
	}
	for key, want := range map[string]string{"KEEP_USER_VARIABLE": "kept", "SSH_AUTH_SOCK": "/tmp/agent.sock", "KUBECONFIG": "/tmp/kube", "USER": "omniview-test"} {
		assert.Equal(t, want, child[key], "the user's own %s stays", key)
	}
	assert.Equal(t, "Omniview", child["TERM_PROGRAM"])
	assert.Equal(t, "xterm-256color", child["TERM"])
	assert.Equal(t, "truecolor", child["COLORTERM"])
}

func lookup(environment []string, key string) (string, bool) {
	for _, entry := range environment {
		if k, v, ok := strings.Cut(entry, "="); ok && k == key {
			return v, true
		}
	}
	return "", false
}
