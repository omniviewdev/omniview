//go:build darwin || linux

package devworkspace

import (
	"context"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestStartRetainsFailedSupervisorForRecovery(t *testing.T) {
	t.Parallel()
	m, _ := fixtureManager(t, "omniview")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "failed-launch"})
	var err error
	generation := NewGeneration()
	owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root}
	child, err := startOwnedChild(ctx, w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, child.stop(context.Background())) })
	token := []byte("failed-launch-recovery-authenticated-supervisor-token")
	server := httptest.NewServer(supervisorHandler(w.Manifest.WorkspaceID, generation, token,
		func(_ context.Context, command string) (Status, error) {
			if command != supervisorStatusCommand {
				t.Errorf("unexpected supervisor mutation: %s", command)
				return Status{}, errors.New("only status is allowed")
			}
			return Status{Workspace: w, Generation: generation, Phase: "error", FailedStage: "link", RecoveryCommand: "omniview-dev workspace refresh " + w.Manifest.WorkspaceID}, nil
		}))
	t.Cleanup(server.Close)
	record := supervisorRecord{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Endpoint: server.URL + "/v1/supervisor", TokenFile: launchPath(w, "supervisor-"+generation+".secret"), Process: child.identity}
	require.NoError(t, os.WriteFile(record.TokenFile, token, 0600))
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record))
	before, err := os.ReadFile(launchPath(w, "supervisor.json"))
	require.NoError(t, err)
	var stoppedFailure *devcontract.Error
	require.ErrorAs(t, RequireStopped(ctx, w.ResolvedWorkspace), &stoppedFailure)
	require.Equal(t, "workspace_running", stoppedFailure.Code)
	require.Equal(t, workspaceRecoveryCommand(w, "down"), stoppedFailure.Details["recoveryCommand"])
	require.NoError(t, devsession.VerifyOwnedProcess(child.identity, owner))

	status, err := m.Start(ctx, w.Manifest.WorkspaceID, LaunchOptions{Mode: "browser"}, "/must-not-launch", io.Discard)
	var failure *devcontract.Error
	require.True(t, errors.As(err, &failure))
	require.Equal(t, "workspace_running", failure.Code)
	require.Equal(t, 4, failure.Exit)
	require.Equal(t, "error", status.Phase)
	require.Equal(t, generation, status.Generation)
	command := exec.Command("/bin/sh", "-c", "set -- "+status.RecoveryCommand+"; printf '%s\\000' \"$@\"")
	command.Dir = t.TempDir()
	raw, err := command.CombinedOutput()
	require.NoError(t, err, "%s", raw)
	arguments := strings.Split(strings.TrimSuffix(string(raw), "\x00"), "\x00")
	target := ""
	for i, argument := range arguments {
		if argument == "--workspace" && i+1 < len(arguments) {
			target = arguments[i+1]
		}
	}
	resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{
		CWD: command.Dir, Explicit: target, Home: m.options.Home,
	})
	require.NoError(t, err)
	require.Equal(t, w.Manifest.WorkspaceID, resolved.Manifest.WorkspaceID)
	require.Equal(t, w.StateRoot, resolved.StateRoot)
	require.NoError(t, devsession.VerifyOwnedProcess(child.identity, owner))
	after, err := os.ReadFile(launchPath(w, "supervisor.json"))
	require.NoError(t, err)
	require.Equal(t, before, after)
	t.Log(failure)
}

func TestRestartStoppedWorkspaceReachesLaunchPreconditions(t *testing.T) {
	t.Parallel()
	for _, recorded := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing", true: "exited"}[recorded], func(t *testing.T) {
			m, _ := fixtureManager(t, "omniview")
			// A source-only cohort is a published-SDK workspace: it is not stopped
			// by an SDK prerequisite. Restart must still never be able to execute
			// this test binary as a supervisor.
			m.options.Executable = forbidSupervisorExecutable
			ctx := context.Background()
			w := fixtureWorkspace(t, m, CreateOptions{Slug: "restart-stopped"})
			var err error
			require.NoError(t, ReconcileGeneratedRoot(w))
			require.NoError(t, saveLaunchJSON(launchPath(w, "launch.json"), LaunchOptions{Mode: "browser"}))
			if recorded {
				generation := NewGeneration()
				owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root}
				child, startErr := startOwnedChild(ctx, w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
				require.NoError(t, startErr)
				require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), supervisorRecord{
					WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Process: child.identity,
					Endpoint: "http://127.0.0.1:1/v1/supervisor",
				}))
				require.NoError(t, child.stop(ctx))
			}
			_, err = m.Restart(ctx, w.Manifest.WorkspaceID)
			require.ErrorIs(t, err, errSupervisorExecutableForbidden, "restart must reach the real launch precondition, not an SDK gate")
		})
	}
}

