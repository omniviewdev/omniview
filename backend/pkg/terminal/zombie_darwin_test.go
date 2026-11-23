//go:build darwin

package terminal

import "golang.org/x/sys/unix"

// exitedUnreaped reports whether pid has exited and nobody has reaped it: the kernel says state SZOMB
// (the zombie constant of foreground_darwin.go).
func exitedUnreaped(pid int) bool {
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	return err == nil && info.Proc.P_stat == zombie
}
