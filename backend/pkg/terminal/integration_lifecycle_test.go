//go:build !windows

package terminal

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A fake shell is a script with the name of a shell. It is the shell of the tests of what the host does around a
// shell that the real one cannot be made to do on demand: die at once, never answer, die by a signal. It logs how
// it was started, one line per start, to the file its environment names.
const fakeShellScript = `#!/bin/sh
echo "start zdotdir=${ZDOTDIR-unset} xdg=${XDG_DATA_DIRS-unset} args=$*" >> "$FAKE_LOG"
integrated=no
case "$ZDOTDIR$XDG_DATA_DIRS" in *omniview-integration-*) integrated=yes ;; esac
if [ "$integrated" = yes ]; then
  dir=${ZDOTDIR:-$XDG_DATA_DIRS}
  dir=${dir%%:*}
  ls -ldn "$dir" > "$FAKE_LOG.dir"
  echo "$dir" > "$FAKE_LOG.path"
fi
case "$FAKE_MODE" in
  die-with-integration) [ "$integrated" = yes ] && exit 3 ;;
  die-always) exit 3 ;;
  crash) kill -9 $$ ;;
esac
if [ "$integrated" = yes ] && [ "$FAKE_MODE" != silent ]; then echo ready >&3; fi
exec cat > /dev/null
`

// fakeShell writes a fake shell with the name of a shell and returns its path and the file it logs to.
func fakeShell(t *testing.T, name string) (string, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name)
	require.NoError(t, os.WriteFile(path, []byte(fakeShellScript), 0o700))
	return path, filepath.Join(dir, "log")
}

func starts(t *testing.T, log string) []string {
	t.Helper()
	data, err := os.ReadFile(log)
	if os.IsNotExist(err) {
		return nil
	}
	require.NoError(t, err)
	return strings.Split(strings.TrimSpace(string(data)), "\n")
}

// waitStarts waits until the fake shell has logged n starts: it logs from its own process, after Start has answered.
func waitStarts(t *testing.T, log string, n int) []string {
	t.Helper()
	require.Eventually(t, func() bool { return len(starts(t, log)) >= n }, 10*time.Second, 5*time.Millisecond, "the shell was not started %d times", n)
	return starts(t, log)
}

func fakeFixture(t *testing.T, name, mode string, env ...string) (*integrationFixture, string, string) {
	t.Helper()
	path, log := fakeShell(t, name)
	f := newIntegrationFixture(t, name, path, append([]string{"FAKE_LOG=" + log, "FAKE_MODE=" + mode}, env...)...)
	return f, path, log
}

func TestTheFactSaysWhyTheIntegrationIsOffOrSkipped(t *testing.T) {
	cases := []struct {
		name  string
		shell string
		args  []string
		env   []string
		off   bool
		want  Integration
	}{
		{name: "the setting is off", shell: "zsh", off: true, want: Integration{State: IntegrationOff, Reason: ""}},
		{name: "-c", shell: "zsh", args: []string{"-c", "true"}, want: Integration{State: IntegrationSkipped, Reason: SkipCommand}},
		{name: "-c of fish", shell: "fish", args: []string{"-c", "true"}, want: Integration{State: IntegrationSkipped, Reason: SkipCommand}},
		{name: "a user argument the host does not know", shell: "zsh", args: []string{"-f"}, want: Integration{State: IntegrationSkipped, Reason: SkipArguments}},
		{name: "--posix", shell: "zsh", args: []string{"--posix"}, want: Integration{State: IntegrationSkipped, Reason: SkipPosix}},
		{name: "powerlevel10k", shell: "zsh", env: []string{"P9K_VERSION=1.20"}, want: Integration{State: IntegrationSkipped, Reason: SkipPowerlevel10k}},
		{name: "tmux", shell: "zsh", env: []string{"TMUX=/tmp/tmux-1/default,1,0"}, want: Integration{State: IntegrationSkipped, Reason: SkipMultiplexer}},
		{name: "screen", shell: "fish", env: []string{"STY=1.pts-0.host"}, want: Integration{State: IntegrationSkipped, Reason: SkipMultiplexer}},
		{name: "a shell with no script yet", shell: "bash", want: Integration{State: IntegrationSkipped, Reason: SkipUnsupportedShell}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, _, log := fakeFixture(t, c.shell, "plain", c.env...)
			if c.off {
				f.m.SetIntegration(func() (bool, error) { return false, nil })
			}
			info := f.start(c.args...)
			assert.Equal(t, c.want, info.Integration)
			require.Eventually(t, func() bool { return len(starts(t, log)) == 1 }, 10*time.Second, 5*time.Millisecond)
			line := starts(t, log)[0]
			assert.Contains(t, line, "zdotdir=unset xdg=unset", "nothing of the integration reached the shell: %q", line)
			assert.Empty(t, f.integrationDirs(), "no directory was made")
			assert.True(t, f.m.session(t, info.ID).nonce.IsZero(), "no nonce was made")
		})
	}
}

