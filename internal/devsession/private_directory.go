package devsession

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// ValidatePrivateDirectory checks an existing directory without adopting it or
// repairing its permissions. Redirected ancestors and non-directory leaves are
// refused using the same platform ownership policy as private runtime files.
func ValidatePrivateDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%w: runtime path is not a real directory", ErrOwnership)
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	canonical, err := devcontract.CanonicalPath(absolute)
	if err != nil {
		return err
	}
	if canonical != absolute {
		return fmt.Errorf("%w: runtime directory is redirected", ErrOwnership)
	}
	return checkPrivatePath(path, info)
}
