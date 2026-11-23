//go:build !windows

package terminal

import (
	"os"

	"golang.org/x/sys/unix"
)

// utf8Input marks the pty as one that carries UTF-8 (IUTF8), as Alacritty, Ghostty and node-pty do: while
// the terminal is in cooked mode the line discipline then erases one multi-byte character, not one byte
// of it, on a backspace. Without it a UTF-8 line edited before the shell takes the terminal over is cut in
// the middle of a character. creack/pty sets only Setsid and Setctty.
func utf8Input(master *os.File) error {
	return control(master, func(fd int) error {
		termios, getErr := unix.IoctlGetTermios(fd, getTermios)
		if getErr != nil {
			return getErr
		}
		termios.Iflag |= unix.IUTF8
		return unix.IoctlSetTermios(fd, setTermios, termios)
	})
}
