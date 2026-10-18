//go:build darwin || linux

package devbaseline

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func acquireSourceLock(path string) (func() error, string, error) {
	parent := filepath.Dir(path)
	if _, err := strictPath(parent); err != nil {
		return nil, "", err
	}
	directory, err := os.Open(parent)
	if err != nil {
		return nil, "", err
	}
	defer directory.Close()
	opened, err := directory.Stat()
	if err != nil {
		return nil, "", err
	}
	named, err := os.Lstat(parent)
	if err != nil {
		return nil, "", err
	}
	if !named.IsDir() || !os.SameFile(opened, named) {
		return nil, "", fmt.Errorf("baseline: source lock parent changed identity")
	}
	// Anchor the operation to the checked directory. O_EXCL cannot follow a
	// replacement symlink during creation; O_NOFOLLOW protects the existing case.
	fd, err := unix.Openat(int(directory.Fd()), filepath.Base(path), unix.O_RDWR|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	marker := "created-for-offline-lock"
	if errors.Is(err, unix.EEXIST) {
		marker = "existing"
		fd, err = unix.Openat(int(directory.Fd()), filepath.Base(path), unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	}
	if err != nil {
		return nil, "", fmt.Errorf("baseline: cannot open source lock without following links")
	}
	file := os.NewFile(uintptr(fd), path)
	if err := verifySourceLock(path, file); err != nil {
		_ = file.Close()
		return nil, "", err
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = file.Close()
		if errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN) {
			return nil, "", ErrSourceBusy
		}
		return nil, "", fmt.Errorf("baseline: cannot acquire source flock")
	}
	if err := verifySourceLock(path, file); err != nil {
		_ = file.Close()
		return nil, "", err
	}
	return func() error {
		unlockErr := unix.Flock(fd, unix.LOCK_UN)
		closeErr := file.Close()
		if unlockErr != nil {
			return unlockErr
		}
		return closeErr
	}, marker, nil
}
