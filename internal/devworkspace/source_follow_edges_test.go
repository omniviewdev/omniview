//go:build darwin || linux

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

func TestSourceEdgesDependencyAuthorityBoundaries(t *testing.T) {
	cases := []struct {
		name       string
		path       string
		content    string
		workspace  bool
		dependency bool
	}{
		{"nested-package", "packages/widget/package.json", "{\"name\":\"widget\",\"version\":\"1.0.0\",\"private\":true}\n", false, true},
		{"nested-workspace", "tools/pnpm-workspace.yaml", "packages:\n  - packages/*\n", false, true},
		{"patch", "patches/widget.patch", "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n", false, true},
		{"hook", "tools/.pnpmfile.cjs", "module.exports = { hooks: {} };\n", false, true},
		{"module-hook", "tools/.pnpmfile.mjs", "export default { hooks: {} };\n", false, true},
		{"root-lock", "pnpm-lock.yaml", "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n", false, true},
		{"nested-workspace-lock", "tools/pnpm-lock.yaml", "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n", true, true},
		{"non-workspace-lock", "tools/pnpm-lock.yaml", "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n", false, false},
		{"ordinary-source", "packages/widget/component.ts", "export const dependencyBoundarySentinel = true;\n", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m, w, remote, source := upstreamFixture(t)
			checkout := filepath.Join(w.Root, "omniview")
			before := fixtureGit(t, checkout, "rev-parse", "HEAD")
			canonical := fixtureGit(t, source, "rev-parse", "HEAD")
			baseline, err := m.PlanUpdate(context.Background(), w.Manifest.WorkspaceID, UpdateOptions{})
			require.NoError(t, err)
			require.NoError(t, os.MkdirAll(filepath.Dir(filepath.Join(remote, tc.path)), 0700))
			if tc.workspace {
				upstreamCommit(t, remote, "tools/pnpm-workspace.yaml", "packages:\n  - packages/*\n")
			}
			target := upstreamCommit(t, remote, tc.path, tc.content)
			plan, err := m.PlanUpdate(context.Background(), w.Manifest.WorkspaceID, UpdateOptions{})
			require.NoError(t, err)
			require.Equal(t, "update_available", plan.Result)
			require.Equal(t, target, plan.Repositories[0].TargetSHA)
			require.Equal(t, tc.dependency, plan.DependencyChanged)
			if tc.dependency {
				require.NotEqual(t, baseline.CompositionFingerprint, plan.CompositionFingerprint)
			} else {
				require.Equal(t, baseline.CompositionFingerprint, plan.CompositionFingerprint)
				result, applyErr := m.applyPlannedUpdate(context.Background(), w.Manifest.WorkspaceID, plan, UpdateOptions{})
				require.NoError(t, applyErr)
				require.NotNil(t, result.Plan)
				require.Equal(t, target, fixtureGit(t, checkout, "rev-parse", "HEAD"))
			}
			if tc.dependency {
				// No composition evidence or launch is configured. Dependency updates
				// must refuse rather than silently taking the source-only shortcut.
				_, applyErr := m.applyPlannedUpdate(context.Background(), w.Manifest.WorkspaceID, plan, UpdateOptions{})
				require.Error(t, applyErr)
				require.Equal(t, before, fixtureGit(t, checkout, "rev-parse", "HEAD"))
			}
			require.Equal(t, canonical, fixtureGit(t, source, "rev-parse", "HEAD"))
		})
	}
}

func TestSourceEdgesFollowConsentDoesNotExpandAfterEdit(t *testing.T) {
	for _, change := range []string{"configuration", "selection"} {
		t.Run(change, func(t *testing.T) {
			m, w, remote, _ := upstreamFixture(t)
			checkout := filepath.Join(w.Root, "omniview")
			before := fixtureGit(t, checkout, "rev-parse", "HEAD")
			var target string
			waits, applied := 0, 0
			revoked := 0
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			err := m.Follow(ctx, w.Manifest.WorkspaceID, FollowOptions{
				Apply: true,
				wait: func(context.Context, time.Duration) error {
					waits++
					if waits > 1 {
						return context.Canceled
					}
					options := EditOptions{PreserveSelection: true}
					if change == "configuration" {
						fixtureGit(t, remote, "checkout", "-b", "alternate")
						options.Upstreams = map[string]string{"omniview": "origin/alternate"}
					} else {
						options.AddRepositories = []string{"plugin-sdk"}
					}
					_, editErr := m.Edit(ctx, w.Manifest.WorkspaceID, options)
					require.NoError(t, editErr)
					target = upstreamCommit(t, remote, "component.ts", "export const afterEdit = true\n")
					return nil
				},
			}, func(status FollowStatus) error {
				if status.Result == followApplied {
					applied++
				}
				if status.Result == "consent_revoked" {
					revoked++
					require.False(t, status.Enabled)
					require.Equal(t, "configuration_changed", status.BlockedReason)
					require.Nil(t, status.Plan)
					require.Empty(t, status.PendingCohort)
					require.Empty(t, status.NextCommand)
					require.Empty(t, status.NextArgv)
				}
				return nil
			})
			require.NoError(t, err)
			require.Equal(t, 1, revoked)
			require.NotEmpty(t, target)
			require.Zero(t, applied)
			require.Equal(t, before, fixtureGit(t, checkout, "rev-parse", "HEAD"))
			require.NoFileExists(t, sourceUpdatePath(m, w))
			current, inspectErr := m.Inspect(context.Background(), w.Manifest.WorkspaceID)
			require.NoError(t, inspectErr)
			require.NotEqual(t, UpdateConfigurationFingerprint(w.Manifest), UpdateConfigurationFingerprint(current.Manifest))
		})
	}
}

