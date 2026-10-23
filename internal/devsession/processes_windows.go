//go:build windows

package devsession

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"golang.org/x/sys/windows"
)

func openWindowsProcess(pid int, access uint32) (windows.Handle, error) {
	if pid <= 0 || uint64(pid) > uint64(^uint32(0)) {
		return 0, fmt.Errorf("%w: invalid Windows PID", ErrOwnership)
	}
	handle, err := windows.OpenProcess(access|windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, uint32(pid))
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return 0, ErrProcessGone
	}
	if err != nil {
		return 0, fmt.Errorf("open process identity: %w", err)
	}
	return handle, nil
}

func inspectWindowsHandle(handle windows.Handle) (string, string, error) {
	state, err := windows.WaitForSingleObject(handle, 0)
	if err != nil {
		return "", "", fmt.Errorf("inspect process state: %w", err)
	}
	if state == windows.WAIT_OBJECT_0 {
		return "", "", ErrProcessGone
	}
	if state != uint32(windows.WAIT_TIMEOUT) {
		return "", "", fmt.Errorf("%w: unexpected process wait state", ErrUnsupportedIdentity)
	}
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
		return "", "", fmt.Errorf("inspect process start: %w", err)
	}
	for size := uint32(256); size <= 32768; size *= 2 {
		path := make([]uint16, size)
		length := size
		err := windows.QueryFullProcessImageName(handle, 0, &path[0], &length)
		if errors.Is(err, windows.ERROR_INSUFFICIENT_BUFFER) {
			continue
		}
		if err != nil {
			return "", "", fmt.Errorf("inspect process executable: %w", err)
		}
		start := uint64(created.HighDateTime)<<32 | uint64(created.LowDateTime)
		if start == 0 {
			return "", "", fmt.Errorf("%w: Windows creation time unavailable", ErrUnsupportedIdentity)
		}
		return "windows:" + strconv.FormatUint(start, 10), windows.UTF16ToString(path[:length]), nil
	}
	return "", "", fmt.Errorf("%w: Windows executable path too long", ErrUnsupportedIdentity)
}

func inspectProcess(pid int) (string, string, error) {
	handle, err := openWindowsProcess(pid, 0)
	if err != nil {
		return "", "", err
	}
	defer windows.CloseHandle(handle)
	return inspectWindowsHandle(handle)
}

func terminateExactProcess(record devcontract.ProcessIdentity) error {
	handle, err := openWindowsProcess(record.PID, windows.PROCESS_TERMINATE)
	if errors.Is(err, ErrProcessGone) {
		return nil
	}
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	start, executable, err := inspectWindowsHandle(handle)
	if errors.Is(err, ErrProcessGone) {
		return nil
	}
	if err != nil {
		return err
	}
	if start != record.StartIdentity || executable != record.Executable {
		return fmt.Errorf("%w: process handle does not match recorded identity", ErrOwnership)
	}
	return terminateWindowsHandle(handle)
}

func terminateWindowsHandle(handle windows.Handle) error {
	if err := windows.TerminateProcess(handle, 1); err != nil {
		// Exit can race the prior identity check. Only a signaled *same*
		// pinned handle makes access-denied idempotent; a live or unreadable
		// handle retains the original permission failure.
		if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			state, waitErr := windows.WaitForSingleObject(handle, 0)
			if waitErr == nil && state == windows.WAIT_OBJECT_0 {
				return nil
			}
		}
		return fmt.Errorf("terminate owned process: %w", err)
	}
	return nil
}
