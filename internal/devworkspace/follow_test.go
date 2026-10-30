package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestFollowRejectsFastPollingBeforeWorkspaceResolution(t *testing.T) {
	m, _ := fixtureManager(t)
	err := m.Follow(context.Background(), "missing", FollowOptions{Interval: time.Second}, nil)
	require.ErrorContains(t, err, "at least 5s")
}

func TestObserveFollowPreservesCheckoutAndCancellationLeavesStopped(t *testing.T) {
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "observe"})
	require.NoError(t, err)
	before := refValue(context.Background(), filepath.Join(w.Root, "omniview"), "HEAD")
	ctx, cancel := context.WithCancel(context.Background())
	count := 0
	err = m.Follow(ctx, "observe", FollowOptions{Interval: 5 * time.Second}, func(status FollowStatus) error {
		count++
		require.False(t, status.Apply)
		require.Equal(t, w.Manifest.WorkspaceID, status.WorkspaceID)
		cancel()
		return nil
	})
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 1, count)
	require.Equal(t, before, refValue(context.Background(), filepath.Join(w.Root, "omniview"), "HEAD"))
	status, err := m.Status(context.Background(), "observe")
	require.NoError(t, err)
	require.Equal(t, "stopped", status.Phase)
	require.NotNil(t, status.Follow)
	require.False(t, status.Follow.Enabled)
}

func TestFollowLeaseRejectsDuplicateAndFenceStopsIdleOwner(t *testing.T) {
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "follow-owner"})
	require.NoError(t, err)
	dir, err := followDirectory(m, w)
	require.NoError(t, err)
	unlock, err := tryLock(filepath.Join(dir, "follow.lock"))
	require.NoError(t, err)
	err = m.Follow(context.Background(), "follow-owner", FollowOptions{}, nil)
	require.ErrorContains(t, err, "another foreground follower")
	unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	observed := false
	err = m.Follow(ctx, "follow-owner", FollowOptions{}, func(FollowStatus) error {
		observed = true
		return m.fenceFollow(context.Background(), "follow-owner")
	})
	require.True(t, observed)
	require.NoError(t, err)
	require.NoError(t, os.Remove(filepath.Join(dir, "follow-status.json")))
}

func TestFollowCohortIdentityIgnoresObservationMetadata(t *testing.T) {
	first := UpdatePlan{OperationID: "first", Repositories: []RepositoryUpdatePlan{{ID: "omniview", TargetSHA: "target"}}}
	second := first
	second.OperationID = "second"
	second.Result = "update_available"
	require.Equal(t, cohortKey(first), cohortKey(second))
	second.Repositories = []RepositoryUpdatePlan{{ID: "omniview", TargetSHA: "next"}}
	require.NotEqual(t, cohortKey(first), cohortKey(second))
}

func TestFollowFenceIntegrityChangesRevokeConsent(t *testing.T) {
	for _, change := range []string{"malformed", "removed"} {
		t.Run(change, func(t *testing.T) {
			m, _ := fixtureManager(t)
			w, err := m.Create(context.Background(), CreateOptions{Slug: "fence-integrity"})
			require.NoError(t, err)
			require.NoError(t, m.fenceFollow(context.Background(), "fence-integrity"))
			directory, err := followDirectory(m, w)
			require.NoError(t, err)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			err = m.Follow(ctx, "fence-integrity", FollowOptions{}, func(FollowStatus) error {
				path := filepath.Join(directory, "follow-fence.json")
				if change == "removed" {
					return os.Remove(path)
				}
				return os.WriteFile(path, []byte("{"), 0600)
			})
			var typed *devcontract.Error
			require.ErrorAs(t, err, &typed)
			require.Equal(t, "follow_fence_invalid", typed.Code)
			require.Equal(t, followConflictExit, typed.Exit)
			status, statusErr := m.Status(context.Background(), "fence-integrity")
			require.NoError(t, statusErr)
			require.Equal(t, "stopped", status.Phase)
		})
	}
}

func TestFollowBackoffCapsAndClockControlsScheduling(t *testing.T) {
	require.Equal(t, 60*time.Second, followBackoff(30*time.Second))
	require.Equal(t, 5*time.Minute, followBackoff(240*time.Second))
	require.Equal(t, 5*time.Minute, followBackoff(5*time.Minute))
	m, _ := fixtureManager(t)
	_, err := m.Create(context.Background(), CreateOptions{Slug: "clock"})
	require.NoError(t, err)
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	observations := 0
	err = m.Follow(context.Background(), "clock", FollowOptions{
		Interval: 30 * time.Second,
		now:      func() time.Time { return now },
		wait:     func(context.Context, time.Duration) error { return context.Canceled },
	}, func(status FollowStatus) error {
		observations++
		require.Equal(t, now, status.LastObservation)
		require.Equal(t, now.Add(30*time.Second), status.NextAttempt)
		return nil
	})
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 1, observations)
}

