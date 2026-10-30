//go:build darwin || linux

package devworkspace

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsession"
)

// The barrier runs only after checkout has changed the actual Git worktree and
// the overlays phase has reached durable storage. The retained process gives
// interruption a real process handle to dispose of, rather than an idle timer.
func TestActiveFollowCancellationAndDownRetainCapturedCohort(t *testing.T) {
	for _, action := range []string{"cancel", "down"} {
		t.Run(action, func(t *testing.T) { activeFollowInterruption(t, action) })
	}
}

func activeFollowInterruption(t *testing.T, action string) {
	t.Helper()
	m, w, remote, _ := upstreamFixture(t)
	target := upstreamCommit(t, remote, "component.ts", "export const revision = 1")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered, releaseBarrier := activeFollowBarrier(t, m, w)
	applying := 0
	done := make(chan error, 1)
	go func() {
		done <- m.Follow(ctx, w.Manifest.Slug, FollowOptions{Apply: true}, func(status FollowStatus) error {
			if status.Result == followApplying {
				applying++
			}
			return nil
		})
	}()
	var child *ownedChild
	select {
	case child = <-entered:
	case <-time.After(15 * time.Second):
		t.Fatal("follower did not reach durable post-checkout mutation")
	}
	t.Cleanup(func() { _ = child.stop(context.Background()) })
	captured, err := readSourceUpdate(m, w)
	require.NoError(t, err)
	require.Equal(t, sourceUpdateOverlays, captured.Phase)
	require.Equal(t, target, captured.Plan.Repositories[0].TargetSHA)
	require.Equal(t, target, fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD"))
	newest := upstreamCommit(t, remote, "component.ts", "export const revision = 2")
	downDone := interruptActiveFollow(t, m, w, action, cancel)
	releaseBarrier()
	select {
	case followErr := <-done:
		require.Error(t, followErr)
	case <-time.After(15 * time.Second):
		t.Fatal("active follower did not join interruption")
	}
	if downDone != nil {
		select {
		case downErr := <-downDone:
			require.NoError(t, downErr)
		case <-time.After(15 * time.Second):
			t.Fatal("down did not finish after active follower joined")
		}
	}
	select {
	case <-child.done:
	default:
		t.Fatal("follower returned before retained owned child joined")
	}
	require.Equal(t, 1, applying)
	retained, err := readSourceUpdate(m, w)
	require.NoError(t, err)
	require.Equal(t, captured, retained)
	m.afterDurablePhase = nil
	assertActiveFollowRecovery(t, m, w, target, newest)
}

func activeFollowBarrier(t *testing.T, m *Manager, w Workspace) (<-chan *ownedChild, func()) {
	t.Helper()
	entered := make(chan *ownedChild, 1)
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseBarrier := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(releaseBarrier)
	m.afterDurablePhase = func(kind, phase string) error {
		if kind != "source" || phase != sourceUpdateOverlays {
			return nil
		}
		owner := devsession.ProcessOwner{
			WorkspaceID: w.Manifest.WorkspaceID, Generation: NewGeneration(),
			Role: "active-update-barrier", Source: w.Root,
		}
		child, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard,
			owner, nil, "/bin/sleep", "300")
		if err != nil {
			return err
		}
		entered <- child
		<-release
		if stopErr := child.stop(context.Background()); stopErr != nil {
			return stopErr
		}
		return context.Canceled
	}
	return entered, releaseBarrier
}

func interruptActiveFollow(
	t *testing.T, m *Manager, w Workspace, action string, cancel context.CancelFunc,
) <-chan error {
	t.Helper()
	if action == "cancel" {
		cancel()
		return nil
	}
	downDone := make(chan error, 1)
	go func() {
		_, downErr := m.Down(context.Background(), w.Manifest.Slug)
		downDone <- downErr
	}()
	directory, err := followDirectory(m, w)
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		_, statErr := os.Stat(filepath.Join(directory, "follow-fence.json"))
		return statErr == nil
	}, 5*time.Second, 10*time.Millisecond)
	// Allow the real fence monitor to consume the newly persisted epoch.
	time.Sleep(2 * followFenceInterval)
	return downDone
}