// The shell of the test that the integration does not reach is its own: the user turns it off in Settings, and the
// real shell then has no variable of the integration.
func TestWithTheSettingOffARealShellStartsWithNothingOfTheIntegration(t *testing.T) {
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		f := newIntegrationFixture(t, name, shell)
		f.m.SetIntegration(func() (bool, error) { return false, nil })
		info := f.started()
		assert.Equal(t, Integration{State: IntegrationOff, Reason: ""}, info.Integration)
		f.run(info.ID, "echo hello; env > exported")
		out := string(f.sink.output(info.ID))
		// fish 4 marks its prompts itself (OSC 133 and OSC 7): what the integration adds, and the user can turn off, is the
		// command line and the directory with the nonce.
		assert.NotContains(t, out, "\x1b]633;", "no mark of the integration")
		if name == "zsh" {
			assert.NotContains(t, out, "\x1b]133;", "no mark")
		}
		assert.NotContains(t, f.fileOf("exported"), integrationDirPrefix, "the environment has none of the integration")
		assert.NotContains(t, f.fileOf("exported"), "ZDOTDIR=")
		assert.Empty(t, f.integrationDirs())
	})
}

func TestTheSettingIsAskedForEveryTerminal(t *testing.T) {
	f, _, log := fakeFixture(t, "zsh", "plain")
	on := true
	f.m.SetIntegration(func() (bool, error) { return on, nil })
	assert.Equal(t, IntegrationOn, f.start().Integration.State)
	on = false
	assert.Equal(t, IntegrationOff, f.start().Integration.State)
	assert.Len(t, waitStarts(t, log, 2), 2)
}

// What the host makes for a shell is private: its directory is the user's alone.
func TestTheIntegrationDirectoryIsOwnerOnlyAndOwnedByTheUser(t *testing.T) {
	for _, name := range []string{"zsh", "fish"} {
		t.Run(name, func(t *testing.T) {
			f, _, log := fakeFixture(t, name, "silent")
			info := f.start()
			assert.Equal(t, Integration{State: IntegrationUnconfirmed, Reason: NoReady}, info.Integration, "the fake never says it is ready: the host does not say it is on")
			require.Eventually(t, func() bool { _, err := os.Stat(log + ".dir"); return err == nil }, 10*time.Second, 5*time.Millisecond)
			data, err := os.ReadFile(log + ".dir")
			require.NoError(t, err)
			fields := strings.Fields(string(data))
			require.GreaterOrEqual(t, len(fields), 3, "%q", data)
			assert.Equal(t, "drwx------", fields[0], "mode of the directory")
			assert.Equal(t, strconv.Itoa(os.Getuid()), fields[2], "owner of the directory")
			dirs := f.integrationDirs()
			require.Len(t, dirs, 1)
			assert.Equal(t, f.tmp, filepath.Dir(dirs[0]))
		})
	}
}

