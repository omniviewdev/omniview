//go:build !windows

package terminal

import (
	"fmt"
	"os"
	"time"

	"golang.org/x/sys/unix"
)

// pollable returns the master of a pty as a file the runtime's poller drives. creack/pty hands back a
// descriptor in blocking mode (its own ioctls call Fd, which makes it so), and a call blocked in the
// kernel on such a descriptor is not woken by closing the file: on Linux a write to a shell that does
// not read stays blocked after the shell is killed, and so does the goroutine and the descriptor.
// Driven by the poller, a Close or a deadline interrupts a blocked read or write on both Linux and
// macOS. Where the poller will not take the descriptor, the original file is returned as it was.
func pollable(master *os.File) (*os.File, error) {
	fd, dupErr := unix.FcntlInt(master.Fd(), unix.F_DUPFD_CLOEXEC, 0)
	if dupErr != nil {
		return nil, fmt.Errorf("duplicate the pty master: %w", dupErr)
	}
	if nonblockErr := unix.SetNonblock(fd, true); nonblockErr != nil {
		_ = unix.Close(fd)
		return nil, fmt.Errorf("make the pty master non-blocking: %w", nonblockErr)
	}
	file := os.NewFile(uintptr(fd), master.Name())
	if !polled(file) {
		// The duplicate shares the open file description, so the non-blocking flag is shared too: it is
		// cleared again, or the original would see EAGAIN.
		_ = unix.SetNonblock(fd, false)
		_ = file.Close()
		return master, nil
	}
	_ = master.Close()
	return file, nil
}

// polled reports whether the runtime's poller took the file: only then does it support deadlines.
func polled(file *os.File) bool { return file.SetReadDeadline(time.Time{}) == nil }

// control runs fn on the master's descriptor while the file keeps it open, so that a close of the
// file cannot hand the descriptor to someone else in the middle of an ioctl.
func control(master *os.File, fn func(fd int) error) error {
	conn, connErr := master.SyscallConn()
	if connErr != nil {
		return connErr
	}
	var inner error
	if controlErr := conn.Control(func(fd uintptr) { inner = fn(int(fd)) }); controlErr != nil {
		return controlErr
	}
	return inner
}

// ptyDevice is a session's input as the input queue sees it.
type ptyDevice struct{ master *os.File }

func (d ptyDevice) Write(p []byte) (int, error) { return d.master.Write(p) }

func (d ptyDevice) Resize(rows, cols uint16) error {
	return control(d.master, func(fd int) error {
		return unix.IoctlSetWinsize(fd, unix.TIOCSWINSZ, &unix.Winsize{Row: rows, Col: cols, Xpixel: 0, Ypixel: 0})
	})
}

// foregroundGroup reads the foreground process group of the pty from its master.
func foregroundGroup(master *os.File) (int, error) {
	var group int
	err := control(master, func(fd int) error {
		var ioErr error
		group, ioErr = unix.IoctlGetInt(fd, unix.TIOCGPGRP)
		return ioErr
	})
	return group, err
}
