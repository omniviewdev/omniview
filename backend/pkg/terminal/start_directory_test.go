//go:build !windows

package terminal

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The shell starts in exactly the path that was validated: `link/..` is the parent of what the link points
// at, which is not the lexical parent of the link.
func TestTheShellStartsInTheValidatedPathNotItsCleanedForm(t *testing.T) {
	m, rec := newTestManager(t)
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(root, "data", "inner"), 0o700))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "work"), 0o700))
	require.NoError(t, os.Symlink(filepath.Join(root, "data", "inner"), filepath.Join(root, "work", "link")))
	requested := filepath.Join(root, "work", "link") + string(filepath.Separator) + ".."

	// The system's own answer: where `link/..` leads.
	want, err := os.Stat(requested)
	require.NoError(t, err)
	require.True(t, os.SameFile(want, mustStat(t, filepath.Join(root, "data"))), "the fixture: link/.. is data, not work")

	info := m.run(t, "echo at-$(pwd -P)-end", Options{Cwd: requested})
	assert.Equal(t, requested, info.Cwd, "the session says the path that was validated, unchanged")
	rec.waitFor(t, info.ID, "-end")
	assert.Contains(t, rec.text(info.ID), "at-"+filepath.Join(root, "data")+"-end", "the shell started in what the path leads to")
	assert.NotContains(t, rec.text(info.ID), "at-"+filepath.Join(root, "work")+"-end", "not in the lexical parent of the link")
}

func mustStat(t *testing.T, path string) os.FileInfo {
	t.Helper()
	info, err := os.Stat(path)
	require.NoError(t, err)
	return info
}

// A path that is a file, one that is gone and one that is relative start nothing.
func TestAStartDirectoryThatIsAFileOrGoneOrRelativeStartsNothing(t *testing.T) {
	m, _ := newTestManager(t)
	dir := t.TempDir()
	file := filepath.Join(dir, "file")
	require.NoError(t, os.WriteFile(file, nil, 0o600))
	gone := filepath.Join(dir, "gone")
	require.NoError(t, os.Mkdir(gone, 0o700))
	require.NoError(t, os.Remove(gone))
	for name, cwd := range map[string]string{"file": file, "gone": gone, "below a file": file + string(filepath.Separator) + "..", "relative": "work/link"} {
		t.Run(name, func(t *testing.T) {
			before := len(m.running())
			_, err := m.Start(Options{Command: []string{sh(t)}, Cwd: cwd}, nil)
			problem := appErr(t, err)
			assert.Equal(t, "INVALID_REQUEST", problem.Code)
			assert.Contains(t, problem.Detail, "cwd", "the detail names cwd")
			assert.Len(t, m.running(), before)
		})
	}
}

// Every shell agrees on where it is: `pwd`, `pwd -P` and the directory after a `cd .` all name the validated
// directory, whatever the shell does with the PWD it is started with (bash cleans a `link/..` in PWD
// logically, which names another directory).
func TestEveryShellStartedThroughALinkAndDotDotIsWhereTheSystemLeadsThePath(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(root, "data", "inner"), 0o700))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "work"), 0o700))
	require.NoError(t, os.Symlink(filepath.Join(root, "data", "inner"), filepath.Join(root, "work", "link")))
	requested := filepath.Join(root, "work", "link") + string(filepath.Separator) + ".."
	data := filepath.Join(root, "data")
	for _, name := range []string{"sh", "bash", "zsh"} {
		t.Run(name, func(t *testing.T) {
			path, lookErr := exec.LookPath(name)
			if lookErr != nil {
				t.Skipf("not run: %s is not installed on this machine", name)
			}
			m, rec := newTestManager(t)
			require.NoError(t, os.WriteFile(filepath.Join(os.Getenv("HOME"), ".zshrc"), nil, 0o600), "zsh asks a user with no startup file to set one up")
			info, startErr := m.Start(Options{Command: []string{path, "-c", "echo a-$(pwd)-a; echo b-$(pwd -P)-b; cd .; echo c-$(pwd -P)-c; echo d-$(pwd)-d; echo end"}, Cwd: requested}, nil)
			require.NoError(t, startErr)
			text := rec.waitFor(t, info.ID, "end")
			assert.Contains(t, text, "a-"+data+"-a", "pwd")
			assert.Contains(t, text, "b-"+data+"-b", "pwd -P")
			assert.Contains(t, text, "c-"+data+"-c", "pwd -P after cd .")
			assert.Contains(t, text, "d-"+data+"-d", "pwd after cd .")
		})
	}
}