func TestSourceEdgesPreCanceledHeldAuthorityPreservesCapturedIntent(t *testing.T) {
	m, w, plan := sourcePlanFixture(t)
	intent := sourceUpdateIntent{WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan}
	require.NoError(t, saveSourceUpdate(m, w, &intent, sourceUpdatePrepared))
	before, err := os.ReadFile(sourceUpdatePath(m, w))
	require.NoError(t, err)
	directory, err := followDirectory(m, w)
	require.NoError(t, err)
	release, err := tryLock(filepath.Join(directory, "refresh.lock"))
	require.NoError(t, err)
	defer func() {
		if release != nil {
			release()
		}
	}()
	// The production wait has no lock-attempt admission hook. This checks a
	// pre-canceled caller against a held lock, not cancellation after admission.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	unlock, err := m.waitUpdateAuthority(ctx, w.Manifest.WorkspaceID)
	require.ErrorIs(t, err, context.Canceled)
	require.Nil(t, unlock)
	after, err := os.ReadFile(sourceUpdatePath(m, w))
	require.NoError(t, err)
	require.Equal(t, before, after)
	for _, repository := range plan.Repositories {
		path, pathErr := w.RepositoryPath(repository.ID)
		require.NoError(t, pathErr)
		require.Equal(t, repository.ActualHEAD, fixtureGit(t, path, "rev-parse", "HEAD"))
	}
	release()
	release = nil
	joined, err := m.waitUpdateAuthority(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	joined()
}

func TestSourceEdgesDependencyRecoveryRejectsLaunchOverrides(t *testing.T) {
	for _, change := range []string{"mode", "watch", "frontend", "baseline", "timeout"} {
		t.Run(change, func(t *testing.T) {
			m, w, plan := refreshPhaseFixture(t)
			launch := LaunchOptions{
				Mode: "browser", Watch: true, Timeout: time.Minute,
				ReviewedSDKRevision: fixtureGit(t, filepath.Join(m.Root, "plugin-sdk"), "rev-parse", "HEAD"),
			}
			evidence := LinkProtocolEvidence{
				Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true,
			}
			m.afterDurablePhase = func(kind, phase string) error {
				if kind == "refresh" && phase == refreshStop {
					return errPhaseInterrupted
				}
				return nil
			}
			refs := map[string]string{}
			for _, repository := range plan.Repositories {
				refs[repository.ID] = repository.TargetSHA
			}
			_, err := m.refresh(context.Background(), w.Manifest.WorkspaceID,
				RefreshOptions{Launch: &launch, Evidence: evidence, plan: &plan}, refs)
			require.ErrorIs(t, err, errPhaseInterrupted)
			m.afterDurablePhase = nil
			path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
			before, err := os.ReadFile(path)
			require.NoError(t, err)
			manifest, err := os.ReadFile(w.ManifestPath)
			require.NoError(t, err)
			override := launch
			switch change {
			case "mode":
				override.Mode = "native"
			case "watch":
				override.Watch = false
			case "frontend":
				override.LiveFrontend = true
			case "baseline":
				override.BaselineSource = filepath.Join(t.TempDir(), "different baseline")
			case "timeout":
				override.Timeout = 2 * time.Minute
			}
			_, err = m.Recover(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{Launch: &override})
			var typed *devcontract.Error
			require.ErrorAs(t, err, &typed)
			require.Equal(t, "refresh_intent_mismatch", typed.Code)
			after, readErr := os.ReadFile(path)
			require.NoError(t, readErr)
			require.Equal(t, before, after)
			current, readErr := os.ReadFile(w.ManifestPath)
			require.NoError(t, readErr)
			require.Equal(t, manifest, current)
			for _, repository := range plan.Repositories {
				checkout, pathErr := w.RepositoryPath(repository.ID)
				require.NoError(t, pathErr)
				require.Equal(t, repository.ActualHEAD, fixtureGit(t, checkout, "rev-parse", "HEAD"))
			}
			require.NoFileExists(t, sourceUpdatePath(m, w))
		})
	}
}

func TestSourceEdgesCanceledAuthorityRequestCannotAcquireFreeLock(t *testing.T) {
	m, w, plan := sourcePlanFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	release, err := m.waitUpdateAuthority(ctx, w.Manifest.WorkspaceID)
	if release != nil {
		release()
	}
	require.ErrorIs(t, err, context.Canceled)
	require.Nil(t, release)
	require.NoFileExists(t, sourceUpdatePath(m, w))
	for _, repository := range plan.Repositories {
		checkout, pathErr := w.RepositoryPath(repository.ID)
		require.NoError(t, pathErr)
		require.Equal(t, repository.ActualHEAD, fixtureGit(t, checkout, "rev-parse", "HEAD"))
	}
}
