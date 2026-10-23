//go:build windows

package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/windows"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestWindowsOwnedJobClosesBeforeInheritedPipeDrain(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(t.TempDir(), "descendant.json")
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	owner := devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Role: "host", Source: exe}
	env := append(os.Environ(), "OMNIVIEW_WINDOWS_PIPE_FIXTURE=parent", "OMNIVIEW_WINDOWS_PIPE_MARKER="+marker)
	child, err := startOwnedChild(ctx, filepath.Dir(exe), env, &childOutput{output: io.Discard}, owner, nil, exe, "-test.run=TestWindowsOwnedPipeFixture")
	if err != nil {
		t.Fatal(err)
	}
	defer child.stop(context.Background())
	select {
	case <-child.done:
	case <-time.After(3 * time.Second):
		t.Fatal("leader exited but Cmd.Wait remained blocked on descendant's inherited pipe")
	}
	var identity devcontract.ProcessIdentity
	data, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &identity); err != nil {
		t.Fatal(err)
	}
	descendantOwner := devsession.ProcessOwner{WorkspaceID: identity.WorkspaceID, Generation: identity.Generation, Role: identity.Role, Source: identity.Source}
	if err = devsession.VerifyOwnedProcess(identity, descendantOwner); !errors.Is(err, devsession.ErrProcessGone) {
		t.Fatalf("owned Job did not dispose actual descendant: %v", err)
	}
}

func TestWindowsOwnedPipeFixture(t *testing.T) {
	role := os.Getenv("OMNIVIEW_WINDOWS_PIPE_FIXTURE")
	if role == "" {
		return
	}
	marker := os.Getenv("OMNIVIEW_WINDOWS_PIPE_MARKER")
	if role == "descendant" {
		exe, _ := os.Executable()
		identity, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: "pipe-descendant", Role: "pipe-descendant", Source: exe})
		if err != nil {
			os.Exit(23)
		}
		data, _ := json.Marshal(identity)
		if os.WriteFile(marker, data, 0600) != nil {
			os.Exit(24)
		}
		time.Sleep(time.Hour)
		os.Exit(0)
	}
	command := exec.Command(os.Args[0], "-test.run=TestWindowsOwnedPipeFixture")
	command.Env = append(os.Environ(), "OMNIVIEW_WINDOWS_PIPE_FIXTURE=descendant")
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if command.Start() != nil {
		os.Exit(25)
	}
	for range 100 {
		if _, err := os.Stat(marker); err == nil {
			os.Exit(0)
		}
		time.Sleep(10 * time.Millisecond)
	}
	os.Exit(26)
}

func TestWindowsOwnedJobFailedDisposalRetainsLifetimeForStopRetry(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	release := filepath.Join(t.TempDir(), "release")
	command := exec.Command(exe, "-test.run=TestWindowsDisposalRetryFixture")
	command.Env = append(os.Environ(), "OMNIVIEW_WINDOWS_DISPOSAL_RELEASE="+release)
	command.Stdout, command.Stderr = io.Discard, io.Discard
	prepareOwnedCommand(command)
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	child := &ownedChild{command: command, done: make(chan struct{})}
	child.identity, err = devsession.CaptureProcess(command.Process.Pid, devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Role: "host", Source: exe})
	if err != nil {
		_ = discardUncapturedCommand(child)
		t.Fatal(err)
	}
	if err = attachOwnedCommand(child); err != nil {
		_ = discardUncapturedCommand(child)
		t.Fatal(err)
	}
	value, _ := childJob.Load(child)
	original := value.(ownedWindowsJob)
	defer func() {
		_ = windows.TerminateJobObject(original.job, 1)
		if command.ProcessState == nil {
			_ = command.Wait()
		}
		if value, ok := childJob.LoadAndDelete(child); ok {
			record := value.(ownedWindowsJob)
			_ = windows.CloseHandle(record.job)
			_ = windows.CloseHandle(record.leader)
			if record.job == original.job {
				return
			}
		}
		_ = windows.CloseHandle(original.job)
	}()
	// Keep the same kernel Job but remove QUERY access. Termination succeeds;
	// accounting cannot prove descendant disposal. No production hook is used.
	var restricted windows.Handle
	const jobObjectTerminate = 0x0008
	if err = windows.DuplicateHandle(windows.CurrentProcess(), original.job, windows.CurrentProcess(), &restricted, jobObjectTerminate, false, 0); err != nil {
		t.Fatal(err)
	}
	childJob.Store(child, ownedWindowsJob{job: restricted, leader: original.leader})
	finalized := false
	child.finalize = func() error { finalized = true; return nil }
	if err = os.WriteFile(release, nil, 0600); err != nil {
		t.Fatal(err)
	}
	child.complete()
	close(child.done)
	if !errors.Is(child.failure(), errOwnedCommandUncertain) {
		t.Fatalf("failed accounting was reported as disposal: %v", child.failure())
	}
	if finalized || command.ProcessState != nil {
		t.Fatal("uncertain Job disposal finalized the producer or reaped its retained leader")
	}
	retained, ok := childJob.Load(child)
	if !ok || retained.(ownedWindowsJob).job != restricted || retained.(ownedWindowsJob).leader != original.leader {
		t.Fatal("uncertain disposal discarded the exact Job/leader handles")
	}
	// Restore query access to that same Job and retry the retained child; no PID
	// lookup, process adoption or new lifecycle generation can authorize this.
	childJob.Store(child, original)
	_ = windows.CloseHandle(restricted)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err = child.stop(ctx); err != nil {
		t.Fatalf("Stop could not retry retained Windows disposal: %v", err)
	}
	if !finalized || command.ProcessState == nil || command.ProcessState.ExitCode() != 17 {
		t.Fatal("confirmed disposal did not reap the original leader and finalize its producer")
	}
	if _, ok = childJob.Load(child); ok {
		t.Fatal("confirmed disposal retained Job handles")
	}
}

func TestWindowsDisposalRetryFixture(t *testing.T) {
	release := os.Getenv("OMNIVIEW_WINDOWS_DISPOSAL_RELEASE")
	if release == "" {
		return
	}
	for {
		if _, err := os.Stat(release); err == nil {
			os.Exit(17)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