func TestTheIntegrationDirectoryIsRemovedOnEveryEnd(t *testing.T) {
	ends := map[string]func(t *testing.T, f *integrationFixture, info Session){
		"a close": func(t *testing.T, f *integrationFixture, info Session) {
			require.NoError(t, f.m.CloseSession(info.ID))
		},
		"a crash of the shell": func(t *testing.T, f *integrationFixture, info Session) {
			require.NoError(t, syscall.Kill(info.PID, syscall.SIGKILL))
			f.sink.waitEnd(t, info.ID, 20*time.Second)
		},
		"a shutdown of the host": func(_ *testing.T, f *integrationFixture, _ Session) { f.m.Shutdown() },
	}
	for name, end := range ends {
		t.Run(name, func(t *testing.T) {
			f, _, _ := fakeFixture(t, "zsh", "silent")
			info := f.start()
			require.Equal(t, IntegrationUnconfirmed, info.Integration.State)
			require.Len(t, f.integrationDirs(), 1, "the directory exists while the shell has not said it is ready")
			end(t, f, info)
			require.Eventually(t, func() bool { return len(f.integrationDirs()) == 0 }, 10*time.Second, 5*time.Millisecond, "the directory is left behind after %s", name)
		})
	}
	t.Run("a shell that crashes by itself", func(t *testing.T) {
		f, _, log := fakeFixture(t, "zsh", "crash")
		info := f.start()
		f.sink.waitEnd(t, info.ID, 20*time.Second)
		require.NotEmpty(t, starts(t, log))
		assert.NotContains(t, starts(t, log)[0], "zdotdir=unset", "the shell that crashed had the integration")
		require.Eventually(t, func() bool { return len(f.integrationDirs()) == 0 }, 10*time.Second, 5*time.Millisecond)
	})
}

func TestAShellThatDiesAtOnceWithTheIntegrationIsStartedOnceMoreWithoutIt(t *testing.T) {
	for _, name := range []string{"zsh", "fish"} {
		t.Run(name, func(t *testing.T) {
			f, _, log := fakeFixture(t, name, "die-with-integration")
			info := f.start()
			assert.Equal(t, Integration{State: IntegrationFailed, Reason: FailExitedEarly}, info.Integration)
			lines := waitStarts(t, log, 2)
			require.Len(t, lines, 2, "the shell was started twice: %v", lines)
			assert.NotContains(t, lines[0], "zdotdir=unset xdg=unset", "the first start had the integration")
			assert.Contains(t, lines[1], "zdotdir=unset xdg=unset", "the second had none")
			assert.Empty(t, f.integrationDirs(), "the directory of the failed start is gone at once")
			assert.True(t, f.m.session(t, info.ID).nonce.IsZero(), "the shell that runs has no nonce")
			require.NoError(t, f.m.Write(info.ID, 0, []byte("x\n")), "the session is the second shell, alive")
		})
	}
}

// The negative control of a relaunch loop: a shell that dies every time is started twice, no more, and its end is told.
func TestAShellThatAlwaysDiesIsStartedTwiceAndNoMore(t *testing.T) {
	f, _, log := fakeFixture(t, "zsh", "die-always")
	info := f.start()
	assert.Equal(t, Integration{State: IntegrationFailed, Reason: FailExitedEarly}, info.Integration)
	end := f.sink.waitEnd(t, info.ID, 20*time.Second)
	assert.Equal(t, EndExited, end.Reason)
	require.NotNil(t, end.ExitCode)
	assert.Equal(t, 3, *end.ExitCode)
	time.Sleep(300 * time.Millisecond)
	assert.Len(t, starts(t, log), 2, "one start with the integration and one without: no loop")
	assert.Empty(t, f.integrationDirs())
}

// A shell without the integration that dies at once is nobody's fault but the user's: it is not started twice.
func TestAShellThatDiesAtOnceWithoutTheIntegrationIsNotStartedAgain(t *testing.T) {
	f, _, log := fakeFixture(t, "zsh", "die-always")
	f.m.SetIntegration(func() (bool, error) { return false, nil })
	info := f.start()
	assert.Equal(t, IntegrationOff, info.Integration.State)
	f.sink.waitEnd(t, info.ID, 20*time.Second)
	time.Sleep(300 * time.Millisecond)
	assert.Len(t, starts(t, log), 1)
}

