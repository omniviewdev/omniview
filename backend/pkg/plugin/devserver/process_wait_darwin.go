//go:build darwin

package devserver

import (
	"errors"
	"fmt"

	"golang.org/x/sys/unix"
)

// NOTE_EXIT observes termination without wait/reap. Only this supervisor calls
// Cmd.Wait, after disposing of the still-pinned owned process group.
func awaitOwnedExit(pid int) error {
	queue, err := unix.Kqueue()
	if err != nil {
		return fmt.Errorf("create owned exit observer: %w", err)
	}
	defer unix.Close(queue)
	changes := []unix.Kevent_t{{Ident: uint64(pid), Filter: unix.EVFILT_PROC, Flags: unix.EV_ADD | unix.EV_ONESHOT, Fflags: unix.NOTE_EXIT}}
	var events [1]unix.Kevent_t
	for {
		count, err := unix.Kevent(queue, changes, events[:], nil)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		// The child can have exited before registration; it remains unreaped because
		// no Cmd.Wait has started, so group disposal is still authorized by ownership.
		if errors.Is(err, unix.ESRCH) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("observe owned process exit: %w", err)
		}
		changes = nil
		if count == 0 {
			continue
		}
		if events[0].Flags&unix.EV_ERROR != 0 && events[0].Data != 0 {
			err := unix.Errno(events[0].Data)
			if errors.Is(err, unix.ESRCH) {
				return nil
			}
			return fmt.Errorf("owned process exit event: %w", err)
		}
		return nil
	}
}
