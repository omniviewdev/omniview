//go:build unix

package linkresolve_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/linkresolve"
)

// seenFS is the host's file system that remembers every path it was asked about, and can hold a path until a test lets it go.
type seenFS struct {
	mu      sync.Mutex
	seen    []string
	entries int
	hold    func(path string) <-chan struct{}
	done    sync.WaitGroup
}

func (f *seenFS) note(p string) {
	f.mu.Lock()
	f.seen = append(f.seen, p)
	f.mu.Unlock()
}

func (f *seenFS) wait(p string) {
	if f.hold == nil {
		return
	}
	if gate := f.hold(p); gate != nil {
		f.done.Add(1)
		defer f.done.Done()
		<-gate
	}
}

func (f *seenFS) Lstat(p string) (fs.FileInfo, error) {
	f.note(p)
	f.wait(p)
	return os.Lstat(p)
}

func (f *seenFS) Readlink(p string) (string, error) {
	f.note(p)
	f.wait(p)
	return os.Readlink(p)
}

func (f *seenFS) ReadDir(p string, n int) ([]fs.DirEntry, error) {
	f.note(p)
	f.wait(p)
	out, err := linkresolve.OSFS{}.ReadDir(p, n)
	f.mu.Lock()
	f.entries += len(out)
	f.mu.Unlock()
	return out, err
}

func (f *seenFS) paths() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.seen...)
}

func (f *seenFS) count() int { return len(f.paths()) }

// touched says whether any path under one of the prefixes was looked at.
func (f *seenFS) touched(prefixes ...string) (string, bool) {
	for _, p := range f.paths() {
		for _, prefix := range prefixes {
			if p == prefix || strings.HasPrefix(p, prefix+"/") {
				return p, true
			}
		}
	}
	return "", false
}

// tree makes a directory of files (a trailing slash makes a directory) under a real path, and returns it.
func tree(t *testing.T, files ...string) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	for _, name := range files {
		full := filepath.Join(root, name)
		if strings.HasSuffix(name, "/") {
			require.NoError(t, os.MkdirAll(full, 0o750))
			continue
		}
		require.NoError(t, os.MkdirAll(filepath.Dir(full), 0o750))
		require.NoError(t, os.WriteFile(full, []byte("x"), 0o600))
	}
	return root
}

func resolver(t *testing.T, cfg linkresolve.Config) (*linkresolve.Resolver, *seenFS) {
	t.Helper()
	seen := &seenFS{}
	cfg.FS = seen
	return linkresolve.New(cfg), seen
}

// within runs the call and fails the test if it does not return in a generous bound: the guard against a call that hangs, not a measure.
func within(t *testing.T, what string, call func() linkresolve.Result) linkresolve.Result {
	t.Helper()
	out := make(chan linkresolve.Result, 1)
	go func() { out <- call() }()
	select {
	case got := <-out:
		return got
	case <-time.After(20 * time.Second):
		t.Fatalf("%s: the call did not return", what)
		return linkresolve.Result{}
	}
}
