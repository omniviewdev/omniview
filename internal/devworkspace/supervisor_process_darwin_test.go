//go:build darwin

package devworkspace

import (
	"errors"
	"io"
	"os/exec"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestDarwinOwnedCommandObservesAlreadyExitedLeader(t *testing.T) {
	for _, test := range []struct {
		name, script string
		exitCode     int
		brokenOutput bool
	}{
		{name: "success", script: "exit 0"},
		{name: "nonzero", script: "exit 17", exitCode: 17},
		{name: "output failure", script: "printf owned; exit 0", brokenOutput: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			command := exec.Command("/bin/sh", "-c", test.script)
			if test.brokenOutput {
				reader, writer := io.Pipe()
				if err := reader.Close(); err != nil {
					t.Fatal(err)
				}
				defer writer.Close()
				command.Stdout = writer
			}
			prepareOwnedCommand(command)
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			child := &ownedChild{command: command}
			child.identity.PID = command.Process.Pid
			defer func() {
				if command.ProcessState != nil {
					return
				}
				if err := signalUnreapedGroup(command.Process.Pid, unix.SIGKILL); err != nil {
					t.Error(err)
					return
				}
				if err := waitUnreapedGroupExit(command.Process.Pid); err != nil {
					t.Error(err)
					return
				}
				_ = command.Wait()
			}()
			// Keep the actual direct child unreaped: its PID/PGID cannot be reused.
			// Force the same genuine exit-before-kqueue-registration ordering as
			// a fast dependency command, without replacing any process observer.
			deadline := time.NewTimer(5 * time.Second)
			defer deadline.Stop()
			for {
				members, err := unix.SysctlKinfoProcSlice("kern.proc.pid", command.Process.Pid)
				if err != nil {
					t.Fatal(err)
				}
				if len(members) == 1 && int(members[0].Proc.P_pid) == command.Process.Pid && members[0].Proc.P_stat == 5 {
					break
				}
				select {
				case <-deadline.C:
					t.Fatal("actual owned leader did not exit before registration")
				case <-time.After(10 * time.Millisecond):
				}
			}
			err := waitOwnedCommand(child)
			if !child.disposed || command.ProcessState == nil {
				t.Fatalf("actual exited child lost empty-group/reap proof: %v", err)
			}
			if test.brokenOutput {
				if !errors.Is(err, io.ErrClosedPipe) {
					t.Fatalf("already-exited child lost its actual output error: %v", err)
				}
			} else if test.exitCode != 0 {
				var exit *exec.ExitError
				if !errors.As(err, &exit) || exit.ExitCode() != test.exitCode {
					t.Fatalf("already-exited child lost its actual exit status: %v", err)
				}
			} else if err != nil {
				t.Fatalf("successful already-exited child became an observation failure: %v", err)
			}
		})
	}
}