func TestFollowRetainsFailedBuildCohortWhenCheckoutIsCurrent(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	upstreamCommit(t, remote, "component.ts", "export const marker = 'new'")
	result, err := m.Update(context.Background(), w.Manifest.Slug, UpdateOptions{})
	require.NoError(t, err)
	require.NotNil(t, result.Plan)
	current, err := m.Inspect(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	intent := sourceUpdateIntent{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: *result.Plan, Phase: "build", Running: true,
	}
	require.NoError(t, saveSourceUpdate(m, current, &intent, "build"))
	observed := 0
	err = m.Follow(context.Background(), w.Manifest.Slug, FollowOptions{
		Apply: true,
		wait:  func(context.Context, time.Duration) error { return context.Canceled },
	}, func(status FollowStatus) error {
		observed++
		require.Equal(t, "blocked_recovery", status.Result)
		require.Equal(t, "explicit_recovery_required", status.BlockedReason)
		require.Equal(t, result.Plan.OperationID, status.ActiveOperation)
		require.Contains(t, status.NextArgv, "recover")
		return nil
	})
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 1, observed)
	retained, err := readSourceUpdate(m, current)
	require.NoError(t, err)
	require.Equal(t, "build", retained.Phase)
	require.Equal(t, intent.Plan.OperationID, retained.Plan.OperationID)
}

func TestApplyFollowSerializesSuccessorAndSkipsDuplicateCohorts(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	first := upstreamCommit(t, remote, "component.ts", "export const revision = 1")
	var newest string
	applied := 0
	waits := 0
	err := m.Follow(context.Background(), w.Manifest.Slug, FollowOptions{
		Apply: true,
		wait: func(context.Context, time.Duration) error {
			waits++
			if waits == 3 {
				return context.Canceled
			}
			return nil
		},
	}, func(status FollowStatus) error {
		if status.Result == "applying" && newest == "" {
			upstreamCommit(t, remote, "component.ts", "export const revision = 2")
			newest = upstreamCommit(t, remote, "component.ts", "export const revision = 3")
		}
		if status.Result == "applied" {
			applied++
			head := fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD")
			if applied == 1 {
				require.Equal(t, first, head)
			} else {
				require.Equal(t, newest, head)
			}
		}
		return nil
	})
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 2, applied)
	require.Equal(t, newest, fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD"))
	require.NoFileExists(t, sourceUpdatePath(m, w))
}

func TestApplyFollowDoesNotAdoptChangedPolicyAfterOwnProgress(t *testing.T) {
	m, w, remote, source := upstreamFixture(t)
	checkout := filepath.Join(w.Root, "omniview")
	canonical := fixtureGit(t, source, "rev-parse", "HEAD")
	first := upstreamCommit(t, remote, "component.ts", "export const revision = 1")
	applied, waits := 0, 0
	revoked := false
	err := m.Follow(context.Background(), w.Manifest.WorkspaceID, FollowOptions{
		Apply: true,
		wait: func(ctx context.Context, _ time.Duration) error {
			waits++
			if waits > 1 {
				return context.Canceled
			}
			current, inspectErr := m.Inspect(ctx, w.Manifest.WorkspaceID)
			require.NoError(t, inspectErr)
			require.NotEqual(t, UpdateConfigurationFingerprint(w.Manifest),
				UpdateConfigurationFingerprint(current.Manifest))
			require.Equal(t, followConfigurationFingerprint(w.Manifest),
				followConfigurationFingerprint(current.Manifest))
			fixtureGit(t, remote, "checkout", "-b", "alternate")
			_, editErr := m.Edit(ctx, w.Manifest.WorkspaceID, EditOptions{
				PreserveSelection: true, Upstreams: map[string]string{"omniview": "origin/alternate"},
			})
			require.NoError(t, editErr)
			upstreamCommit(t, remote, "component.ts", "export const revision = 2")
			return nil
		},
	}, func(status FollowStatus) error {
		if status.Result == followApplied {
			applied++
		}
		if status.Result == "consent_revoked" {
			require.False(t, status.Enabled)
			require.Equal(t, "configuration_changed", status.BlockedReason)
			require.Nil(t, status.Plan)
			require.Empty(t, status.PendingCohort)
			require.Empty(t, status.NextCommand)
			require.Empty(t, status.NextArgv)
			revoked = true
		}
		return nil
	})
	require.NoError(t, err)
	require.True(t, revoked)
	require.Equal(t, 1, applied)
	require.Equal(t, first, fixtureGit(t, checkout, "rev-parse", "HEAD"))
	require.Equal(t, canonical, fixtureGit(t, source, "rev-parse", "HEAD"))
	require.NoFileExists(t, sourceUpdatePath(m, w))
}

