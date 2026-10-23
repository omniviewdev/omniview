package devbaseline

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

func acquireSourceLock(path string) (func() error, string, error) {
	parent := filepath.Dir(path)
	if _, err := strictPath(parent); err != nil {
		return nil, "", err
	}
	parentName, err := windows.UTF16PtrFromString(parent)
	if err != nil {
		return nil, "", err
	}
	// Omitting FILE_SHARE_DELETE pins the parent while the final component is
	// opened; OPEN_REPARSE_POINT makes a redirected parent an error, not authority.
	directory, err := windows.CreateFile(parentName, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, "", fmt.Errorf("baseline: cannot pin source lock parent")
	}
	defer windows.CloseHandle(directory)
	var parentInfo windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(directory, &parentInfo) != nil || parentInfo.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return nil, "", fmt.Errorf("baseline: source lock parent is redirected")
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, "", err
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.CREATE_NEW, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	marker := "created-for-offline-lock"
	if errors.Is(err, windows.ERROR_FILE_EXISTS) || errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		marker = "existing"
		handle, err = windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	}
	if err != nil {
		return nil, "", fmt.Errorf("baseline: cannot open source lock without following links")
	}
	file := os.NewFile(uintptr(handle), path)
	var native windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(handle, &native) != nil || native.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		_ = file.Close()
		return nil, "", fmt.Errorf("baseline: source lock is a reparse point")
	}
	if err := verifySourceLock(path, file); err != nil {
		_ = file.Close()
		return nil, "", err
	}
	flags := uint32(windows.LOCKFILE_EXCLUSIVE_LOCK | windows.LOCKFILE_FAIL_IMMEDIATELY)
	if err := windows.LockFileEx(handle, flags, 0, 1, 0, &windows.Overlapped{}); err != nil {
		_ = file.Close()
		if errors.Is(err, windows.ERROR_LOCK_VIOLATION) || errors.Is(err, windows.ERROR_IO_PENDING) {
			return nil, "", ErrSourceBusy
		}
		return nil, "", fmt.Errorf("baseline: cannot acquire source flock")
	}
	if err := verifySourceLock(path, file); err != nil {
		_ = file.Close()
		return nil, "", err
	}
	return func() error {
		unlockErr := windows.UnlockFileEx(handle, 0, 1, 0, &windows.Overlapped{})
		closeErr := file.Close()
		if unlockErr != nil {
			return unlockErr
		}
		return closeErr
	}, marker, nil
}
