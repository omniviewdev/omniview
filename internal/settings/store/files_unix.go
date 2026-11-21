//go:build unix

package store

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// syncDir flushes a directory's entries to the disk, so that a rename or a
// removal made in it survives a crash. A file system that cannot flush a
// directory says so with EINVAL or ENOTSUP: there is nothing more to do there.
func syncDir(dir string) error {
	handle, err := os.Open(dir)
	if err != nil {
		return err
	}
	syncErr := handle.Sync()
	closeErr := handle.Close()
	if syncErr != nil && !errors.Is(syncErr, syscall.EINVAL) && !errors.Is(syncErr, syscall.ENOTSUP) {
		return syncErr
	}
	return closeErr
}

// directoryFlushes reports whether the directory can be flushed to the disk. A
// file system that cannot says so with EINVAL or ENOTSUP, and a rename made there
// is not provably on the disk.
func directoryFlushes(dir string) bool {
	handle, err := os.Open(dir)
	if err != nil {
		return false
	}
	syncErr := handle.Sync()
	_ = handle.Close()
	return syncErr == nil
}

// renameDurably renames a file, replacing any file at the new name, and flushes
// the directory. The rename is atomic: a crash leaves the old name or the new.
func renameDurably(from, to string) error {
	if err := os.Rename(from, to); err != nil {
		return err
	}
	return syncDir(filepath.Dir(to))
}
