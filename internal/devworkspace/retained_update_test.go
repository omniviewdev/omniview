package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestFollowRetainsRecoveryGuidanceWhenApplyingLinksPreventPlanning(t *testing.T) {
	m, w, links := recoveryFixture(t)
	links.Phase = "applying"
	require.NoError(t, saveLinkJournal(links))
	plan := UpdatePlan{WorkspaceID: w.Manifest.WorkspaceID, OperationID: "retained-install", Result: "update_available"}
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
	intent := refreshIntent{WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: "install", Plan: &plan}
	require.NoError(t, atomicOwnedJSON(path, intent, w.Manifest.WorkspaceID))
	_, planErr := m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{})
	require.Error(t, planErr)
	emitted := 0
	err := m.Follow(context.Background(), w.Manifest.Slug, FollowOptions{
		Apply: true,
		wait:  func(context.Context, time.Duration) error { return context.Canceled },
	}, func(status FollowStatus) error {
		emitted++
		require.Equal(t, "blocked_recovery", status.Result)
		require.Equal(t, "retained-install", status.ActiveOperation)
		require.Contains(t, status.NextArgv, "recover")
		require.Contains(t, status.NextCommand, shellArgument(m.Root))
		return nil
	})
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 1, emitted)
	retained, err := loadLinkJournal(w)
	require.NoError(t, err)
	require.Equal(t, "applying", retained.Phase)
}

func TestLateRefreshRecoveryRefusesDifferentCompletedCohort(t *testing.T) {
	for _, phase := range []string{"install", "start", "verify"} {
		for _, change := range []string{"descendant", "upstream"} {
			t.Run(phase+"/"+change, func(t *testing.T) {
				m, w, plan := sourcePlanFixture(t)
				_, err := m.applySourceUpdate(context.Background(), w.Manifest.Slug, plan, UpdateOptions{})
				require.NoError(t, err)
				require.NoError(t, m.validateFinalRefreshCohort(context.Background(), w.Manifest.Slug, &plan))
				if change == "descendant" {
					checkout := filepath.Join(w.Root, "omniview")
					require.NoError(t, os.WriteFile(filepath.Join(checkout, "descendant.txt"), []byte("user commit"), 0600))
					fixtureGit(t, checkout, "add", "descendant.txt")
					fixtureGit(t, checkout, "commit", "-m", "preserve user descendant")
				} else {
					j, loadErr := loadJournal(w.Root)
					require.NoError(t, loadErr)
					j.Manifest.Repositories[0].Upstream = &devcontract.RepositoryUpstream{
						Remote: "different", Branch: "refs/heads/main",
					}
					j.Resources[0].Repository = j.Manifest.Repositories[0]
					require.NoError(t, writeManifest(w.Root, j.Manifest))
					require.NoError(t, saveJournal(w.Root, j))
				}
				evidence := LinkProtocolEvidence{
					Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true,
				}
				intent := refreshIntent{
					WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: phase, Plan: &plan, Evidence: evidence,
					Launch: LaunchOptions{Mode: "browser", ReviewedSDKRevision: strings.Repeat("a", 40)},
				}
				path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
				require.NoError(t, atomicOwnedJSON(path, intent, w.Manifest.WorkspaceID))
				_, err = m.refresh(context.Background(), w.Manifest.Slug, RefreshOptions{}, nil)
				var typed *devcontract.Error
				require.ErrorAs(t, err, &typed)
				require.Equal(t, "refresh_intent_mismatch", typed.Code)
				require.NoFileExists(t, filepath.Join(w.Root, ".local", "supervisor.json"))
			})
		}
	}
}
