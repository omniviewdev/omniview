package devsession

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CreatePrivateDirectoryAt exclusively creates one current-user-only directory
// relative to a retained parent handle and returns the created object. It never
// repairs, adopts, or changes an existing child. The caller closes the returned
// handle and owns the parent capability and namespace checks.
func CreatePrivateDirectoryAt(parent *os.File, name string) (*os.File, error) {
	if parent == nil || !filepath.IsLocal(name) || filepath.Base(name) != name || name == "." || strings.ContainsAny(name, "/\\:\x00") {
		return nil, fmt.Errorf("%w: private directory name must be one leaf", ErrOwnership)
	}
	info, err := parent.Stat()
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("%w: private directory parent is not a directory handle", ErrOwnership)
	}
	return createPrivateDirectoryAt(parent, name)
}
