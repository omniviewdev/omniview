//go:build darwin || linux

package devworkspace

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func sourceCompatibilitySupervisor(t *testing.T, w Workspace, current bool) (*ownedChild, <-chan string) {
	t.Helper()
	return sourceCompatibilitySupervisorStatus(t, w, current, func() Status {
		return Status{Workspace: w, Phase: "ready"}
	})
}

// sourceCompatibilitySupervisorStatus serves the status produced by live, so a
// test can report what the real supervisor snapshot reports.
func sourceCompatibilitySupervisorStatus(t *testing.T, w Workspace, current bool, live func() Status) (*ownedChild, <-chan string) {
	t.Helper()
	generation := NewGeneration()
	owner := devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root,
	}
	child, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, child.stop(context.Background())) })
	token := []byte("source-compatibility-authenticated-supervisor-token")
	commands := make(chan string, 16)
	status := live()
	status.Generation = generation
	var handler http.Handler
	if current {
		handler = supervisorHandler(w.Manifest.WorkspaceID, generation, token,
			func(_ context.Context, command string) (Status, error) {
				commands <- command
				return status, nil
			})
	} else {
		// Model the retained old wire protocol directly. Using supervisorHandler
		// here would advertise the current implementation's capability.
		handler = http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if request.Method != http.MethodPost || request.URL.Path != "/v1/supervisor" ||
				request.Header.Get("Authorization") != "Bearer "+string(token) ||
				request.Header.Get("Content-Type") != "application/json" {
				http.Error(response, "unauthenticated supervisor request", http.StatusUnauthorized)
				return
			}
			var command struct {
				WorkspaceID string `json:"workspaceID"`
				Generation  string `json:"generation"`
				Command     string `json:"command"`
			}
			if json.NewDecoder(request.Body).Decode(&command) != nil ||
				command.WorkspaceID != w.Manifest.WorkspaceID || command.Generation != generation {
				http.Error(response, "wrong supervisor identity", http.StatusConflict)
				return
			}
			commands <- command.Command
			response.Header().Set("Content-Type", "application/json")
			if command.Command != supervisorStatusCommand {
				response.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(response).Encode(map[string]any{
					"error": devcontract.Fail(2, "invalid_request", "unknown supervisor command"),
				})
				return
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"status": status})
		})
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	record := supervisorRecord{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Endpoint: server.URL + "/v1/supervisor",
		TokenFile: launchPath(w, "supervisor-"+generation+".secret"), Process: child.identity,
	}
	require.NoError(t, os.WriteFile(record.TokenFile, token, 0600))
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record))
	return child, commands
}

func TestSourceUpdateOldSupervisorRefusesBeforeMutation(t *testing.T) {
	t.Run("new-intent", func(t *testing.T) { assertOldSupervisorSourceUpdateRefusal(t, false) })
	t.Run("retained-intent", func(t *testing.T) { assertOldSupervisorSourceUpdateRefusal(t, true) })
}

