//go:build !windows

package terminal

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A shell that is in a directory somebody removed has no directory a new terminal can start in: the system still names
// the removed one (Linux reads `<path> (deleted)` from /proc), and the host does not pass that on as a fact. It says
// the directory is unknown, so that "New terminal here" starts in the home directory and says so.
func TestTheDirectoryOfAShellWhoseDirectoryWasRemovedIsUnknownAndNeverTheRemovedOne(t *testing.T) {
	shell := sh(t)
	t.Setenv("HOME", t.TempDir())
	doomed := filepath.Join(t.TempDir(), "doomed")
	require.NoError(t, os.Mkdir(doomed, 0o700))
	m := newChunkManager(t, newChunkSink())
	info, err := m.Start(Options{Command: []string{shell}, Cwd: doomed}, nil)
	require.NoError(t, err)

	here, err := m.Cwd(info.ID)
	require.NoError(t, err)
	require.Equal(t, physical(t, doomed), physical(t, here.Path), "before the removal the host names the directory")

	require.NoError(t, os.Remove(doomed))
	gone, err := m.Cwd(info.ID)
	require.NoError(t, err, "a removed directory is a fact about the terminal, not a failed call")
	assert.Empty(t, gone.Path, "the removed directory is not named: %q", gone.Path)
	assert.Equal(t, ReasonQueryFailed, gone.Reason, "the directory is unknown, with the reason a failed query has")
}

// Removing `y` while a sibling directory literally named `y (deleted)` exists: the system names `.../y (deleted)`, which
// is another real directory. The host must not take it for where the shell is.
func TestARemovedDirectoryIsNotMistakenForASiblingNamedLikeTheLinkSuffix(t *testing.T) {
	shell := sh(t)
	t.Setenv("HOME", t.TempDir())
	parent := t.TempDir()
	doomed := filepath.Join(parent, "y")
	require.NoError(t, os.Mkdir(doomed, 0o700))
	require.NoError(t, os.Mkdir(filepath.Join(parent, "y (deleted)"), 0o700))
	m := newChunkManager(t, newChunkSink())
	info, err := m.Start(Options{Command: []string{shell}, Cwd: doomed}, nil)
	require.NoError(t, err)
	require.NoError(t, os.Remove(doomed))

	gone, err := m.Cwd(info.ID)
	require.NoError(t, err)
	assert.Empty(t, gone.Path, "the sibling is not where the shell is: %q", gone.Path)
	assert.Equal(t, ReasonQueryFailed, gone.Reason)
}
