package appstate

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestScopedRoot(t *testing.T) *ScopedRoot {
	t.Helper()
	dir := t.TempDir()
	r, err := newScopedRoot(dir)
	require.NoError(t, err)
	t.Cleanup(func() { r.Close() })
	return r
}

func TestScopedRoot_WriteAndReadFile(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	require.NoError(t, r.WriteFile("test.txt", []byte("hello world"), 0644))
	got, err := r.ReadFile("test.txt")
	require.NoError(t, err)
	assert.Equal(t, "hello world", string(got))
}

func TestScopedRoot_MkdirAll(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	require.NoError(t, r.MkdirAll("a/b/c", 0755))
	require.NoError(t, r.WriteFile("a/b/c/file.txt", []byte("nested"), 0644))
}

func TestScopedRoot_Stat(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	require.NoError(t, r.WriteFile("exists.txt", []byte("data"), 0644))
	info, err := r.Stat("exists.txt")
	require.NoError(t, err)
	assert.Equal(t, int64(4), info.Size())
	_, err = r.Stat("nope.txt")
	assert.Error(t, err)
}

func TestScopedRoot_Remove(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	require.NoError(t, r.WriteFile("delete-me.txt", []byte("bye"), 0644))
	require.NoError(t, r.Remove("delete-me.txt"))
	_, err := r.Stat("delete-me.txt")
	assert.Error(t, err, "file should be gone after Remove")
}

func TestScopedRoot_Rename(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	require.NoError(t, r.WriteFile("old.tmp", []byte("atomic"), 0644))
	require.NoError(t, r.Rename("old.tmp", "new.json"))
	got, err := r.ReadFile("new.json")
	require.NoError(t, err)
	assert.Equal(t, "atomic", string(got))
	_, err = r.Stat("old.tmp")
	assert.Error(t, err, "old name should not exist after Rename")
}

func TestScopedRoot_ReadDir(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	require.NoError(t, r.WriteFile("a.txt", []byte("a"), 0644))
	require.NoError(t, r.WriteFile("b.txt", []byte("b"), 0644))
	entries, err := r.ReadDir(".")
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(entries), 2)
}

func TestScopedRoot_OpenFile(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	f, err := r.OpenFile("rw.txt", os.O_CREATE|os.O_RDWR, 0600)
	require.NoError(t, err)
	f.Close()
	info, err := r.Stat("rw.txt")
	require.NoError(t, err)
	assert.Equal(t, fs.FileMode(0600), info.Mode().Perm())
}

func TestScopedRoot_ResolvePath(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	r, err := newScopedRoot(dir)
	require.NoError(t, err)
	t.Cleanup(func() { r.Close() })
	assert.Equal(t, filepath.Join(dir, "logs", "app.log"), r.ResolvePath("logs/app.log"))
}

func TestScopedRoot_FS(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	require.NoError(t, r.WriteFile("readme.txt", []byte("hello"), 0644))
	data, err := fs.ReadFile(r.FS(), "readme.txt")
	require.NoError(t, err)
	assert.Equal(t, "hello", string(data))
}

// Containment tests
func TestScopedRoot_RejectsAbsolutePath(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	_, err := r.ReadFile("/etc/passwd")
	assert.Error(t, err, "ReadFile should reject absolute paths")
}

func TestScopedRoot_RejectsTraversal(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	_, err := r.ReadFile("../../../etc/passwd")
	assert.Error(t, err, "ReadFile should reject path traversal")
}

func TestScopedRoot_RejectsTraversalInMiddle(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	_, err := r.ReadFile("subdir/../../etc/passwd")
	assert.Error(t, err, "ReadFile should reject traversal in middle of path")
}

func TestScopedRoot_RemoveAll(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	require.NoError(t, r.MkdirAll("a/b/c", 0755))
	require.NoError(t, r.WriteFile("a/b/c/file.txt", []byte("data"), 0644))
	require.NoError(t, r.RemoveAll("a"))
	_, err := r.Stat("a")
	assert.Error(t, err, "directory should be gone after RemoveAll")
}

func TestScopedRoot_RemoveAll_RejectsTraversal(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	assert.Error(t, r.RemoveAll("../escape"), "RemoveAll should reject path traversal")
}

func TestScopedRoot_Rename_RejectsTraversal(t *testing.T) {
	t.Parallel()
	r := newTestScopedRoot(t)
	require.NoError(t, r.WriteFile("safe.txt", []byte("data"), 0644))
	assert.Error(t, r.Rename("safe.txt", "../escaped.txt"), "Rename should reject traversal in newpath")
}

func TestScopedRoot_RemoveAll_SymlinkEscape(t *testing.T) {
	t.Parallel()

	// Create a target directory outside the scoped root.
	externalDir := t.TempDir()
	externalFile := filepath.Join(externalDir, "precious.txt")
	require.NoError(t, os.WriteFile(externalFile, []byte("do not delete"), 0644))

	// Create a scoped root with a symlink pointing outside.
	r := newTestScopedRoot(t)
	linkPath := r.ResolvePath("escape-link")
	require.NoError(t, os.Symlink(externalDir, linkPath))

	// RemoveAll on the symlink path should fail containment check.
	err := r.RemoveAll("escape-link")
	assert.Error(t, err, "RemoveAll should reject symlink that escapes the scope")

	// The external directory and its contents must still exist.
	_, err = os.Stat(externalDir)
	assert.NoError(t, err, "external directory should still exist after blocked RemoveAll")
	_, err = os.Stat(externalFile)
	assert.NoError(t, err, "external file should still exist after blocked RemoveAll")
}