func assertOldSupervisorSourceUpdateRefusal(t *testing.T, recovering bool) {
	t.Helper()
	m, w, plan := sourcePlanFixture(t)
	child, commands := sourceCompatibilitySupervisor(t, w, false)
	launch := LaunchOptions{
		Mode: "native", MCP: true, Watch: false, LiveFrontend: false,
		BaselineSource:  filepath.Join(w.Root, "saved baseline ' $(exit 91)"),
		BaselineVersion: "saved-version", Timeout: 7 * time.Minute,
		LinkEvidence: LinkProtocolEvidence{
			Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true,
		},
	}
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "launch.json"), launch))
	var savedIntent []byte
	if recovering {
		intent := sourceUpdateIntent{
			WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Plan: plan, Running: true, Launch: &launch,
		}
		require.NoError(t, saveSourceUpdate(m, w, &intent, sourceUpdatePrepared))
		var err error
		savedIntent, err = os.ReadFile(sourceUpdatePath(m, w))
		require.NoError(t, err)
	}
	paths := []string{
		w.ManifestPath, launchPath(w, "ownership.json"), launchPath(w, "launch.json"), launchPath(w, "supervisor.json"),
	}
	before := make(map[string][]byte, len(paths))
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		require.NoError(t, err)
		before[path] = raw
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	status, err := m.Status(ctx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, "ready", status.Phase)
	require.False(t, status.SourceUpdateSupported)
	_, err = m.applySourceUpdateRequest(ctx, w.Manifest.WorkspaceID, plan, UpdateOptions{}, recovering)
	var typed *devcontract.Error
	require.ErrorAs(t, err, &typed)
	require.Equal(t, "supervisor_upgrade_required", typed.Code)
	require.Equal(t, sourceUpdateConflictExitCode, typed.Exit)
	argv := []string{"omniview-dev", "workspace", "restart", w.Manifest.WorkspaceID, "--root", m.Root}
	require.Equal(t, argv, typed.Details["nextArgv"])
	require.Equal(t, shellCommand(argv), typed.Details["nextCommand"])
	require.Contains(t, typed.Message, shellCommand(argv))
	for path, expected := range before {
		raw, readErr := os.ReadFile(path)
		require.NoError(t, readErr)
		require.Equal(t, expected, raw, path)
	}
	for _, repository := range plan.Repositories {
		checkout, pathErr := w.RepositoryPath(repository.ID)
		require.NoError(t, pathErr)
		require.Equal(t, repository.ActualHEAD, fixtureGit(t, checkout, "rev-parse", "HEAD"))
		require.Empty(t, fixtureGit(t, checkout, "status", "--porcelain"))
	}
	if recovering {
		retained, readErr := os.ReadFile(sourceUpdatePath(m, w))
		require.NoError(t, readErr)
		require.Equal(t, savedIntent, retained)
	} else {
		require.NoFileExists(t, sourceUpdatePath(m, w))
	}
	savedLaunch, err := LoadLaunchOptions(w)
	require.NoError(t, err)
	require.Equal(t, launch, savedLaunch)
	require.NoError(t, devsession.VerifyOwnedProcess(child.identity, devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: status.Generation, Role: "supervisor", Source: w.Root,
	}))
	for len(commands) > 0 {
		require.Equal(t, supervisorStatusCommand, <-commands,
			"compatibility refusal must not send mutation or restart commands")
	}
}

