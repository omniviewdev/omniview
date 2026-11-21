// internal/appstate/scoped.go
package appstate

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// ScopedRoot provides contained filesystem access to a subdirectory.
// All path arguments are relative to the scope root. The underlying os.Root
// enforces containment at the kernel level.
//
// A holder may keep a ScopedRoot for as long as it likes. When the plugin manager
// moves the directory a cached plugin root is open on, through the plugins root,
// the service closes the handle for the move and opens it again where the
// directory went (see Service.relocate), under the same *ScopedRoot: the holder
// notices nothing but a wait.
type ScopedRoot struct {
	// mu is read-locked by every operation and write-locked while the service
	// moves the directory, the only time root and path change.
	mu   sync.RWMutex
	root *os.Root // kernel-enforced containment
	path string   // absolute path for ResolvePath / logging; follows the directory
	// relocator is set on the plugins root only: it is told before a directory
	// moves or goes, so that the roots open beneath it can let go.
	relocator relocator
}

// relocator is what the plugins root asks of the service around the moves and
// removals of the directories it owns.
type relocator interface {
	// relocate runs move, which renames the directory oldname to newname, with
	// every cached root beneath oldname closed, and opens them again afterwards.
	relocate(oldname, newname string, move func() error) error
	// remove closes and forgets every cached root beneath name, then runs remove,
	// which deletes it.
	remove(name string, remove func() error) error
}

// acquire returns the open root and the function that ends the operation. The
// holder of an operation is read-locked, so the root is not swapped under it.
func (s *ScopedRoot) acquire() (*os.Root, func()) {
	s.mu.RLock()
	return s.root, s.mu.RUnlock
}

// newScopedRoot opens an os.Root at dir and returns a ScopedRoot.
// The directory is created if it does not exist.
func newScopedRoot(dir string) (*ScopedRoot, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("appstate: create directory %q: %w", dir, err)
	}
	r, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("appstate: open root %q: %w", dir, err)
	}
	return &ScopedRoot{mu: sync.RWMutex{}, root: r, path: dir, relocator: nil}, nil
}

// openExistingScopedRoot opens an os.Root at dir without creating it.
// A missing directory returns an error satisfying errors.Is(err, fs.ErrNotExist).
func openExistingScopedRoot(dir string) (*ScopedRoot, error) {
	r, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("appstate: open root %q: %w", dir, err)
	}
	return &ScopedRoot{mu: sync.RWMutex{}, root: r, path: dir, relocator: nil}, nil
}

// Close releases the underlying os.Root handle, after the operations in flight.
func (s *ScopedRoot) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.root.Close()
}

// validate checks that name is a safe relative path.
func validate(name string) error {
	if name == "" {
		return errors.New("appstate: empty path not allowed")
	}
	if filepath.IsAbs(name) {
		return fmt.Errorf("appstate: absolute path not allowed: %q", name)
	}
	for part := range strings.SplitSeq(filepath.ToSlash(name), "/") {
		if part == ".." {
			return fmt.Errorf("appstate: path traversal not allowed: %q", name)
		}
	}
	return nil
}

func (s *ScopedRoot) ReadFile(name string) ([]byte, error) {
	if err := validate(name); err != nil {
		return nil, err
	}
	root, done := s.acquire()
	defer done()
	return root.ReadFile(name)
}

func (s *ScopedRoot) WriteFile(name string, data []byte, perm fs.FileMode) error {
	if err := validate(name); err != nil {
		return err
	}
	root, done := s.acquire()
	defer done()
	return root.WriteFile(name, data, perm)
}

// OpenFile opens a file. A file the caller keeps open is the caller's to close
// before the plugin's directory moves: Windows refuses to move a directory that
// has an open file beneath it.
func (s *ScopedRoot) OpenFile(name string, flag int, perm fs.FileMode) (*os.File, error) {
	if err := validate(name); err != nil {
		return nil, err
	}
	root, done := s.acquire()
	defer done()
	return root.OpenFile(name, flag, perm)
}

func (s *ScopedRoot) MkdirAll(path string, perm fs.FileMode) error {
	if err := validate(path); err != nil {
		return err
	}
	root, done := s.acquire()
	defer done()
	return root.MkdirAll(path, perm)
}

// OpenRoot opens a separately owned child handle with kernel-enforced containment.
// Closing the returned handle does not close this scope. The child is the
// caller's: it does not follow this root when the service moves the directory,
// and Windows refuses to move a directory while a handle is open beneath it.
func (s *ScopedRoot) OpenRoot(name string) (*os.Root, error) {
	if err := validate(name); err != nil {
		return nil, err
	}
	root, done := s.acquire()
	defer done()
	return root.OpenRoot(name)
}

func (s *ScopedRoot) Remove(name string) error {
	if err := validate(name); err != nil {
		return err
	}
	root, done := s.acquire()
	defer done()
	return root.Remove(name)
}

