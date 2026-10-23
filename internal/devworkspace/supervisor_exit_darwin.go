//go:build darwin

package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"syscall"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"golang.org/x/sys/unix"
)

func shutdownSupervisor(ctx context.Context, workspace Workspace, record supervisorRecord, token []byte, command string) (Status, error) {
	queue, err := unix.Kqueue()
	if err != nil {
		return Status{}, fmt.Errorf("create supervisor exit observation: %w", err)
	}
	defer unix.Close(queue)
	changes := []unix.Kevent_t{{Ident: uint64(record.Process.PID), Filter: unix.EVFILT_PROC, Flags: unix.EV_ADD | unix.EV_ENABLE | unix.EV_ONESHOT, Fflags: unix.NOTE_EXIT}}
	if _, err = unix.Kevent(queue, changes, nil, nil); err != nil {
		return Status{}, fmt.Errorf("register supervisor exit observation: %w", err)
	}
	// Verification before registration belongs to supervisorCommand. Recheck
	// after attaching so PID reuse cannot bind this observation to a foreign
	// lifetime. The kernel then retains the exact process, not a future PID.
	if err = verifySupervisor(record, workspace); err != nil {
		return Status{}, err
	}
	status, err := callSupervisor(ctx, record, token, command)
	if err != nil {
		return status, err
	}
	// The authenticated owner response proves its own child disposal. Only the
	// retained NOTE_EXIT observation proves supervisor completion: PROCARGS2
	// can return EINVAL after task deactivation but before the zombie state.
	events := make([]unix.Kevent_t, 1)
	for {
		if ctx.Err() != nil {
			return status, devcontract.Fail(7, "timeout", "owned supervisor did not finish shutdown")
		}
		var current supervisorRecord
		if err = readLaunchJSON(launchPath(workspace, "supervisor.json"), &current); err != nil {
			return status, err
		}
		if current.Generation != record.Generation {
			return status, devcontract.Fail(4, "stale_target", "workspace generation changed during shutdown")
		}
		if current != record {
			return status, fmt.Errorf("%w: supervisor record changed during shutdown", devsession.ErrOwnership)
		}
		// Bound the kernel wait to retain the existing cancellation and durable
		// generation guards, without querying the exiting task's executable.
		timeout := unix.NsecToTimespec(int64(50 * time.Millisecond))
		count, observeErr := unix.Kevent(queue, nil, events, &timeout)
		if errors.Is(observeErr, unix.EINTR) {
			continue
		}
		if observeErr != nil {
			return status, fmt.Errorf("observe supervisor exit: %w", observeErr)
		}
		if count == 0 {
			continue
		}
		if count != 1 || events[0].Ident != uint64(record.Process.PID) || events[0].Filter != unix.EVFILT_PROC {
			return status, fmt.Errorf("observe supervisor exit: unexpected kernel event")
		}
		if events[0].Flags&unix.EV_ERROR != 0 {
			return status, fmt.Errorf("observe supervisor exit event: %w", syscall.Errno(events[0].Data))
		}
		if events[0].Fflags&unix.NOTE_EXIT == 0 {
			return status, fmt.Errorf("observe supervisor exit: kernel did not report exit")
		}
		return status, nil
	}
}
