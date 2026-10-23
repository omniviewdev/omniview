//go:build darwin

package devsession

import (
	"errors"
	"os"
	"os/exec"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestDarwinDetachedTerminationFailsClosed(t *testing.T) {
	owner := ProcessOwner{WorkspaceID: fixtureWorkspace, Generation: "darwin-fixture", Role: "fixture", Source: "/fixture/source"}
	record, err := CaptureProcess(os.Getpid(), owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyOwnedProcess(record, owner); err != nil {
		t.Fatal(err)
	}
	if err := TerminateOwnedProcess(record, owner); !errors.Is(err, ErrUnsupportedIdentity) {
		t.Fatalf("Darwin advertised PID-stable termination: %v", err)
	}
}

func TestDarwinExecutableQueryFailureRequiresKernelExitProof(t *testing.T) {
	command := exec.Command("/bin/sleep", "300")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = command.Process.Kill(); _ = command.Wait() }()
	before, err := darwinStartIdentity(command.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	for _, queryErr := range []error{unix.EINVAL, unix.EPERM, unix.EACCES} {
		classified := darwinExecutableInspectionError(command.Process.Pid, before, queryErr)
		if !errors.Is(classified, queryErr) || errors.Is(classified, ErrProcessGone) || errors.Is(classified, ErrOwnership) {
			t.Fatalf("live executable query failure lost refusal: %v", classified)
		}
	}
	if err = darwinExecutableInspectionError(command.Process.Pid, before+"-stale", unix.EINVAL); !errors.Is(err, ErrOwnership) {
		t.Fatalf("changed start identity did not refuse ownership: %v", err)
	}
	if err = command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		_, err = darwinStartIdentity(command.Process.Pid)
		if errors.Is(err, ErrProcessGone) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		select {
		case <-deadline.C:
			t.Fatal("kernel did not observe owned child exit")
		case <-time.After(10 * time.Millisecond):
		}
	}
	// The unreaped actual child pins its PID; only its observed zombie/gone
	// state allows a racing PROCARGS2 failure to mean that lifetime ended.
	if err = darwinExecutableInspectionError(command.Process.Pid, before, unix.EINVAL); !errors.Is(err, ErrProcessGone) {
		t.Fatalf("observed exited lifetime was not classified gone: %v", err)
	}
}
