//go:build linux || windows

package devsession

import (
	"errors"
	"os"
	"os/exec"
	"testing"
	"time"
)

// Signals target only a child created by this fixture, never an existing user
// process. The test catches a termination API that merely verifies then returns.
func TestTerminateOwnedFixtureProcess(t *testing.T) {
	if os.Getenv("OMNIVIEW_SESSION_TERMINATION_FIXTURE") == "1" {
		time.Sleep(time.Minute)
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestTerminateOwnedFixtureProcess$")
	cmd.Env = append(os.Environ(), "GOWORK=off", "OMNIVIEW_SESSION_TERMINATION_FIXTURE=1")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait(); close(done) }()
	t.Cleanup(func() { _ = cmd.Process.Kill(); <-done })
	owner := ProcessOwner{WorkspaceID: fixtureWorkspace, Generation: "owned-fixture", Role: "test-child", Source: os.Args[0]}
	record, err := CaptureProcess(cmd.Process.Pid, owner)
	if err != nil {
		t.Fatal(err)
	}
	wrong := owner
	wrong.Generation = "not-the-owner"
	if err := TerminateOwnedProcess(record, wrong); !errors.Is(err, ErrOwnership) {
		t.Fatalf("foreign owner accepted: %v", err)
	}
	if err := VerifyOwnedProcess(record, owner); err != nil {
		t.Fatalf("rejected termination disrupted child: %v", err)
	}
	if err := TerminateOwnedProcess(record, owner); err != nil {
		if errors.Is(err, ErrUnsupportedIdentity) {
			t.Skip("runner has no process-stable termination support")
		}
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("owned fixture did not terminate")
	}
}
