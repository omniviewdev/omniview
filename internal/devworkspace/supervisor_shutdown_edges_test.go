//go:build darwin || linux

package devworkspace

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

func TestSupervisorShutdownEdgesLateFeedbackCannotRestoreReady(t *testing.T) {
	s := supervisorEdgeFixture(t)
	s.setPhase("stopping", nil)
	s.sessionCancel()
	s.failed(context.Canceled)
	_ = s.commitFeedback(s.sessionContext, WatchChange{})
	require.NotEqual(t, "ready", s.snapshot().Phase, "late producer completion cannot undo an admitted shutdown")
	var saved Status
	require.NoError(t, readLaunchJSON(launchPath(s.workspace, "launch-status.json"), &saved))
	require.NotEqual(t, "ready", saved.Phase)
}

func TestSupervisorShutdownEdgesPersistCurrentWaitStage(t *testing.T) {
	s := supervisorEdgeFixture(t)
	s.setPhase("stopping", nil)
	for _, stage := range []string{"build-authority", "feedback", "host", "leases"} {
		s.setWaitStage(stage)
		var saved Status
		require.NoError(t, readLaunchJSON(launchPath(s.workspace, "launch-status.json"), &saved))
		require.Equal(t, stage, saved.WaitStage, "crash history must identify the last reached ownership barrier")
	}
	s.setPhase("stopped", nil)
	var saved Status
	require.NoError(t, readLaunchJSON(launchPath(s.workspace, "launch-status.json"), &saved))
	require.Empty(t, saved.WaitStage)
}

func TestSupervisorShutdownEdgesHelper(t *testing.T) {
	if os.Getenv("OMNIVIEW_SHUTDOWN_EDGE_HELPER") != "1" {
		return
	}
	m, err := Open(os.Getenv("OMNIVIEW_SHUTDOWN_EDGE_ROOT"), Options{Home: os.Getenv("OMNIVIEW_SHUTDOWN_EDGE_HOME")})
	require.NoError(t, err)
	require.NoError(t, m.ServeSupervisor(context.Background(), os.Getenv("OMNIVIEW_SHUTDOWN_EDGE_WORKSPACE"), io.Discard))
}

func TestSupervisorShutdownEdgesCanceledStopEventuallyReleasesOwner(t *testing.T) {
	s := supervisorEdgeFixture(t)
	w := s.workspace
	options := LaunchOptions{Mode: "browser", ReviewedSDKRevision: w.Manifest.Repositories[0].BaseCommit, Timeout: 10 * time.Second}
	require.NoError(t, saveLaunchJSON(launchPath(w, "launch.json"), options))
	provider := filepath.Join(w.Root, "omniview", "packages", "omniviewdev-providers")
	require.NoError(t, os.MkdirAll(provider, 0700))
	fifo := filepath.Join(provider, "package.json")
	require.NoError(t, syscall.Mkfifo(fifo, 0600))
	cmd := exec.Command(os.Args[0], "-test.run=^TestSupervisorShutdownEdgesHelper$")
	cmd.Env = append(os.Environ(), "OMNIVIEW_SHUTDOWN_EDGE_HELPER=1", "OMNIVIEW_SHUTDOWN_EDGE_ROOT="+s.manager.Root,
		"OMNIVIEW_SHUTDOWN_EDGE_HOME="+s.manager.options.Home, "OMNIVIEW_SHUTDOWN_EDGE_WORKSPACE="+w.Manifest.WorkspaceID)
	var output bytes.Buffer
	cmd.Stdout, cmd.Stderr = &output, &output
	require.NoError(t, cmd.Start())
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	type fifoResult struct {
		file *os.File
		err  error
	}
	opened := make(chan fifoResult, 1)
	go func() {
		file, err := os.OpenFile(fifo, os.O_WRONLY, 0600)
		opened <- fifoResult{file, err}
	}()
	var writer *os.File
	joined, openedJoined := false, false
	defer func() {
		if writer != nil {
			_ = writer.Close()
		}
		if !joined {
			_ = cmd.Process.Kill()
			<-done
		}
		if !openedJoined {
			// Release the writer if the child failed before reaching the FIFO.
			reader, err := os.OpenFile(fifo, os.O_RDONLY|syscall.O_NONBLOCK, 0600)
			if err == nil {
				result := <-opened
				if result.file != nil {
					_ = result.file.Close()
				}
				_ = reader.Close()
			}
		}
	}()
	select {
	case result := <-opened:
		openedJoined = true
		require.NoError(t, result.err)
		writer = result.file
	case err := <-done:
		joined = true
		t.Fatalf("supervisor exited before launch reached its file barrier: %v\n%s", err, output.String())
	case <-time.After(5 * time.Second):
		t.Fatal("launch did not reach its owned build-authority barrier")
	}
	var record supervisorRecord
	require.NoError(t, readLaunchJSON(launchPath(w, "supervisor.json"), &record))
	token, err := readSupervisorToken(w, record)
	require.NoError(t, err)
	stopCtx, cancelStop := context.WithTimeout(context.Background(), 150*time.Millisecond)
	_, err = callSupervisor(stopCtx, record, token, supervisorStopCommand)
	cancelStop()
	require.ErrorIs(t, err, context.DeadlineExceeded)
	observeCtx, cancelObserve := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelObserve()
	for {
		status, err := callSupervisor(observeCtx, record, token, supervisorStatusCommand)
		require.NoError(t, err)
		if status.Phase == "error" {
			break
		}
		require.NoError(t, observeCtx.Err(), "stop cancellation was not published while launch remained blocked")
	}
	require.NoError(t, writer.Close())
	writer = nil
	select {
	case err := <-done:
		joined = true
		require.NoError(t, err, "%s", output.String())
	case <-time.After(3 * time.Second):
		t.Fatal("launch cleanup finished but supervisor retained its process and workspace lock")
	}
	err = devsession.VerifyOwnedProcess(record.Process, devsession.ProcessOwner{WorkspaceID: record.WorkspaceID,
		Generation: record.Generation, Role: "supervisor", Source: w.Root})
	require.True(t, errors.Is(err, devsession.ErrProcessGone), "supervisor child must be reaped: %v", err)
	lockPath, err := GeneratedLockPath(w, "supervisor")
	require.NoError(t, err)
	lockCtx, cancelLock := context.WithTimeout(context.Background(), time.Second)
	defer cancelLock()
	lock, err := devsession.AcquirePrivateLock(lockCtx, filepath.Dir(lockPath), filepath.Base(lockPath))
	require.NoError(t, err)
	require.NoError(t, lock.Unlock())
}
