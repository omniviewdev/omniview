//go:build windows

package plugin

import (
	"os"
)

// killProcess kills the process with the given PID.
func killProcess(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}

// isProcessNotFound returns true if the error indicates the process no longer exists.
func isProcessNotFound(err error) bool {
	return os.IsNotExist(err) || err.Error() == "os: process already finished"
}
