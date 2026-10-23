//go:build linux

package devserver

import (
	"errors"

	"golang.org/x/sys/unix"
)

// awaitOwnedExit observes the child without reaping it. Its unreaped PID keeps
// the process-group identity pinned until the sole owner signals descendants.
func awaitOwnedExit(pid int) error {
	var info unix.Siginfo
	for {
		err := unix.Waitid(unix.P_PID, pid, &info, unix.WEXITED|unix.WNOWAIT, nil)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		return err
	}
}