func (s *ScopedRoot) RemoveAll(name string) error {
	if err := validate(name); err != nil {
		return err
	}
	if name == "." {
		return fmt.Errorf("appstate: refusing to remove root directory via RemoveAll(%q)", name)
	}
	root, done := s.acquire()
	defer done()

	// RemoveAll resolves a path instead of going through the root's handle. A root
	// that was closed, as a released root is, must not reach whatever directory is
	// now at that path: a reinstall of the plugin may have created a new one.
	if _, statErr := root.Stat("."); errors.Is(statErr, os.ErrClosed) {
		return statErr
	}

	target := filepath.Join(s.path, filepath.FromSlash(name))

	// Resolve symlinks and verify the resolved path is still within the
	// scoped root to prevent symlink escape attacks.
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // already gone
		}
		return fmt.Errorf("appstate: resolve symlinks for %q: %w", name, err)
	}

	// Ensure the resolved path is contained within the scoped root.
	resolvedRoot, err := filepath.EvalSymlinks(s.path)
	if err != nil {
		return fmt.Errorf("appstate: resolve root path: %w", err)
	}
	if !strings.HasPrefix(resolved, resolvedRoot+string(filepath.Separator)) && resolved != resolvedRoot {
		return fmt.Errorf("appstate: RemoveAll %q resolves to %q which is outside scope %q", name, resolved, s.path)
	}

	return s.removing(name, func() error { return os.RemoveAll(target) })
}

func (s *ScopedRoot) Stat(name string) (fs.FileInfo, error) {
	if err := validate(name); err != nil {
		return nil, err
	}
	root, done := s.acquire()
	defer done()
	return root.Stat(name)
}

func (s *ScopedRoot) Rename(oldpath, newpath string) error {
	if err := validate(oldpath); err != nil {
		return err
	}
	if err := validate(newpath); err != nil {
		return err
	}
	root, done := s.acquire()
	defer done()
	return s.relocating(oldpath, newpath, func() error { return root.Rename(oldpath, newpath) })
}

// relocating runs move, which renames oldpath to newpath, after the service has
// closed the roots open beneath oldpath, and has them opened again where the
// directory went. Without a relocator it just runs move.
func (s *ScopedRoot) relocating(oldpath, newpath string, move func() error) error {
	if s.relocator == nil {
		return move()
	}
	return s.relocator.relocate(oldpath, newpath, move)
}

// removing runs remove, which deletes name, after the service has closed and
// forgotten the roots open beneath it. Without a relocator it just runs remove.
func (s *ScopedRoot) removing(name string, remove func() error) error {
	if s.relocator == nil {
		return remove()
	}
	return s.relocator.remove(name, remove)
}

// ReadDir reads the named directory relative to the scoped root.
// Implemented as Open + (*File).ReadDir since os.Root does not expose ReadDir.
func (s *ScopedRoot) ReadDir(name string) ([]fs.DirEntry, error) {
	if err := validate(name); err != nil {
		return nil, err
	}
	root, done := s.acquire()
	defer done()
	f, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return f.ReadDir(-1)
}

// ResolvePath returns the absolute path for a relative name within the scoped root.
// If name is empty, the root path itself is returned. If name fails validation
// (e.g. absolute path or traversal), the root path is returned as a safe fallback.
func (s *ScopedRoot) ResolvePath(name string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if name == "" {
		return s.path
	}
	if err := validate(name); err != nil {
		return s.path
	}
	return filepath.Join(s.path, filepath.FromSlash(name))
}

// FS returns a read-only view of the directory. It stays valid when the service
// moves the directory, like the root itself; a file it opens does not.
func (s *ScopedRoot) FS() fs.FS {
	return scopedFS{root: s}
}

// scopedFS is the fs.FS of a ScopedRoot. It resolves the root's open handle on
// every call, so that a view taken before the directory moved reads it where it
// is now. os.Root's own FS implements the same three optional interfaces.
type scopedFS struct {
	root *ScopedRoot
}

var (
	_ fs.ReadFileFS = scopedFS{}
	_ fs.ReadDirFS  = scopedFS{}
	_ fs.StatFS     = scopedFS{}
)

func (v scopedFS) Open(name string) (fs.File, error) {
	root, done := v.root.acquire()
	defer done()
	return root.FS().Open(name)
}

func (v scopedFS) ReadFile(name string) ([]byte, error) {
	root, done := v.root.acquire()
	defer done()
	return fs.ReadFile(root.FS(), name)
}

func (v scopedFS) ReadDir(name string) ([]fs.DirEntry, error) {
	root, done := v.root.acquire()
	defer done()
	return fs.ReadDir(root.FS(), name)
}

func (v scopedFS) Stat(name string) (fs.FileInfo, error) {
	root, done := v.root.acquire()
	defer done()
	return fs.Stat(root.FS(), name)
}
