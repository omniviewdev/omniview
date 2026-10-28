//go:build darwin

package devworkspace

import (
	"errors"
	"fmt"
	"os/exec"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

func detachSupervisor(command *exec.Cmd) { command.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
func prepareOwnedCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func attachOwnedCommand(child *ownedChild) error {
	child.stopTree = func(force bool) error {
		child.mu.Lock()
		defer child.mu.Unlock()
		if child.command.ProcessState != nil {
			return nil
		}
		signal := unix.SIGTERM
		if force {
			signal = unix.SIGKILL
		}
		return signalUnreapedGroup(child.command.Process.Pid, signal)
	}
	return nil
}

func waitOwnedCommand(child *ownedChild) error {
	alreadyExited := false
	queue, err := unix.Kqueue()
	if err != nil {
		err = fmt.Errorf("create owned-child kqueue: %w", err)
	} else {
		defer unix.Close(queue)
		changes := []unix.Kevent_t{{Ident: uint64(child.command.Process.Pid), Filter: unix.EVFILT_PROC, Flags: unix.EV_ADD | unix.EV_ENABLE | unix.EV_ONESHOT, Fflags: unix.NOTE_EXIT}}
		_, err = unix.Kevent(queue, changes, nil, nil)
		if err != nil {
			// A fast direct child can be an unreaped zombie before registration.
			// ESRCH alone is not exit proof: bind the exact retained Cmd/PID to
			// its kernel zombie record, and still require group disposal + Wait.
			if errors.Is(err, unix.ESRCH) && child.command.Process != nil && child.command.ProcessState == nil {
				members, inspectErr := unix.SysctlKinfoProcSlice("kern.proc.pid", child.command.Process.Pid)
				if inspectErr != nil {
					err = errors.Join(err, fmt.Errorf("inspect retained owned-child exit: %w", inspectErr))
				} else {
					alreadyExited = len(members) == 1 && int(members[0].Proc.P_pid) == child.command.Process.Pid && members[0].Proc.P_stat == 5
				}
			}
			err = fmt.Errorf("register owned-child exit: %w", err)
		} else {
			event := make([]unix.Kevent_t, 1)
			for {
				var count int
				count, err = unix.Kevent(queue, nil, event, nil)
				if errors.Is(err, unix.EINTR) {
					continue
				}
				if err != nil {
					err = fmt.Errorf("observe owned-child exit: %w", err)
				} else if count != 1 || event[0].Ident != uint64(child.command.Process.Pid) || event[0].Filter != unix.EVFILT_PROC {
					err = fmt.Errorf("observe owned-child exit: unexpected kernel event")
				} else if event[0].Flags&unix.EV_ERROR != 0 {
					err = fmt.Errorf("observe owned-child exit event: %w", syscall.Errno(event[0].Data))
				} else if event[0].Fflags&unix.NOTE_EXIT == 0 {
					err = fmt.Errorf("observe owned-child exit: kernel did not report exit")
				}
				break
			}
		}
	}
	child.mu.Lock()
	killErr := signalUnreapedGroup(child.command.Process.Pid, unix.SIGKILL)
	var groupErr error
	if killErr == nil {
		groupErr = waitUnreapedGroupExit(child.command.Process.Pid)
	}
	if killErr != nil || groupErr != nil {
		// Keep the leader unreaped on uncertain disposal: its actual Cmd lifetime
		// pins the PGID, and no writer may attest while members might still write.
		child.mu.Unlock()
		return errors.Join(err, killErr, groupErr)
	}
	waitErr := child.command.Wait()
	disposed := child.command.ProcessState != nil
	child.disposed = disposed
	child.mu.Unlock()
	if err != nil && !(alreadyExited && disposed) {
		return errors.Join(err, waitErr)
	}
	return waitErr
}

func signalUnreapedGroup(pgid int, signal syscall.Signal) error {
	err := unix.Kill(-pgid, signal)
	if err == nil || errors.Is(err, unix.ESRCH) {
		return nil
	}
	if !errors.Is(err, unix.EPERM) {
		return err
	}
	// XNU can skip members that proc_find can no longer reference while their
	// kernel exit cleanup is still visible as non-SZOMB. Neither EPERM nor an
	// exit-in-progress flag proves disposal. The unreaped leader pins this
	// exact PGID; require independent terminal-group proof within the existing
	// bound, preserving the signal error if that proof fails.
	if exitErr := waitUnreapedGroupExit(pgid); exitErr != nil {
		return errors.Join(err, exitErr)
	}
	return nil
}

func waitUnreapedGroupExit(pgid int) error {
	deadline := time.Now().Add(5 * time.Second)
	for {
		members, err := unix.SysctlKinfoProcSlice("kern.proc.pgrp", pgid)
		if errors.Is(err, unix.ESRCH) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("observe unreaped owned group exit: %w", err)
		}
		live := false
		for _, member := range members {
			if member.Proc.P_stat != 5 {
				live = true
				break
			}
		}
		if !live {
			return nil
		}
		if !time.Now().Before(deadline) {
			return fmt.Errorf("owned group still has live members after termination")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
