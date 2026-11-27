//go:build !windows

package terminal

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE TRACKED DIRECTORY AGAINST REAL SHELLS (issue #694 step 6, review). A real pty, a real bash or zsh with the host's integration, real directories:
// what the shell proved is the answer only where the system agrees the shell is, in the shell's own spelling. `GetCwd` of the events lane is asked.

func cwdIs(t *testing.T, f *integrationFixture, id string) Directory {
	t.Helper()
	got, err := f.m.Cwd(id)
	require.NoError(t, err)
	return got
}

// realDir is a real directory with a name of its own, made under a base the test owns.
func realDir(t *testing.T, base, name string) string {
	t.Helper()
	dir := filepath.Join(base, name)
	require.NoError(t, os.MkdirAll(dir, 0o700))
	resolved, err := filepath.EvalSymlinks(dir)
	require.NoError(t, err)
	return resolved
}

// The replacement's prompt is spelled so that the echo of the typed line cannot match it (`P''> ` is `P> ` only after the shell has parsed it): the wait is for the new shell's own prompt.
// A shell that is replaced (`exec`) by one with no integration tells nothing from then on: the last proof names a directory it has left.
func TestAReplacedShellWithNoIntegrationIsAnsweredByTheSystemNotByTheLastProof(t *testing.T) {
	for _, tc := range []struct{ shell, replacement string }{
		{"bash", "exec env PS1='P''> ' bash --norc --noprofile"},
		{"zsh", "exec env PS1='P''> ' zsh -f"},
	} {
		t.Run(tc.shell, func(t *testing.T) {
			f := newIntegrationFixture(t, tc.shell, integrationShell(t, tc.shell))
			if tc.shell == "bash" {
				f = bashFixture(t, "")
			}
			info := f.started()
			require.Equal(t, IntegrationOn, info.Integration.State)
			base := t.TempDir()
			first, second := realDir(t, base, "first"), realDir(t, base, "second")
			f.run(info.ID, "cd "+first)
			guarded(t, "real-tracked", func() {
				assert.Equal(t, Directory{Path: first}, cwdIs(t, f, info.ID), "%s with the integration: the proof and the system agree", tc.shell)
			})
			f.run(info.ID, tc.replacement)
			f.run(info.ID, "cd "+second)
			guarded(t, "real-exec-stale", func() {
				assert.Equal(t, Directory{Path: second}, cwdIs(t, f, info.ID), "%s after exec into a shell with no integration and a cd: where the system says it is", tc.shell)
			})
		})
	}
}

// The shell's own spelling of a directory reached through a symlink is the answer: the same directory as the system's, in the words the shell used.
func TestADirectoryReachedThroughASymlinkIsAnsweredInTheShellsSpelling(t *testing.T) {
	for _, shell := range []string{"bash", "zsh"} {
		t.Run(shell, func(t *testing.T) {
			f := newIntegrationFixture(t, shell, integrationShell(t, shell))
			if shell == "bash" {
				f = bashFixture(t, "")
			}
			info := f.started()
			require.Equal(t, IntegrationOn, info.Integration.State)
			base := t.TempDir()
			target := realDir(t, base, "real")
			link := filepath.Join(base, "link")
			require.NoError(t, os.Symlink(target, link))
			f.run(info.ID, "cd "+link)
			guarded(t, "real-logical", func() {
				assert.Equal(t, Directory{Path: link}, cwdIs(t, f, info.ID), "%s: the logical path, not %s", shell, target)
			})
		})
	}
}

// A directory shaped as macOS has it: /var is a symlink to /private/var, and the system names the physical one.
func TestAMacShapedSymlinkedTemporaryDirectoryIsAnsweredInTheShellsSpelling(t *testing.T) {
	f := bashFixture(t, "")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	base := t.TempDir()
	physical := realDir(t, filepath.Join(base, "private"), filepath.Join("var", "folders", "x"))
	require.NoError(t, os.Symlink(filepath.Join(base, "private", "var"), filepath.Join(base, "var")))
	logical := filepath.Join(base, "var", "folders", "x")
	f.run(info.ID, "cd "+logical)
	got := cwdIs(t, f, info.ID)
	guarded(t, "real-mac-shape", func() {
		assert.Equal(t, Directory{Path: logical}, got, "the shell's /var spelling, where the system says %s", physical)
	})
}

// A directory removed under the shell is unknown, as #777 settled: the shell's last proof names it, and it is not a directory now.
func TestARemovedDirectoryIsUnknownWithTheIntegrationOn(t *testing.T) {
	f := bashFixture(t, "")
	info := f.started()
	require.Equal(t, IntegrationOn, info.Integration.State)
	base := t.TempDir()
	gone := realDir(t, base, "gone")
	f.run(info.ID, "cd "+gone)
	f.run(info.ID, "rmdir "+gone)
	f.run(info.ID, "true")
	got := cwdIs(t, f, info.ID)
	guarded(t, "real-removed", func() {
		assert.Equal(t, Directory{Reason: ReasonQueryFailed}, got, "never the removed path")
	})
}
