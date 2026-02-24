//go:build !windows

package plugin

import "syscall"

// killProcess sends SIGKILL to the given PID.
func killProcess(pid int) error {
	return syscall.Kill(pid, syscall.SIGKILL)
}

// isProcessNotFound returns true if the error indicates the process no longer exists.
func isProcessNotFound(err error) bool {
	return err == syscall.ESRCH
}
