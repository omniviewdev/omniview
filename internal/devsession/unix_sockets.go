package devsession

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

// ValidateUnixSocketDirectoriesRemoved is a read-only removal preflight. Even a
// malformed or interrupted record must survive: it may be the last provenance
// for an external namespace whose descendants have not been disposed.
func ValidateUnixSocketDirectoriesRemoved(runtimeRoot string) error {
	if _, err := os.Lstat(runtimeRoot); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err := ValidatePrivateDirectory(runtimeRoot); err != nil {
		return err
	}
	entries, err := os.ReadDir(runtimeRoot)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "unix-sockets-") {
			return fmt.Errorf("%w: retained Unix socket ownership must be disposed before removing the profile", ErrOwnership)
		}
	}
	return nil
}