func TestCurrentRetainedSupervisorAdvertisesSourceUpdateSupport(t *testing.T) {
	m, w, plan := sourcePlanFixture(t)
	_, commands := sourceCompatibilitySupervisor(t, w, true)
	status, err := m.Status(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.True(t, status.SourceUpdateSupported)
	require.NoError(t, m.requireSourceUpdateSupervisor(w, status))
	intent, existing, err := m.captureSourceUpdate(
		context.Background(), w.Manifest.WorkspaceID, w, plan, UpdateOptions{}, false)
	require.NoError(t, err)
	require.False(t, existing)
	require.True(t, intent.Running)
	require.FileExists(t, sourceUpdatePath(m, w))
	for len(commands) > 0 {
		require.Equal(t, supervisorStatusCommand, <-commands)
	}
}

func TestStoppedSourceUpdateNeedsNoSupervisorCapability(t *testing.T) {
	m, w, _ := sourcePlanFixture(t)
	for _, phase := range []string{"", "created", sourceUpdateStopped, refreshCrashed} {
		t.Run(phase, func(t *testing.T) {
			require.NoError(t, m.requireSourceUpdateSupervisor(w, Status{Workspace: w, Phase: phase}))
		})
	}
}

func TestSupervisorSnapshotAdvertisesSourceUpdateSupport(t *testing.T) {
	supervisor := &workspaceSupervisor{status: Status{Phase: "ready"}}
	require.True(t, supervisor.snapshot().SourceUpdateSupported)
	supervisor.options = LaunchOptions{Mode: "browser", PluginRuntime: PluginRuntimeArchive}
	require.False(t, supervisor.snapshot().SourceUpdateSupported)
}

func TestFollowOldSupervisorRetainsRestartGuidanceAcrossObservations(t *testing.T) {
	m, w, remote, source := upstreamFixture(t)
	_, commands := sourceCompatibilitySupervisor(t, w, false)
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "launch.json"), LaunchOptions{Mode: "native"}))
	first := upstreamCommit(t, remote, "component.ts", "export const revision = 1")
	canonical := fixtureGit(t, source, "rev-parse", "HEAD")
	checkout := filepath.Join(w.Root, "omniview")
	head := fixtureGit(t, checkout, "rev-parse", "HEAD")
	before := make(map[string][]byte)
	for _, path := range []string{
		w.ManifestPath, launchPath(w, "ownership.json"), launchPath(w, "launch.json"), launchPath(w, "supervisor.json"),
	} {
		raw, err := os.ReadFile(path)
		require.NoError(t, err)
		before[path] = raw
	}
	argv := []string{"omniview-dev", "workspace", "restart", w.Manifest.WorkspaceID, "--root", m.Root}
	waits, applying, failed, blocked := 0, 0, 0, 0
	target := first
	var firstCohort string
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := m.Follow(ctx, w.Manifest.Slug, FollowOptions{
		Apply: true,
		wait: func(context.Context, time.Duration) error {
			waits++
			if waits == 2 {
				target = upstreamCommit(t, remote, "component.ts", "export const revision = 2")
			}
			if waits == 4 {
				return context.Canceled
			}
			return nil
		},
	}, func(status FollowStatus) error {
		require.NoFileExists(t, sourceUpdatePath(m, w))
		switch status.Result {
		case followApplying:
			applying++
			require.Empty(t, status.BlockedReason)
			require.Empty(t, status.NextArgv)
			require.Empty(t, status.NextCommand)
			if applying == 1 {
				firstCohort = status.PendingCohort
			} else {
				require.NotEqual(t, firstCohort, status.PendingCohort)
			}
		case followApplyFailed, "blocked_failed_cohort":
			require.Equal(t, "supervisor_upgrade_required", status.BlockedReason)
			require.Equal(t, argv, status.NextArgv)
			require.Equal(t, shellCommand(argv), status.NextCommand)
			require.Equal(t, target, status.Plan.Repositories[0].TargetSHA)
			if status.Result == followApplyFailed {
				failed++
			} else {
				blocked++
			}
		default:
			t.Fatalf("unexpected follow result: %s", status.Result)
		}
		return nil
	})
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 2, applying, "apply once per distinct target, never retry the failed cohort")
	require.Equal(t, 4, failed, "each initial failure is emitted before and after scheduling")
	require.Equal(t, 2, blocked, "each failed cohort retains guidance on its next observation")
	require.Equal(t, canonical, fixtureGit(t, source, "rev-parse", "HEAD"))
	require.Equal(t, head, fixtureGit(t, checkout, "rev-parse", "HEAD"))
	require.Empty(t, fixtureGit(t, checkout, "status", "--porcelain"))
	for path, expected := range before {
		raw, readErr := os.ReadFile(path)
		require.NoError(t, readErr)
		require.Equal(t, expected, raw, path)
	}
	require.NotEmpty(t, commands, "follow must authenticate the retained supervisor")
	for len(commands) > 0 {
		require.Equal(t, supervisorStatusCommand, <-commands, "follow must not send mutation or restart commands")
	}
}

