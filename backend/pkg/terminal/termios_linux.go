//go:build linux

package terminal

import "golang.org/x/sys/unix"

// The requests that read and set a terminal's attributes.
const (
	getTermios = unix.TCGETS
	setTermios = unix.TCSETS
)
