//go:build windows

package devserver

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

// newProcessGroupAttr returns SysProcAttr that creates a new process group on Windows.
func newProcessGroupAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

// getProcessGroupID returns the PID itself on Windows (no Unix-style PGID concept).
func getProcessGroupID(pid int) int {
	return pid
}

// killProcessGroup kills the process tree rooted at the given PID using taskkill.
func killProcessGroup(pid int) error {
	return exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", pid)).Run()
}

// termProcessGroup on Windows is equivalent to killProcessGroup since there is no SIGTERM.
func termProcessGroup(pid int) error {
	return killProcessGroup(pid)
}

// termProcess kills a single process on Windows (no SIGTERM equivalent).
func termProcess(p *os.Process) error {
	return p.Kill()
}

// isPIDAlive checks if a process with the given PID is still running.
func isPIDAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Windows, FindProcess always succeeds. Open the process to check.
	handle, err := syscall.OpenProcess(syscall.PROCESS_QUERY_INFORMATION, false, uint32(process.Pid))
	if err != nil {
		return false
	}
	syscall.CloseHandle(handle)
	return true
}

// isProcessNotFound returns true if the error indicates the process no longer exists.
func isProcessNotFound(err error) bool {
	var exitErr *exec.ExitError
	if ok := asExitError(err, &exitErr); ok {
		return true
	}
	return false
}

// asExitError is a helper to check if an error is an *exec.ExitError.
func asExitError(err error, target **exec.ExitError) bool {
	e, ok := err.(*exec.ExitError)
	if ok {
		*target = e
	}
	return ok
}