func TestStoppedRefreshMovesFailureToHistory(t *testing.T) {
	t.Parallel()
	m, w, j := recoveryFixture(t)
	ctx := context.Background()
	generation := NewGeneration()
	owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root}
	child, err := startOwnedChild(ctx, w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
	require.NoError(t, err)
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), supervisorRecord{
		WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Process: child.identity,
		Endpoint: "http://127.0.0.1:1/v1/supervisor",
	}))
	require.NoError(t, child.stop(ctx))
	failure := devcontract.Fail(5, "build_failed", "fixture failure")
	require.NoError(t, saveLaunchJSON(launchPath(w, "launch-status.json"), Status{
		Generation: generation, Phase: "stopped", LastError: failure, FailedStage: "host", RecoveryCommand: "obsolete",
	}))
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
	require.NoError(t, atomicJSON(path, refreshIntent{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: refreshStart,
		Evidence: j.Evidence, Launch: LaunchOptions{Mode: "browser"},
	}))
	result, err := m.Refresh(ctx, w.Manifest.WorkspaceID, RefreshOptions{})
	require.NoError(t, err)
	require.Equal(t, sourceUpdateComplete, result.Phase)
	status, err := m.Status(ctx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, "stopped", status.Phase)
	require.Nil(t, status.LastError)
	require.Empty(t, status.FailedStage)
	require.Empty(t, status.RecoveryCommand)
	require.NotNil(t, status.HistoricalError)
	require.Equal(t, failure.Code, status.HistoricalError.Code)
	require.Equal(t, failure.Message, status.HistoricalError.Message)
	require.Equal(t, "host", status.HistoricalFailedStage)
}

func TestLateRefreshFailureRetiresOnlyFailedLaunchWithoutReinstall(t *testing.T) {
	t.Parallel()
	for _, phase := range []string{refreshStart, refreshVerify} {
		t.Run(phase, func(t *testing.T) {
			m, w, j := recoveryFixture(t)
			m.options.Executable = forbidSupervisorExecutable
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			generation := NewGeneration()
			owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root}
			child, err := startOwnedChild(ctx, w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, child.stop(context.Background())) })
			token := []byte("late-refresh-authenticated-supervisor-token")
			var stops atomic.Int32
			server := httptest.NewServer(supervisorHandler(w.Manifest.WorkspaceID, generation, token,
				func(_ context.Context, command string) (Status, error) {
					status := Status{Workspace: w, Generation: generation, Phase: "error"}
					switch command {
					case supervisorStatusCommand:
						return status, nil
					case supervisorStopCommand:
						stops.Add(1)
						if err := child.stop(context.Background()); err != nil {
							return status, err
						}
						status.Phase = "stopped"
						return status, nil
					default:
						t.Errorf("unexpected supervisor command: %s", command)
						return status, errors.New("unexpected supervisor command")
					}
				}))
			defer server.Close()
			record := supervisorRecord{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation,
				Endpoint: server.URL + "/v1/supervisor", TokenFile: launchPath(w, "supervisor-"+generation+".secret"), Process: child.identity}
			require.NoError(t, os.WriteFile(record.TokenFile, token, 0600))
			recordTestLaunchAuthorization(t, m, w, record.Process)
			require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record))
			path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
			require.NoError(t, atomicJSON(path, refreshIntent{
				WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: phase,
				Evidence: j.Evidence, Launch: LaunchOptions{Mode: "browser"}, WasRunning: true,
				LaunchGenerations: []string{generation},
			}))
			linksBefore, err := os.ReadFile(launchPath(w, "links.json"))
			require.NoError(t, err)
			_, err = m.Recover(ctx, w.Manifest.WorkspaceID, RefreshOptions{Executable: "/must-not-launch"})
			// This source-only (published SDK) cohort has no SDK prerequisite:
			// Start attempts the explicit executable, which does not exist. That
			// proves the failed owner no longer blocks the launch and that nothing
			// was launched.
			require.ErrorIs(t, err, os.ErrNotExist)
			require.Equal(t, int32(1), stops.Load())
			require.ErrorIs(t, devsession.VerifyOwnedProcess(child.identity, owner), devsession.ErrProcessGone)
			linksAfter, err := os.ReadFile(launchPath(w, "links.json"))
			require.NoError(t, err)
			require.Equal(t, linksBefore, linksAfter, "late launch recovery repeated dependency preparation")
		})
	}
}

