package devworkspace

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestCaptureExecutedProcessWaitsForChildExec(t *testing.T) {
	const self, launched = "/cache/omniview-dev", "/workspace/.local/bin/native/Omniview"
	images := []string{self, self, launched}
	calls := 0
	identity, err := captureExecutedProcess(context.Background(), launched, self, time.Minute, func() (devcontract.ProcessIdentity, error) {
		image := images[min(calls, len(images)-1)]
		calls++
		return devcontract.ProcessIdentity{PID: 42, Executable: image}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if identity.Executable != launched || calls != 3 {
		t.Fatalf("captured %q after %d reads, want %q after 3", identity.Executable, calls, launched)
	}
}

func TestCaptureExecutedProcessRefusesChildThatNeverExecs(t *testing.T) {
	const self = "/cache/omniview-dev"
	// The capture deadline is the only exit; the context only stops a regression from hanging.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	identity, err := captureExecutedProcess(ctx, "/workspace/Omniview", self, 50*time.Millisecond, func() (devcontract.ProcessIdentity, error) {
		return devcontract.ProcessIdentity{PID: 42, Executable: self}, nil
	})
	if !errors.Is(err, devsession.ErrOwnership) || identity.Executable == self {
		t.Fatalf("published the supervisor image as the child identity: %+v err=%v", identity, err)
	}
}

func TestCaptureExecutedProcessStopsWhenCancelled(t *testing.T) {
	const self = "/cache/omniview-dev"
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	identity, err := captureExecutedProcess(ctx, "/workspace/Omniview", self, time.Minute, func() (devcontract.ProcessIdentity, error) {
		return devcontract.ProcessIdentity{PID: 42, Executable: self}, nil
	})
	if !errors.Is(err, context.DeadlineExceeded) || identity.Executable == self {
		t.Fatalf("identity=%+v err=%v", identity, err)
	}
}

func TestCaptureExecutedProcessAcceptsSupervisorLaunchingItself(t *testing.T) {
	const self = "/cache/omniview-dev"
	calls := 0
	identity, err := captureExecutedProcess(context.Background(), self, self, time.Minute, func() (devcontract.ProcessIdentity, error) {
		calls++
		return devcontract.ProcessIdentity{PID: 42, Executable: self}, nil
	})
	if err != nil || identity.Executable != self || calls != 1 {
		t.Fatalf("identity=%+v calls=%d err=%v", identity, calls, err)
	}
}
