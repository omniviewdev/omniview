// internal/appstate/scoped.go
package appstate

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// ScopedRoot provides contained filesystem access to a subdirectory.
// All path arguments are relative to the scope root. The underlying os.Root
// enforces containment at the kernel level.
type ScopedRoot struct {
	root *os.Root // kernel-enforced containment
	path string   // absolute path for ResolvePath / logging
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
	return &ScopedRoot{root: r, path: dir}, nil
}

// openExistingScopedRoot opens an os.Root at dir without creating it.
// A missing directory returns an error satisfying errors.Is(err, fs.ErrNotExist).
func openExistingScopedRoot(dir string) (*ScopedRoot, error) {
	r, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("appstate: open root %q: %w", dir, err)
	}
	return &ScopedRoot{root: r, path: dir}, nil
}

// Close releases the underlying os.Root handle.
func (s *ScopedRoot) Close() error {
	return s.root.Close()
}

// rootLiveness says how a cached root relates to the directory at its path.
type rootLiveness int

const (
	// rootLive: the root holds the directory at its path.
	rootLive rootLiveness = iota
	// rootAway: the path names nothing, and neither does the directory above it.
	// The plugin was uninstalled, or is part-way through an uninstall or an
	// archive replacement, either of which may move the directory back.
	rootAway
	// rootStale: the root is closed, or the directory it holds was removed or
	// replaced while the directory above its path exists.
	rootStale
)

// liveness compares the directory this root holds open with the one at its
// path. A removed or replaced directory stays reachable through the root, but no
// path names it any more. Only a different directory at the path, or a missing
// path under a directory that exists, shows that the held directory is gone. A
// path that cannot be inspected says nothing, and the root, which does not
// resolve the path, keeps working.
func (s *ScopedRoot) liveness() rootLiveness {
	held, err := s.root.Stat(".")
	if err != nil {
		return rootStale // Closed, or no longer a usable directory.
	}
	live, err := os.Stat(s.path)
	switch {
	case err == nil:
		if os.SameFile(held, live) {
			return rootLive
		}
		return rootStale
	case !errors.Is(err, fs.ErrNotExist):
		return rootLive
	}
	if _, parentErr := os.Stat(filepath.Dir(s.path)); parentErr != nil {
		return rootAway
	}
	return rootStale
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
	return s.root.ReadFile(name)
}

func (s *ScopedRoot) WriteFile(name string, data []byte, perm fs.FileMode) error {
	if err := validate(name); err != nil {
		return err
	}
	return s.root.WriteFile(name, data, perm)
}

func (s *ScopedRoot) OpenFile(name string, flag int, perm fs.FileMode) (*os.File, error) {
	if err := validate(name); err != nil {
		return nil, err
	}
	return s.root.OpenFile(name, flag, perm)
}

func (s *ScopedRoot) MkdirAll(path string, perm fs.FileMode) error {
	if err := validate(path); err != nil {
		return err
	}
	return s.root.MkdirAll(path, perm)
}

// OpenRoot opens a separately owned child handle with kernel-enforced containment.
// Closing the returned handle does not close this scope.
func (s *ScopedRoot) OpenRoot(name string) (*os.Root, error) {
	if err := validate(name); err != nil {
		return nil, err
	}
	return s.root.OpenRoot(name)
}

func (s *ScopedRoot) Remove(name string) error {
	if err := validate(name); err != nil {
		return err
	}
	return s.root.Remove(name)
}

func (s *ScopedRoot) RemoveAll(name string) error {
	if err := validate(name); err != nil {
		return err
	}
	if name == "." {
		return fmt.Errorf("appstate: refusing to remove root directory via RemoveAll(%q)", name)
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

	return os.RemoveAll(target)
}

func (s *ScopedRoot) Stat(name string) (fs.FileInfo, error) {
	if err := validate(name); err != nil {
		return nil, err
	}
	return s.root.Stat(name)
}

func (s *ScopedRoot) Rename(oldpath, newpath string) error {
	if err := validate(oldpath); err != nil {
		return err
	}
	if err := validate(newpath); err != nil {
		return err
	}
	return s.root.Rename(oldpath, newpath)
}

// ReadDir reads the named directory relative to the scoped root.
// Implemented as Open + (*File).ReadDir since os.Root does not expose ReadDir.
func (s *ScopedRoot) ReadDir(name string) ([]fs.DirEntry, error) {
	if err := validate(name); err != nil {
		return nil, err
	}
	f, err := s.root.Open(name)
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
	if name == "" {
		return s.path
	}
	if err := validate(name); err != nil {
		return s.path
	}
	return filepath.Join(s.path, filepath.FromSlash(name))
}

func (s *ScopedRoot) FS() fs.FS {
	return s.root.FS()
}
