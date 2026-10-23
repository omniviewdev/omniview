//go:build !windows && !darwin

package devserver

import "syscall"

func killProcessGroup(pgid int) error { return syscall.Kill(-pgid, syscall.SIGKILL) }
func termProcessGroup(pgid int) error { return syscall.Kill(-pgid, syscall.SIGTERM) }
