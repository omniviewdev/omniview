//go:build !windows && !linux && !darwin

package appstate

import (
	"errors"
	"fmt"
	"os"
	"runtime"
)

func filesystemIdentity(file *os.File) (FilesystemIdentity, error) {
	return FilesystemIdentity{}, fmt.Errorf("appstate: durable owned filesystem identity on %s: %w", runtime.GOOS, errors.ErrUnsupported)
}

func renameDirectoryNoReplace(root *os.Root, oldpath, newpath string) error {
	return fmt.Errorf("appstate: atomic directory rename without replacement on %s: %w", runtime.GOOS, errors.ErrUnsupported)
}
