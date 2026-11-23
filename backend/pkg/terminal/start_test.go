//go:build !windows

package terminal

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"

	"github.com/omniviewdev/omniview/internal/shellenv"
)

// ONE environment truth. A shell starts from the environment the host was LAUNCHED with and computes the
// user's environment itself, once, as the login shell of Terminal.app does. Started from the host's
// restored environment it would run the user's profile on a PATH that path_helper has already ordered:
// path_helper then moves the user's directories behind the system's, and a version manager's "prepend
// unless already present" line declines to prepend (JetBrains' IJPL-200767).
func TestTheShellStartsFromTheLaunchEnvironmentSoTheUsersPathOrderSurvives(t *testing.T) {
	for _, name := range []string{"zsh", "bash"} {
		t.Run(name, func(t *testing.T) {
			shellPath, lookErr := exec.LookPath(name)
			if lookErr != nil {
				t.Skipf("no %s on this machine", name)
			}
			home := t.TempDir()
			prepend := "case \":$PATH:\" in *\":/omniview-user/shims:\"*) ;; *) PATH=\"/omniview-user/shims:$PATH\" ;; esac\nexport PATH\n"
			require.NoError(t, os.WriteFile(filepath.Join(home, ".zprofile"), []byte(prepend), 0o600))
			require.NoError(t, os.WriteFile(filepath.Join(home, ".bash_profile"), []byte(prepend), 0o600))
			t.Setenv("HOME", home)
			// The host's own process holds the RESTORED environment: the user's directories are already in
			// front, and one directory is there that only the login probe knew.
			t.Setenv("PATH", "/restored-only/bin:/omniview-user/shims:/usr/bin:/bin:/usr/sbin:/sbin")
			sink := newChunkSink()
			m := newChunkManager(t, sink)
			// What the shell starts from is the environment the host was launched with: launchd's, for an
			// app started from the Dock.
			m.base = func() []string {
				return []string{"HOME=" + home, "USER=omniview-test", "PATH=/usr/bin:/bin:/usr/sbin:/sbin"}
			}
			info, err := m.Start(Options{Command: []string{shellPath, "-c", "echo path=$PATH"}}, nil)
			require.NoError(t, err)
			require.Equal(t, EndExited, sink.waitEnd(t, info.ID, 20*time.Second).Reason)
			out := string(sink.output(info.ID))
			assert.Contains(t, out, "path=/omniview-user/shims:", "the user's directory is first: the profile ran once, on the launch PATH")
			assert.NotContains(t, out, "/restored-only/bin", "the shell did not start from the restored environment")
		})
	}
}