func TestTwoHundredStartsAndKillsLeaveNoDirectoryNoProcessAndNoDescriptor(t *testing.T) {
	const cycles = 200
	const workers = 8
	eachIntegrationShell(t, func(t *testing.T, name, shell string) {
		f := newIntegrationFixture(t, name, shell)
		type result struct {
			pid int
			err error
		}
		cycle := func() result {
			info, err := f.m.Start(Options{Command: []string{shell}, Cwd: f.home, Cols: 80, Rows: 24}, nil)
			if err != nil {
				return result{pid: 0, err: err}
			}
			if info.Integration.State != IntegrationOn {
				return result{pid: info.PID, err: fmt.Errorf("the integration is %q", info.Integration.State)}
			}
			return result{pid: info.PID, err: f.m.CloseSession(info.ID)}
		}
		require.NoError(t, cycle().err)
		baseline := openDescriptors(t)
		results := make(chan result, cycles)
		var wg sync.WaitGroup
		for range workers {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for range cycles / workers {
					results <- cycle()
				}
			}()
		}
		wg.Wait()
		close(results)
		count := 0
		for r := range results {
			count++
			require.NoError(t, r.err)
			if r.pid != 0 {
				requireGone(t, r.pid, "a shell of a cycle")
			}
		}
		assert.Equal(t, cycles, count)
		assert.Empty(t, f.m.running(), "no session is left")
		assert.Empty(t, f.integrationDirs(), "no temporary directory is left")
		require.Eventually(t, func() bool { return openDescriptors(t) <= baseline+2 }, 10*time.Second, 20*time.Millisecond,
			"descriptors: %d at the start, %d after the cycles", baseline, openDescriptors(t))
	})
}

// The host states only what it knows: a shell that says it is ready is `on`, one that does not is `unconfirmed`.
func TestTheFactIsOnOnlyAfterTheShellSaidItIsReady(t *testing.T) {
	f, _, _ := fakeFixture(t, "zsh", "plain")
	info := f.start()
	assert.Equal(t, Integration{State: IntegrationOn, Reason: ""}, info.Integration)
	require.Eventually(t, func() bool { return len(f.integrationDirs()) == 0 }, 10*time.Second, 5*time.Millisecond, "the directory is removed once the shell is ready")
}

// A startup file of the user's that stops zsh from reading the rest (here `setopt norcs`, as an `alias builtin=false`
// would also do) means the script never runs: the answer must not say `on`.
func TestARealShellWhoseScriptNeverRunsIsUnconfirmedAndNotOn(t *testing.T) {
	f := newIntegrationFixture(t, "zsh", integrationShell(t, "zsh"))
	require.NoError(t, os.WriteFile(filepath.Join(f.home, ".zshenv"), []byte("setopt norcs\n"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(f.home, ".zshrc"), []byte("PS1='"+integrationPrompt+"'\n"), 0o600))
	info := f.start()
	assert.Equal(t, Integration{State: IntegrationUnconfirmed, Reason: NoReady}, info.Integration)
	time.Sleep(300 * time.Millisecond)
	assert.NotContains(t, string(f.sink.output(info.ID)), "\x1b]633;", "the script never ran")
}

// A setting that cannot be read is not a yes: the host leaves the user's shell alone.
func TestASettingThatCannotBeReadFailsClosed(t *testing.T) {
	f, _, log := fakeFixture(t, "zsh", "plain")
	f.m.SetIntegration(func() (bool, error) { return true, errors.New("the settings store is gone") })
	info := f.start()
	assert.Equal(t, Integration{State: IntegrationSkipped, Reason: SkipSettingUnreadable}, info.Integration)
	line := waitStarts(t, log, 1)[0]
	assert.Contains(t, line, "zdotdir=unset xdg=unset")
	assert.Empty(t, f.integrationDirs())
}

// The fake shell logs with `echo >> file`: the shell makes the file before it writes the line, and a test that reads in
// between sees a file with no line. That is not a start (a CI run counted it as one, and read "" as the line of the shell).
func TestAFakeShellLogThatHasNoLineYetHasNoStart(t *testing.T) {
	log := filepath.Join(t.TempDir(), "log")
	require.NoError(t, os.WriteFile(log, nil, 0o600))
	assert.Empty(t, starts(t, log), "an empty log has no start")
	require.NoError(t, os.WriteFile(log, []byte("start a\n"), 0o600))
	assert.Equal(t, []string{"start a"}, starts(t, log))
}
