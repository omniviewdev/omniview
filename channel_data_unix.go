//go:build linux || darwin

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/instance"

	"golang.org/x/sys/unix"
)

// openProfileLock pins the lock inode without following a link. The caller
// must verify that the directory and lock still identify the expected objects.
func openProfileLock(root string, create bool) (*os.File, error) {
	return openLock(filepath.Join(root, ".lock"), create)
}

func openLock(path string, create bool) (*os.File, error) {
	flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW
	if create {
		flags = unix.O_RDWR | unix.O_CREAT | unix.O_CLOEXEC | unix.O_NOFOLLOW
	}
	fd, err := unix.Open(path, flags, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("profile lock is not a regular file")
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func lockMatches(root string, lock *os.File) bool {
	pinned, err := lock.Stat()
	if err != nil {
		return false
	}
	current, err := os.Lstat(filepath.Join(root, ".lock"))
	return err == nil && current.Mode().IsRegular() && os.SameFile(pinned, current)
}

func profileLockStatus(root string) string {
	lock, err := openProfileLock(root, false)
	if errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN) {
		return "in-use"
	}
	if err != nil {
		return "unknown"
	}
	defer lock.Close()
	if !lockMatches(root, lock) {
		return "unknown"
	}
	guardPath, err := instance.SwitchProfileGuardPath(root)
	if err != nil {
		return "unknown"
	}
	guard, err := openLock(guardPath, false)
	if errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN) {
		return "in-use"
	}
	if err != nil {
		return "unknown"
	}
	defer guard.Close()
	pinned, err := guard.Stat()
	if err != nil {
		return "unknown"
	}
	current, err := os.Lstat(guardPath)
	if err != nil || !current.Mode().IsRegular() || !os.SameFile(pinned, current) {
		return "unknown"
	}
	return "not-in-use"
}

func deleteInactiveProfile(path string, expected os.FileInfo) error {
	lock, err := openProfileLock(path, true)
	if err != nil {
		return fmt.Errorf("acquire channel data lock: %w", err)
	}
	defer lock.Close()
	current, err := os.Lstat(path)
	if err != nil || !current.IsDir() || !os.SameFile(expected, current) || !lockMatches(path, lock) {
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
	if err != nil || !current.IsDir() || !os.SameFile(expected, current) || !lockMatches(isolated, lock) {
		if _, statErr := os.Lstat(path); !os.IsNotExist(statErr) {
			return fmt.Errorf("channel data changed during isolation; retained at %s", isolated)
		}
		restoreErr := os.Rename(isolated, path)
		return errors.Join(fmt.Errorf("channel data or lock changed during isolation; retained at %s if restore failed", isolated), restoreErr)
	}
	if err := os.RemoveAll(isolated); err != nil {
		return fmt.Errorf("delete isolated channel data at %s: %w", isolated, err)
	}
	return nil
}
