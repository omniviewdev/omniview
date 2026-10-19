//go:build windows

package devserver

import (
	"fmt"

	"golang.org/x/sys/windows"
)

func awaitOwnedExit(pid int) error {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	state, err := windows.WaitForSingleObject(handle, windows.INFINITE)
	if err != nil {
		return err
	}
	if state != windows.WAIT_OBJECT_0 {
		return fmt.Errorf("unexpected owned process wait state %d", state)
	}
	return nil
}
