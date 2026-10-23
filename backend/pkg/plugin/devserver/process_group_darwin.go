//go:build darwin

package devserver

import (
	"errors"
	"fmt"
	"syscall"

	"golang.org/x/sys/unix"
)

// These helpers are only for the retained Cmd owner, with its sole-reaper gate
// held. The unreaped leader pins this group ID; persisted records never call it.
func killProcessGroup(pgid int) error { return signalOwnedDarwinGroup(pgid, syscall.SIGKILL) }
func termProcessGroup(pgid int) error { return signalOwnedDarwinGroup(pgid, syscall.SIGTERM) }

func signalOwnedDarwinGroup(pgid int, signal syscall.Signal) error {
	err := syscall.Kill(-pgid, signal)
	if !errors.Is(err, syscall.EPERM) {
		return err
	}
	// A signal is not deliverable to an already-zombie-only group. Do not confuse
	// that with a live inaccessible descendant: only actual kernel group evidence
	// of no live member can establish that disposal is already complete.
	members, inspectErr := unix.SysctlKinfoProcSlice("kern.proc.pgrp", pgid)
	if inspectErr != nil {
		return errors.Join(err, fmt.Errorf("inspect unreaped owned group: %w", inspectErr))
	}
	for _, member := range members {
		if member.Proc.P_stat != 5 {
			return err
		}
	}
	return nil
}
