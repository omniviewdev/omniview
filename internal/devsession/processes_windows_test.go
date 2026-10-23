//go:build windows

package devsession

import (
	"errors"
	"io"
	"os"
	"os/exec"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func windowsPinnedFixture(t *testing.T) (*exec.Cmd, io.WriteCloser, <-chan error) {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestWindowsPinnedHandleTermination$")
	cmd.Env = append(os.Environ(), "GOWORK=off", "OMNIVIEW_SESSION_WINDOWS_PINNED_FIXTURE=1")
	input, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		input.Close()
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait(); close(done) }()
	t.Cleanup(func() { _ = input.Close(); <-done })
	return cmd, input, done
}

func TestWindowsPinnedHandleTermination(t *testing.T) {
	if os.Getenv("OMNIVIEW_SESSION_WINDOWS_PINNED_FIXTURE") == "1" {
		_, _ = io.Copy(io.Discard, os.Stdin)
		return
	}
	t.Run("exit after identity check", func(t *testing.T) {
		cmd, input, done := windowsPinnedFixture(t)
		owner := ProcessOwner{WorkspaceID: fixtureWorkspace, Generation: "windows-exited", Role: "fixture", Source: os.Args[0]}
		record, err := CaptureProcess(cmd.Process.Pid, owner)
		if err != nil {
			t.Fatal(err)
		}
		handle, err := openWindowsProcess(cmd.Process.Pid, windows.PROCESS_TERMINATE)
		if err != nil {
			t.Fatal(err)
		}
		defer windows.CloseHandle(handle)
		start, executable, err := inspectWindowsHandle(handle)
		if err != nil || start != record.StartIdentity || executable != record.Executable {
			t.Fatalf("fixture handle identity differs: %v", err)
		}
		// Closing stdin lets this exact fixture exit without sending a signal.
		// Its pinned handle is now signaled before the production termination
		// step, deterministically exercising the post-verification exit race.
		if err := input.Close(); err != nil {
			t.Fatal(err)
		}
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("fixture did not exit")
		}
		if err := terminateWindowsHandle(handle); err != nil {
			t.Fatalf("already exited pinned process was not idempotent: %v", err)
		}
	})
	t.Run("live handle without terminate access", func(t *testing.T) {
		cmd, _, _ := windowsPinnedFixture(t)
		handle, err := openWindowsProcess(cmd.Process.Pid, 0)
		if err != nil {
			t.Fatal(err)
		}
		defer windows.CloseHandle(handle)
		if err := terminateWindowsHandle(handle); !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
			t.Fatalf("live access failure was suppressed: %v", err)
		}
		if _, _, err := inspectWindowsHandle(handle); err != nil {
			t.Fatalf("access-denied fixture was disrupted: %v", err)
		}
	})
}
