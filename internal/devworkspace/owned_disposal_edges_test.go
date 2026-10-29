//go:build darwin || linux

package devworkspace

import (
	"context"
	"errors"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

func TestOwnedChildCancellationDuringBlockedDisposal(t *testing.T) {
	w := generatedFixture(t)
	owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: NewGeneration(), Role: "host", Source: w.Root}
	var finalized atomic.Int32
	child, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard, owner,
		func() error { finalized.Add(1); return nil }, "/bin/sleep", "300")
	require.NoError(t, err)
	realStopTree := child.stopTree
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var enteredOnce, releaseOnce, finishedOnce sync.Once
	denied := errors.New("test-owned disposal remains uncertain")
	child.stopTree = func(bool) error {
		enteredOnce.Do(func() { close(entered) })
		<-release
		finishedOnce.Do(func() { close(finished) })
		return denied
	}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { result <- child.stop(ctx) }()
	joined := false
	t.Cleanup(func() {
		cancel()
		releaseOnce.Do(func() { close(release) })
		if !joined {
			select {
			case <-result:
			case <-time.After(3 * time.Second):
				t.Error("blocked test disposal did not return after release")
				return
			}
		}
		select {
		case <-finished:
		case <-time.After(3 * time.Second):
			t.Error("test disposal callback did not finish after release")
			return
		}
		child.signalMu.Lock()
		attempt := child.signal
		child.signalMu.Unlock()
		if attempt != nil {
			select {
			case <-attempt.done:
			case <-time.After(3 * time.Second):
				t.Error("retained signal attempt did not finish after release")
				return
			}
		}
		child.stopTree = realStopTree
		cleanup, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if err := child.stop(cleanup); err != nil {
			t.Errorf("exact-owned child cleanup failed: %v", err)
		}
		if finalized.Load() != 1 {
			t.Errorf("confirmed disposal finalized %d times", finalized.Load())
		}
	})
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("stop did not enter the disposal barrier")
	}
	cancel()
	select {
	case err := <-result:
		joined = true
		require.ErrorIs(t, err, context.Canceled)
	case <-time.After(time.Second):
		t.Error("caller cancellation cannot escape a blocked disposal attempt")
	}
	// Cancellation is not permission to attest output or discard ownership.
	require.Zero(t, finalized.Load())
	require.NoError(t, devsession.VerifyOwnedProcess(child.identity, owner))
	child.mu.Lock()
	disposed := child.disposed
	child.mu.Unlock()
	require.False(t, disposed)
}