// A running archive runtime refuses before the manager captures any intent, so
// no dead-end source-update.json is left to block update, follow and recover.
func TestArchiveRuntimeSourceUpdateRefusesBeforeCapture(t *testing.T) {
	m, w, plan := sourcePlanFixture(t)
	archive := &workspaceSupervisor{
		options: LaunchOptions{Mode: "browser", PluginRuntime: PluginRuntimeArchive},
		status:  Status{Workspace: w, Phase: "ready"},
	}
	child, commands := sourceCompatibilitySupervisorStatus(t, w, true, archive.snapshot)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	status, err := m.Status(ctx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, "ready", status.Phase)
	require.False(t, status.SourceUpdateSupported)
	require.Equal(t, PluginRuntimeArchive, status.PluginRuntime)
	for range 2 { // a repeat must be as clean as the first attempt: no dead-end loop
		_, err = m.applySourceUpdateRequest(ctx, w.Manifest.WorkspaceID, plan, UpdateOptions{}, false)
		var typed *devcontract.Error
		require.ErrorAs(t, err, &typed)
		require.Equal(t, "archive_runtime_source_update", typed.Code)
		require.Equal(t, sourceUpdateConflictExitCode, typed.Exit)
		down := []string{"omniview-dev", "workspace", "down", w.Manifest.WorkspaceID, "--root", m.Root}
		require.Equal(t, down, typed.Details["nextArgv"])
		require.Contains(t, typed.Message, shellCommand(down))
		require.NoFileExists(t, sourceUpdatePath(m, w), "refusal left a persisted intent that would block every later update")
	}
	require.NoError(t, devsession.VerifyOwnedProcess(child.identity, devsession.ProcessOwner{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: status.Generation, Role: "supervisor", Source: w.Root,
	}))
	for len(commands) > 0 {
		require.Equal(t, supervisorStatusCommand, <-commands, "refusal must not send a mutation command")
	}
	// Once stopped, the same plan is not refused by the runtime check.
	require.NoError(t, m.requireSourceUpdateSupervisor(w, Status{Workspace: w, Phase: sourceUpdateStopped, PluginRuntime: PluginRuntimeArchive}))
}

// follow --apply on a running archive runtime must not route the operator to
// `workspace recover` (impossible while running) or claim explicit recovery:
// the refusal is pre-mutation, so it carries the same `workspace down` guidance.
func TestFollowApplyArchiveRuntimeRefusesWithDownGuidanceAndNoIntent(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	archive := &workspaceSupervisor{
		options: LaunchOptions{Mode: "browser", PluginRuntime: PluginRuntimeArchive},
		status:  Status{Workspace: w, Phase: "ready"},
	}
	_, commands := sourceCompatibilitySupervisorStatus(t, w, true, archive.snapshot)
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "launch.json"), archive.options))
	upstreamCommit(t, remote, "component.ts", "export const revision = 1")
	down := []string{"omniview-dev", "workspace", "down", w.Manifest.WorkspaceID, "--root", m.Root}
	waits, failed, blocked := 0, 0, 0
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := m.Follow(ctx, w.Manifest.Slug, FollowOptions{
		Apply: true,
		wait: func(context.Context, time.Duration) error {
			if waits++; waits == 3 {
				return context.Canceled
			}
			return nil
		},
	}, func(status FollowStatus) error {
		require.NoFileExists(t, sourceUpdatePath(m, w), "pre-mutation refusal persisted an update intent")
		switch status.Result {
		case followApplying:
		case followApplyFailed, "blocked_failed_cohort":
			require.Equal(t, "archive_runtime_source_update", status.BlockedReason)
			require.NotEqual(t, "explicit_recovery_required", status.BlockedReason)
			require.Equal(t, down, status.NextArgv)
			require.Equal(t, shellCommand(down), status.NextCommand)
			if status.Result == followApplyFailed {
				failed++
			} else {
				blocked++
			}
		default:
			t.Fatalf("unexpected follow result: %s", status.Result)
		}
		return nil
	})
	require.ErrorIs(t, err, context.Canceled)
	require.NotZero(t, failed)
	require.NotZero(t, blocked, "the failed cohort retains the down guidance on later observations")
	for len(commands) > 0 {
		require.Equal(t, supervisorStatusCommand, <-commands, "follow must not send mutation commands")
	}
}