func TestFailedRefreshShutdownRejectsSuccessorGeneration(t *testing.T) {
	t.Parallel()
	m, _ := fixtureManager(t, "omniview")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "failed-owner-successor"})
	var err error
	generation := NewGeneration()
	owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root}
	child, err := startOwnedChild(ctx, w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
	require.NoError(t, err)
	defer child.stop(ctx)
	record := supervisorRecord{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation,
		Endpoint: "http://127.0.0.1:1/v1/supervisor", Process: child.identity}
	require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record))
	before, err := os.ReadFile(launchPath(w, "supervisor.json"))
	require.NoError(t, err)
	expected := child.identity
	expected.Generation = NewGeneration()
	_, err = m.downAuthorizedGeneration(ctx, w.Manifest.WorkspaceID, expected)
	var failure *devcontract.Error
	require.ErrorAs(t, err, &failure)
	require.Equal(t, "stale_target", failure.Code)
	require.NoError(t, devsession.VerifyOwnedProcess(child.identity, owner))
	after, err := os.ReadFile(launchPath(w, "supervisor.json"))
	require.NoError(t, err)
	require.Equal(t, before, after)
}

func TestRecoverDoesNotRetireUnrelatedFailedSuccessor(t *testing.T) {
	t.Parallel()
	for _, replacement := range []string{"before-start", "before-verify", "between-verify-and-start", "same-generation-before-start", "same-generation-between-reads", "unbound-legacy", "missing-native-handoff"} {
		t.Run(replacement, func(t *testing.T) {
			t.Parallel()
			m, _ := fixtureManager(t, "omniview")
			w := fixtureWorkspace(t, m, CreateOptions{Slug: "recovery"})
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			var stops atomic.Int32
			startOwner := func(generation string) (supervisorRecord, *ownedChild, devsession.ProcessOwner) {
				if generation == "" {
					generation = NewGeneration()
				}
				owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root}
				child, err := startOwnedChild(ctx, w.Root, os.Environ(), io.Discard, owner, nil, "/bin/sleep", "300")
				require.NoError(t, err)
				t.Cleanup(func() { require.NoError(t, child.stop(context.Background())) })
				token := []byte("unrelated-successor-authenticated-supervisor-token")
				server := httptest.NewServer(supervisorHandler(w.Manifest.WorkspaceID, generation, token,
					func(_ context.Context, command string) (Status, error) {
						if command == supervisorStopCommand {
							stops.Add(1)
							return Status{}, errors.New("unexpected successor retirement request")
						}
						return Status{Workspace: w, Generation: generation, Phase: "error"}, nil
					}))
				t.Cleanup(server.Close)
				record := supervisorRecord{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation,
					Endpoint: server.URL + "/v1/supervisor", TokenFile: launchPath(w, "supervisor-"+generation+".secret"), Process: child.identity}
				require.NoError(t, os.WriteFile(record.TokenFile, token, 0600))
				return record, child, owner
			}
			attempt, original, originalOwner := startOwner("")
			if replacement != "missing-native-handoff" {
				recordTestLaunchAuthorization(t, m, w, attempt.Process)
			}
			successorGeneration := ""
			if replacement == "same-generation-before-start" || replacement == "same-generation-between-reads" {
				successorGeneration = attempt.Generation
			}
			successor, replacementChild, replacementOwner := startOwner(successorGeneration)
			intent := refreshIntent{WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: refreshStart,
				Evidence: fixtureLinkEvidence(), Launch: LaunchOptions{Mode: "browser"}, WasRunning: true,
				LaunchGenerations: []string{attempt.Generation}}
			if replacement == "before-verify" || replacement == "between-verify-and-start" || replacement == "same-generation-between-reads" {
				intent.Phase = refreshVerify
			}
			if replacement == "unbound-legacy" {
				intent.LaunchGenerations = nil
			}
			record := successor
			expectedRecord := successor
			if replacement == "missing-native-handoff" {
				record, expectedRecord = attempt, attempt
			}
			if replacement == "between-verify-and-start" || replacement == "same-generation-between-reads" {
				record = attempt
				m.afterDurablePhase = func(kind, phase string) error {
					require.Equal(t, "refresh", kind)
					require.Equal(t, refreshStart, phase)
					return rawSaveLaunchJSON(launchPath(w, "supervisor.json"), successor)
				}
			}
			require.NoError(t, rawSaveLaunchJSON(launchPath(w, "supervisor.json"), record))
			path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
			require.NoError(t, atomicJSON(path, intent))
			_, err := m.Recover(ctx, w.Manifest.WorkspaceID, RefreshOptions{})
			var failure *devcontract.Error
			require.ErrorAs(t, err, &failure)
			require.Equal(t, "stale_target", failure.Code)
			require.Zero(t, stops.Load(), "Recover signaled a generation outside its durable launch authority")
			require.NoError(t, devsession.VerifyOwnedProcess(original.identity, originalOwner))
			require.NoError(t, devsession.VerifyOwnedProcess(replacementChild.identity, replacementOwner))
			var retained supervisorRecord
			require.NoError(t, readLaunchJSON(launchPath(w, "supervisor.json"), &retained))
			require.Equal(t, expectedRecord, retained)
		})
	}
}