func TestFinishFollowIntegrityOverridesConcurrentConfigurationRevocation(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(errFollowFenceIntegrity)
	status := FollowStatus{Enabled: true, BlockedReason: "configuration_changed"}
	published := 0
	err := finishFollow(ctx, &status, false, func() error {
		published++
		require.False(t, status.Enabled)
		require.Equal(t, updateBlocked, status.Result)
		require.Equal(t, "follow_fence_invalid", status.BlockedReason)
		return nil
	}, errFollowConsentRevoked)
	var typed *devcontract.Error
	require.ErrorAs(t, err, &typed)
	require.Equal(t, "follow_fence_invalid", typed.Code)
	require.Equal(t, followConflictExit, typed.Exit)
	require.Equal(t, 1, published)
}

func TestFinishFollowConfigurationRevocationClearsActionableObservation(t *testing.T) {
	status := FollowStatus{
		Enabled: true, Result: "blocked_recovery", BlockedReason: "configuration_changed",
		Plan: &UpdatePlan{OperationID: "old-operation"}, PendingCohort: "old-cohort",
		ActiveOperation: "old-operation",
		NextCommand:     "omniview-dev workspace recover old", NextArgv: []string{"workspace", "recover", "old"},
		NextAttempt: time.Now().Add(time.Minute),
	}
	published := 0
	err := finishFollow(context.Background(), &status, false, func() error {
		published++
		require.Equal(t, "consent_revoked", status.Result)
		require.False(t, status.Enabled)
		require.True(t, status.NextAttempt.IsZero())
		require.Nil(t, status.Plan)
		require.Empty(t, status.PendingCohort)
		require.Empty(t, status.ActiveOperation)
		require.Empty(t, status.NextCommand)
		require.Empty(t, status.NextArgv)
		return nil
	}, errFollowConsentRevoked)
	require.NoError(t, err)
	require.Equal(t, 1, published)
}

func TestFinishFollowInterruptedApplyRetainsRecoveryAuthority(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(errFollowConsentRevoked)
	plan := &UpdatePlan{OperationID: "interrupted-operation"}
	status := FollowStatus{
		Result: "blocked_recovery", BlockedReason: "explicit_recovery_required",
		ActiveOperation: plan.OperationID, Plan: plan, PendingCohort: "captured-cohort",
		NextCommand: "omniview workspace recover owned", NextArgv: []string{"workspace", "recover", "owned"},
	}
	before := status
	err := finishFollow(ctx, &status, true, func() error {
		t.Fatal("consent revocation must not replace interrupted recovery status")
		return nil
	}, context.Canceled)
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, before, status)
}

func TestApplyFollowPausesDirtySourceAndRevalidatesAfterUserFix(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	target := upstreamCommit(t, remote, "component.ts", "export const remote = true")
	path := filepath.Join(w.Root, "omniview", "README")
	original, err := os.ReadFile(path)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, []byte("authored edit"), 0600))
	blocked := 0
	applied := 0
	waits := 0
	err = m.Follow(context.Background(), w.Manifest.Slug, FollowOptions{
		Apply: true,
		wait: func(context.Context, time.Duration) error {
			waits++
			if waits == 1 {
				return os.WriteFile(path, original, 0600)
			}
			return context.Canceled
		},
	}, func(status FollowStatus) error {
		if status.Result == "blocked" {
			blocked++
			bytes, readErr := os.ReadFile(path)
			require.NoError(t, readErr)
			require.Equal(t, "authored edit", string(bytes))
		}
		if status.Result == "applied" {
			applied++
		}
		return nil
	})
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 1, blocked)
	require.Equal(t, 1, applied)
	require.Equal(t, target, fixtureGit(t, filepath.Join(w.Root, "omniview"), "rev-parse", "HEAD"))
}

func TestFollowNetworkBackoffResetsAfterRealRemoteRecovers(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	unreachable := remote + "-offline"
	require.NoError(t, os.Rename(remote, unreachable))
	delays := []time.Duration{}
	err := m.Follow(context.Background(), w.Manifest.Slug, FollowOptions{
		Interval: 5 * time.Second,
		wait: func(_ context.Context, delay time.Duration) error {
			delays = append(delays, delay)
			switch len(delays) {
			case 2:
				return os.Rename(unreachable, remote)
			case 3:
				return context.Canceled
			}
			return nil
		},
	}, nil)
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, []time.Duration{10 * time.Second, 20 * time.Second, 5 * time.Second}, delays)
}
