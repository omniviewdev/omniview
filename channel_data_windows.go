package main

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// openWindowsLock opens the lock itself rather than following a reparse point.
// Sharing deletion allows the isolated profile to be removed while it is locked.
func openWindowsLock(path string, create bool) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	disposition := uint32(windows.OPEN_EXISTING)
	if create {
		disposition = windows.OPEN_ALWAYS
	}
	h, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		disposition, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	var info windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(h, &info); err != nil {
		windows.CloseHandle(h)
		return nil, err
	}
	if info.FileAttributes&(windows.FILE_ATTRIBUTE_REPARSE_POINT|windows.FILE_ATTRIBUTE_DIRECTORY) != 0 {
		windows.CloseHandle(h)
		return nil, fmt.Errorf("profile lock is not a regular file")
	}
	if err = windows.LockFileEx(h, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &windows.Overlapped{}); err != nil {
		windows.CloseHandle(h)
		return nil, err
	}
	return os.NewFile(uintptr(h), path), nil
}

func windowsLockMatches(path string, lock *os.File) bool {
	pinned, err := lock.Stat()
	if err != nil {
		return false
	}
	current, _, err := windowsFileIdentity(path)
	return err == nil && current.Mode().IsRegular() && os.SameFile(pinned, current)
}

// Probing with an exclusive lock can cause a concurrent profile startup to fail.
func profileLockStatus(string) string { return "unknown" }

func windowsFileIdentity(path string) (os.FileInfo, uint32, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, 0, err
	}
	h, err := windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, 0, err
	}
	f := os.NewFile(uintptr(h), path)
	defer f.Close()
	var attrs windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(h, &attrs); err != nil {
		return nil, 0, err
	}
	info, err := f.Stat()
	return info, attrs.FileAttributes, err
}

func captureProfileIdentity(path string) (os.FileInfo, error) {
	info, attributes, err := windowsFileIdentity(path)
	if err != nil {
		return nil, err
	}
	if attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || attributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
		return nil, fmt.Errorf("channel data must be a directory, not a reparse point")
	}
	return info, nil
}

func openProfileIdentity(path string) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	var data windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(h, &data); err != nil {
		windows.CloseHandle(h)
		return nil, err
	}
	if data.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || data.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
		windows.CloseHandle(h)
		return nil, fmt.Errorf("channel data must be a directory, not a reparse point")
	}
	return os.NewFile(uintptr(h), path), nil
}

func deleteInactiveProfile(path string, expected os.FileInfo) error {
	return deleteInactiveProfileWithRemove(path, expected, func(path string) error {
		return removeIsolatedProfile(path, expected)
	})
}

func deleteInactiveProfileWithRemove(path string, expected os.FileInfo, removeAll func(string) error) error {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	attributes, err := windows.GetFileAttributes(name)
	if err != nil || attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("channel data is inaccessible or a reparse point: %v", err)
	}
	lockPath := filepath.Join(path, ".lock")
	lock, err := openWindowsLock(lockPath, true)
	if err != nil {
		return fmt.Errorf("acquire channel data lock: %w", err)
	}
	defer lock.Close()
	current, err := os.Lstat(path)
	if err != nil || !current.IsDir() || !os.SameFile(expected, current) || !windowsLockMatches(lockPath, lock) {
		return fmt.Errorf("channel data or lock changed while acquiring ownership")
	}
	quarantine, err := os.MkdirTemp(filepath.Dir(path), ".omniview-delete-*")
	if err != nil {
		return fmt.Errorf("create channel data quarantine: %w", err)
	}
	isolated := filepath.Join(quarantine, "profile")
	if err := os.Rename(path, isolated); err != nil {
		return fmt.Errorf("isolate channel data: %w", err)
	}
	current, err = os.Lstat(isolated)
	if err != nil || !current.IsDir() || !os.SameFile(expected, current) || !windowsLockMatches(filepath.Join(isolated, ".lock"), lock) {
		return fmt.Errorf("channel data or lock changed during isolation; retained at %s", isolated)
	}
	// The quarantined path is no longer discoverable by profile startup. Windows
	// cannot remove its directory while our own lock handle remains open.
	if err := lock.Close(); err != nil {
		return fmt.Errorf("release isolated channel data lock at %s: %w", isolated, err)
	}
	if err := removeAll(isolated); err != nil {
		return fmt.Errorf("delete isolated channel data at %s: %w", isolated, err)
	}
	return nil
}
