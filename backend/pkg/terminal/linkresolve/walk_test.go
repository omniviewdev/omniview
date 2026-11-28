//go:build unix

package linkresolve

import (
	"context"
	"io/fs"
	"os"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

type lookedFS struct {
	mu   sync.Mutex
	seen []string
}

func (f *lookedFS) Lstat(p string) (fs.FileInfo, error) {
	f.mu.Lock()
	f.seen = append(f.seen, p)
	f.mu.Unlock()
	return os.Lstat(p)
}
func (f *lookedFS) Readlink(p string) (string, error)              { return os.Readlink(p) }
func (f *lookedFS) ReadDir(p string, n int) ([]fs.DirEntry, error) { return OSFS{}.ReadDir(p, n) }

func TestAWalkWithNoDirectoriesLooksAtNothing(t *testing.T) {
	dir := t.TempDir()
	files := &lookedFS{}
	r := New(Config{FS: files})
	c := newCall(context.Background(), r)
	for _, allowed := range [][]string{nil, {}} {
		_, _, reason := c.real(dir, allowed)
		assert.Equal(t, ReasonOutside, reason)
	}
	assert.Empty(t, files.seen, "no directory is allowed: nothing is looked at")
	// the control: with the directory allowed, the walk looks
	_, _, reason := c.real(dir, []string{dir})
	assert.Empty(t, reason)
	assert.NotEmpty(t, files.seen)
}
