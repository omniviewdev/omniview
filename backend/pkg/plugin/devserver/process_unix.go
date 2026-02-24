//go:build !windows

package devserver

import (
	"os"
	"syscall"
)

// newProcessGroupAttr returns SysProcAttr that places the child in its own process group.
func newProcessGroupAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}

// getProcessGroupID returns the process group ID for the given PID.
func getProcessGroupID(pid int) int {
	pgid, _ := syscall.Getpgid(pid)
	return pgid
}

// killProcessGroup sends SIGKILL to the entire process group.
func killProcessGroup(pgid int) error {
	return syscall.Kill(-pgid, syscall.SIGKILL)
}

// termProcessGroup sends SIGTERM to the entire process group.
func termProcessGroup(pgid int) error {
	return syscall.Kill(-pgid, syscall.SIGTERM)
}

// termProcess sends SIGTERM to a single process.
func termProcess(p *os.Process) error {
	return p.Signal(syscall.SIGTERM)
}

// isPIDAlive checks if a process with the given PID is still running.
func isPIDAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}

// isProcessNotFound returns true if the error indicates the process no longer exists.
func isProcessNotFound(err error) bool {
	return err == syscall.ESRCH
}
