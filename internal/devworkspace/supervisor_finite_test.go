//go:build darwin || linux

package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestFiniteCommandFixture(t *testing.T) {
	if os.Getenv("OMNIVIEW_FINITE_STREAM_FIXTURE") == "" {
		return
	}
	fmt.Fprintln(os.Stdout, `{"ok":true}`)
	fmt.Fprintln(os.Stderr, "private diagnostic")
	time.Sleep(200 * time.Millisecond)
	os.Exit(0)
}

func TestFiniteOwnedCommandPreservesSeparateJSONAndDiagnostics(t *testing.T) {
	root, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(os.Args[0], "-test.run=^TestFiniteCommandFixture$")
	command.Dir = root
	command.Env = append(os.Environ(), "OMNIVIEW_FINITE_STREAM_FIXTURE=1")
	var stdout, stderr strings.Builder
	command.Stdout = &stdout
	command.Stderr = &stderr
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	owner := devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Role: "build", Source: root}
	if err = RunRepositoryCommand(ctx, command, owner); err != nil {
		t.Fatal(err)
	}
	var result struct {
		OK bool `json:"ok"`
	}
	if err = json.Unmarshal([]byte(stdout.String()), &result); err != nil || !result.OK {
		t.Fatalf("stderr contaminated actual JSON output: %q %v", stdout.String(), err)
	}
	if !strings.Contains(stderr.String(), "private diagnostic") {
		t.Fatal("actual diagnostics were lost")
	}
}

func TestFiniteCancellationWaitsForOwnedDescendantExit(t *testing.T) {
	root, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	pidFile := filepath.Join(root, "descendant.pid")
	command := exec.Command(os.Args[0], "-test.run=^TestOwnedChildProcessFixture$")
	command.Dir = root
	command.Env = append(os.Environ(), "OMNIVIEW_OWNED_CHILD_FIXTURE=parent", "OMNIVIEW_OWNED_PID_FILE="+pidFile, "OMNIVIEW_OWNED_EXIT_FILE="+filepath.Join(root, "never-exit"))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	owner := devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Role: "build", Source: root}
	done := make(chan error, 1)
	go func() { done <- RunRepositoryCommand(ctx, command, owner) }()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	var identity devcontract.ProcessIdentity
	descendantOwner := owner
	descendantOwner.Role = "build-descendant"
	for {
		data, readErr := os.ReadFile(pidFile)
		if readErr == nil {
			pid, parseErr := strconv.Atoi(string(data))
			if parseErr != nil {
				t.Fatal(parseErr)
			}
			identity, err = devsession.CaptureProcess(pid, descendantOwner)
			if err != nil {
				t.Fatal(err)
			}
			break
		}
		select {
		case err = <-done:
			t.Fatalf("producer exited before actual descendant: %v", err)
		case <-deadline.C:
			t.Fatal("actual descendant was not started")
		case <-time.After(10 * time.Millisecond):
		}
	}
	cancel()
	select {
	case err = <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("finite cancellation did not join owned tree disposal")
	}
	if !errors.Is(err, context.Canceled) || errors.Is(err, errOwnedCommandUncertain) {
		t.Fatalf("proven canceled tree has wrong lifetime classification: %v", err)
	}
	if err = devsession.VerifyOwnedProcess(identity, descendantOwner); !errors.Is(err, devsession.ErrProcessGone) {
		t.Fatalf("actual descendant survived canceled producer: %v", err)
	}
}

func TestFiniteCommandJoinsRetainedStartupUncertaintyBeforeReturning(t *testing.T) {
	root, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command("/bin/sleep", "300")
	command.Dir = root
	prepareOwnedCommand(command)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	// Reproduce a failed startup disposal: the actual Cmd, not a captured numeric
	// identity, remains the only authority to terminate this command's group.
	captureErr := errors.New("ownership capture temporarily unavailable")
	child := &ownedChild{command: command, done: make(chan struct{}), uncaptured: true, startErr: captureErr, disposalErr: errOwnedCommandUncertain, err: errors.Join(errOwnedCommandUncertain, captureErr)}
	close(child.done)
	defer child.stop(context.Background())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan error, 1)
	go func() { done <- joinRepositoryCommand(ctx, child) }()
	select {
	case err := <-done:
		if !errors.Is(err, captureErr) || !errors.Is(err, context.Canceled) || errors.Is(err, errOwnedCommandUncertain) {
			t.Fatalf("confirmed finite disposal has wrong error classification: %v", err)
		}
		child.mu.Lock()
		reaped := command.ProcessState != nil
		child.mu.Unlock()
		if !reaped {
			t.Fatal("finite caller returned with its sole actual Cmd still unreaped")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("finite caller could not join retained startup disposal")
	}
}

func TestFiniteCommandReturnsReapedOutputFailure(t *testing.T) {
	root, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	reader, writer := io.Pipe()
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	command := exec.Command(os.Args[0], "-test.run=^TestFiniteCommandFixture$")
	command.Dir = root
	command.Env = append(os.Environ(), "OMNIVIEW_FINITE_STREAM_FIXTURE=1")
	command.Stdout = writer
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	owner := devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Role: "build", Source: root}
	child, err := startOwnedChildCommand(ctx, command, owner, nil)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-child.done:
	case <-ctx.Done():
		t.Fatal("actual output failure did not complete the owned child")
	}
	child.mu.Lock()
	reaped := child.command.ProcessState != nil
	waitErr := child.waitErr
	child.mu.Unlock()
	if !reaped || !errors.Is(waitErr, io.ErrClosedPipe) {
		t.Fatalf("real command did not reach a reaped output failure: reaped=%v err=%v", reaped, waitErr)
	}
	done := make(chan error, 1)
	go func() { done <- joinRepositoryCommand(ctx, child) }()
	select {
	case err := <-done:
		if !errors.Is(err, io.ErrClosedPipe) || errors.Is(err, errOwnedCommandUncertain) {
			t.Fatalf("terminal output failure lost its cause or became disposal uncertainty: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("finite caller kept retrying disposal after its actual child was reaped")
	}
}