func TestActiveFollowerCrashRetainsExactIntent(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	target := upstreamCommit(t, remote, "component.ts", "export const revision = 1")
	barrier := filepath.Join(t.TempDir(), "durable-phase")
	environment := append(os.Environ(), "OMNIVIEW_ACTIVE_FOLLOW_ROOT="+m.Root,
		"OMNIVIEW_ACTIVE_FOLLOW_HOME="+m.options.Home,
		"OMNIVIEW_ACTIVE_FOLLOW_BARRIER="+barrier)
	child, err := startOwnedChild(context.Background(), w.Root, environment, io.Discard,
		devsession.ProcessOwner{
			WorkspaceID: w.Manifest.WorkspaceID, Generation: NewGeneration(), Role: "follower", Source: w.Root,
		},
		nil, os.Args[0], "-test.run=^TestActiveFollowerCrashHelper$")
	require.NoError(t, err)
	t.Cleanup(func() { _ = child.stop(context.Background()) })
	require.Eventually(t, func() bool {
		_, statErr := os.Stat(barrier)
		return statErr == nil
	}, 15*time.Second, 10*time.Millisecond)
	captured, err := readSourceUpdate(m, w)
	require.NoError(t, err)
	require.Equal(t, sourceUpdateOverlays, captured.Phase)
	require.Equal(t, target, captured.Plan.Repositories[0].TargetSHA)
	require.Equal(t, target, fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD"))
	newest := upstreamCommit(t, remote, "component.ts", "export const revision = 2")
	// Kill the actual foreground follower without running its defers.
	require.NoError(t, child.stopTree(true))
	select {
	case <-child.done:
	case <-time.After(15 * time.Second):
		t.Fatal("crashed follower was not reaped")
	}
	retained, err := readSourceUpdate(m, w)
	require.NoError(t, err)
	require.Equal(t, captured, retained)
	// A new consent owner may observe the retained intent, but cannot replace it
	// with the newer upstream cohort or start any application.
	err = m.Follow(context.Background(), w.Manifest.Slug, FollowOptions{
		Apply: true,
		wait:  func(context.Context, time.Duration) error { return context.Canceled },
	}, func(status FollowStatus) error {
		require.Equal(t, "blocked_recovery", status.Result)
		require.Equal(t, captured.Plan.OperationID, status.ActiveOperation)
		return nil
	})
	require.ErrorIs(t, err, context.Canceled)
	retained, err = readSourceUpdate(m, w)
	require.NoError(t, err)
	require.Equal(t, captured, retained)
	assertActiveFollowRecovery(t, m, w, target, newest)
}

func TestActiveFollowerCrashHelper(t *testing.T) {
	root := os.Getenv("OMNIVIEW_ACTIVE_FOLLOW_ROOT")
	if root == "" {
		return
	}
	m, err := Open(root, Options{Home: os.Getenv("OMNIVIEW_ACTIVE_FOLLOW_HOME")})
	require.NoError(t, err)
	m.afterDurablePhase = func(kind, phase string) error {
		if kind == "source" && phase == sourceUpdateOverlays {
			barrier := os.Getenv("OMNIVIEW_ACTIVE_FOLLOW_BARRIER")
			if writeErr := os.WriteFile(barrier, []byte(phase), 0600); writeErr != nil {
				return writeErr
			}
			select {}
		}
		return nil
	}
	require.NoError(t, m.Follow(context.Background(), "upstream", FollowOptions{Apply: true}, nil))
}

func assertActiveFollowRecovery(t *testing.T, m *Manager, w Workspace, target, newest string) {
	t.Helper()
	result, found, err := m.resumeSourceUpdate(context.Background(), w.Manifest.Slug, RefreshOptions{})
	require.True(t, found)
	require.NoError(t, err)
	require.Equal(t, sourceUpdateComplete, result.Phase)
	require.Equal(t, target, result.Plan.Repositories[0].TargetSHA)
	require.NotEqual(t, newest, target)
	require.Equal(t, target, fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD"))
	require.NoFileExists(t, sourceUpdatePath(m, w))
	_, found, err = m.resumeSourceUpdate(context.Background(), w.Manifest.Slug, RefreshOptions{})
	require.NoError(t, err)
	require.False(t, found)
	status, err := m.Status(context.Background(), w.Manifest.Slug)
	require.NoError(t, err)
	require.Equal(t, "stopped", status.Phase)
	require.NotNil(t, status.Follow)
	require.False(t, status.Follow.Enabled)
}
