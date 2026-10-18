//go:build windows

package devserver

import (
	"fmt"
	"os/exec"
	"syscall"
)

const termStopsOwnedTree = true
const canSignalUnreapedGroup = false

func normalizeOwnedGroupError(err error) error { return err }

// newProcessGroupAttr returns SysProcAttr that creates a new process group on Windows.
func newProcessGroupAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

// killProcessGroup kills the process tree rooted at the given PID using taskkill.
func killProcessGroup(pid int) error {
	return exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", pid)).Run()
}

// termProcessGroup on Windows is equivalent to killProcessGroup since there is no SIGTERM.
func termProcessGroup(pid int) error {
	return killProcessGroup(pid)
}
