//go:build darwin || linux

package devworkspace

import (
	"errors"
	"os/exec"

	"golang.org/x/sys/unix"
)

func discardUncapturedCommand(child *ownedChild) error {
	command := child.command
	// This is our unreaped direct child, never an adopted numeric PID.
	signalErr := signalUnreapedGroup(command.Process.Pid, unix.SIGKILL)
	if signalErr != nil {
		return errors.Join(errOwnedCommandUncertain, signalErr)
	}
	if err := waitUnreapedGroupExit(command.Process.Pid); err != nil {
		// The unreaped direct child pins the group even if identity capture failed.
		return errors.Join(errOwnedCommandUncertain, err)
	}
	waitErr := command.Wait()
	child.disposed = command.ProcessState != nil
	var exit *exec.ExitError
	if errors.As(waitErr, &exit) {
		waitErr = nil
	}
	return waitErr
}
