// internal/appstate/scoped.go
package appstate

import (
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

// Close releases the underlying os.Root handle.
func (s *ScopedRoot) Close() error {
	return s.root.Close()
}

// validate checks that name is a safe relative path.
func validate(name string) error {
	if name == "" {
		return fmt.Errorf("appstate: empty path not allowed")
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
