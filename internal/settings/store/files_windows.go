//go:build windows

package store

import (
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// syncDir does nothing: Windows has no directory flush. NTFS journals directory
// changes, and renameDurably asks for each rename to reach the disk before it
// returns.
func syncDir(string) error {
	return nil
}

// directoryFlushes is true: a rename is flushed by MOVEFILE_WRITE_THROUGH.
func directoryFlushes(string) bool {
	return true
}

// extendedLengthPath returns the path in the form Win32 accepts beyond MAX_PATH:
// absolute, with the \\?\ prefix (\\?\UNC\ for a network path).
func extendedLengthPath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	switch {
	case strings.HasPrefix(absolute, `\\?\`):
		return absolute, nil
	case strings.HasPrefix(absolute, `\\`):
		return `\\?\UNC\` + absolute[2:], nil
	default:
		return `\\?\` + absolute, nil
	}
}

// renameDurably renames a file, replacing any file at the new name, and returns
// when the rename is on the disk. Neither name may be open: Windows will not move
// or replace a file that has a handle open on it, which is why the store closes
// its database before it renames and opens it again after.
func renameDurably(from, to string) error {
	fromPath, err := extendedLengthPath(from)
	if err != nil {
		return err
	}
	toPath, err := extendedLengthPath(to)
	if err != nil {
		return err
	}
	fromName, err := windows.UTF16PtrFromString(fromPath)
	if err != nil {
		return err
	}
	toName, err := windows.UTF16PtrFromString(toPath)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(fromName, toName, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
