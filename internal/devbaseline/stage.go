package devbaseline

import (
	"fmt"
	"os"
	"path/filepath"
)

// ownedStage retains an opened directory, not just a reusable pathname. Cleanup
// traverses that descriptor only, and never touches a replacement at the name.
type ownedStage struct {
	path      string
	root      *os.Root
	identity  os.FileInfo
	published bool
}

func newOwnedStage(parent, prefix string) (*ownedStage, error) {
	path, err := os.MkdirTemp(parent, prefix)
	if err != nil {
		return nil, err
	}
	identity, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	// Go's Windows top-level OpenRoot omits FILE_SHARE_DELETE, preventing rename
	// and removal while retained. Root.OpenRoot uses descriptor-relative Openat
	// with delete sharing on the supported Go 1.26 toolchain. Close the temporary
	// parent before publishing, retaining only the rename-safe owned child Root.
	parentRoot, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	root, err := parentRoot.OpenRoot(filepath.Base(path))
	parentCloseErr := parentRoot.Close()
	if err != nil {
		return nil, err
	}
	if parentCloseErr != nil {
		_ = root.Close()
		return nil, parentCloseErr
	}
	opened, err := root.Stat(".")
	if err != nil {
		_ = root.Close()
		return nil, err
	}
	if !identity.IsDir() || !os.SameFile(identity, opened) {
		_ = root.Close()
		return nil, fmt.Errorf("baseline: private stage changed identity")
	}
	return &ownedStage{path: path, root: root, identity: identity}, nil
}

func (s *ownedStage) disarm() { s.published = true }

func (s *ownedStage) cleanup() error {
	defer s.root.Close()
	if s.published {
		return nil
	}
	current, err := os.Lstat(s.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !os.SameFile(s.identity, current) {
		return nil
	}
	directory, err := s.root.Open(".")
	if err != nil {
		return err
	}
	entries, readErr := directory.ReadDir(-1)
	closeErr := directory.Close()
	if readErr != nil {
		return readErr
	}
	if closeErr != nil {
		return closeErr
	}
	for _, entry := range entries {
		if err := s.root.RemoveAll(entry.Name()); err != nil {
			return err
		}
	}
	// A concurrent rename can change the name while descriptor-relative cleanup
	// runs. Recheck before removing the now-empty name; os.Remove never recursively
	// traverses a replacement and refuses any nonempty replacement directory.
	current, err = os.Lstat(s.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !os.SameFile(s.identity, current) {
		return nil
	}
	return os.Remove(s.path)
}