func TestTheHostsOwnVariablesAndTheLaunchingTerminalsAreStrippedFromTheShell(t *testing.T) {
	shell := sh(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	m.base = func() []string {
		return []string{
			"HOME=" + home, "PATH=/usr/bin:/bin",
			"OMNIVIEW_UI=next", "GOWORK=off", "PLUGIN_ID=x",
			"TMUX=/tmp/tmux-1/default,1,0", "STY=1.x", "VTE_VERSION=1", "TERM_SESSION_ID=abc",
			"KEEP_ME=yes",
		}
	}
	script := "echo omniview=${OMNIVIEW_UI-unset}; echo gowork=${GOWORK-unset}; echo plugin=${PLUGIN_ID-unset}; " +
		"echo tmux=${TMUX-unset}; echo sty=${STY-unset}; echo vte=${VTE_VERSION-unset}; echo session=${TERM_SESSION_ID-unset}; echo keep=${KEEP_ME-unset}"
	info, err := m.Start(Options{Command: []string{shell, "-c", script}}, nil)
	require.NoError(t, err)
	require.Equal(t, EndExited, sink.waitEnd(t, info.ID, 20*time.Second).Reason)
	out := string(sink.output(info.ID))
	for _, want := range []string{
		"omniview=unset\r\n", "gowork=unset\r\n", "plugin=unset\r\n", "tmux=unset\r\n", "sty=unset\r\n", "vte=unset\r\n", "session=unset\r\n",
		"keep=yes\r\n",
	} {
		assert.Contains(t, out, want)
	}
}

func TestPWDIsTheDirectoryTheShellWasToldAndNotItsResolvedPath(t *testing.T) {
	shell := sh(t)
	t.Setenv("HOME", t.TempDir())
	target := t.TempDir()
	link := filepath.Join(t.TempDir(), "linked directory")
	require.NoError(t, os.Symlink(target, link))
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	info, err := m.Start(Options{Command: []string{shell, "-c", "echo pwd=$PWD"}, Cwd: link}, nil)
	require.NoError(t, err)
	require.Equal(t, EndExited, sink.waitEnd(t, info.ID, 20*time.Second).Reason)
	assert.Contains(t, string(sink.output(info.ID)), "pwd="+link+"\r\n")
}

func TestThePtyCarriesUTF8(t *testing.T) {
	m, _ := newTestManager(t)
	info := m.run(t, "sleep 2", Options{})
	master := m.session(t, info.ID).master
	var carries bool
	require.NoError(t, control(master, func(fd int) error {
		termios, err := unix.IoctlGetTermios(fd, getTermios)
		if err != nil {
			return err
		}
		carries = termios.Iflag&unix.IUTF8 != 0
		return nil
	}))
	assert.True(t, carries, "IUTF8 is set on the pty, as Alacritty, Ghostty and node-pty do")
}

func TestAShellThatIsNotInstalledFallsBackAndTheAnswerSaysWhichStarted(t *testing.T) {
	m, rec := newTestManager(t)
	info, err := m.Start(Options{Command: []string{"/nonexistent/bin/zsh"}}, nil)
	require.NoError(t, err, "the next shell of the stated order starts")
	assert.Equal(t, "/nonexistent/bin/zsh", info.Shell.Requested, "the answer names the shell that was asked for")
	assert.NotEmpty(t, info.Shell.Path)
	assert.NotEqual(t, "/nonexistent/bin/zsh", info.Shell.Path)
	send(t, m, info.ID, "echo fell-back-$((40+2))")
	rec.waitFor(t, info.ID, "fell-back-42")

	asked, err := m.Start(Options{Command: []string{sh(t)}}, nil)
	require.NoError(t, err)
	assert.Empty(t, asked.Shell.Requested, "a shell that was asked for and started says nothing of a request")
}

func TestTheAnswerStatesTheEnvironmentSourceAndAFailedLoginProbe(t *testing.T) {
	m, _ := newTestManager(t)
	m.probe = func() shellenv.ProbeResult {
		return shellenv.ProbeResult{State: shellenv.ProbeFailed, Message: "login environment resolution failed or timed out"}
	}
	info, err := m.Start(Options{Command: []string{sh(t)}}, nil)
	require.NoError(t, err)
	assert.Equal(t, EnvironmentLaunch, info.Environment.Source)
	assert.Equal(t, "failed", info.Environment.Probe.State, "a failed probe is stated, not swallowed")
	assert.Equal(t, "login environment resolution failed or timed out", info.Environment.Probe.Message)
}

// Measure, then create: a size that is not a size is never applied to the pty.
func TestZeroSizesAreNeverAppliedToThePty(t *testing.T) {
	m, rec := newTestManager(t)
	info, err := m.Start(Options{Command: []string{sh(t)}, Cols: 0, Rows: 0}, nil)
	require.NoError(t, err)
	assert.Equal(t, DefaultCols, info.Cols, "zero is not given: the default")
	assert.Equal(t, DefaultRows, info.Rows)
	send(t, m, info.ID, "echo first-$(stty size | tr ' ' x)")
	rec.waitFor(t, info.ID, "first-24x80")
	for name, size := range map[string][2]int{"0 x 0": {0, 0}, "0 columns": {30, 0}, "0 rows": {0, 100}} {
		resizeErr := m.Resize(info.ID, 0, size[0], size[1])
		require.ErrorIs(t, resizeErr, ErrInvalid, name)
	}
	send(t, m, info.ID, "echo second-$(stty size | tr ' ' x)")
	rec.waitFor(t, info.ID, "second-24x80")
}
