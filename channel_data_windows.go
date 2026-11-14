package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/instance"
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
	current, err := os.Lstat(path)
	return err == nil && current.Mode().IsRegular() && os.SameFile(pinned, current)
}

func windowsBusy(err error) bool {
	return errors.Is(err, windows.ERROR_LOCK_VIOLATION) || errors.Is(err, windows.ERROR_SHARING_VIOLATION)
}

func profileLockStatus(root string) string {
	lockPath := filepath.Join(root, ".lock")
	lock, err := openWindowsLock(lockPath, false)
	if windowsBusy(err) {
		return "in-use"
	}
	if err != nil {
		return "unknown"
	}
	defer lock.Close()
	if !windowsLockMatches(lockPath, lock) {
		return "unknown"
	}
	guardPath, err := instance.SwitchProfileGuardPath(root)
	if err != nil {
		return "unknown"
	}
	guard, err := openWindowsLock(guardPath, false)
	if windowsBusy(err) {
		return "in-use"
	}
	if err != nil {
		return "unknown"
	}
	defer guard.Close()
	if !windowsLockMatches(guardPath, guard) {
		return "unknown"
	}
	return "not-in-use"
}

func deleteInactiveProfile(path string, expected os.FileInfo) error {
	return deleteInactiveProfileWithRemove(path, expected, os.RemoveAll)
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
	defer os.Remove(quarantine)
	isolated := filepath.Join(quarantine, "profile")
	if err := os.Rename(path, isolated); err != nil {
		return fmt.Errorf("isolate channel data: %w", err)
	}
	current, err = os.Lstat(isolated)
	if err != nil || !current.IsDir() || !os.SameFile(expected, current) || !windowsLockMatches(filepath.Join(isolated, ".lock"), lock) {
		if _, statErr := os.Lstat(path); !os.IsNotExist(statErr) {
			return fmt.Errorf("channel data changed during isolation; retained at %s", isolated)
		}
		restoreErr := os.Rename(isolated, path)
		return errors.Join(fmt.Errorf("channel data or lock changed during isolation; retained at %s if restore failed", isolated), restoreErr)
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
