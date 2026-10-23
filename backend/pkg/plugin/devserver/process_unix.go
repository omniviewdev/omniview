//go:build !windows

package devserver

import (
	"errors"
	"syscall"
)

const termStopsOwnedTree = false
const canSignalUnreapedGroup = true

func normalizeOwnedGroupError(err error) error {
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

// newProcessGroupAttr returns SysProcAttr that places the child in its own process group.
func newProcessGroupAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}
