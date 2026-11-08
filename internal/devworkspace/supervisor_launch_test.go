package devworkspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

// Exercise the production supervisor entry before testing parses the controller
// argv. The helper neither echoes requests nor substitutes supervisor behavior.
func init() {
	if os.Getenv("OMNIVIEW_SUPERVISOR_AUTH_TEST") != "1" {
		return
	}
	manager, err := Open(os.Getenv("OMNIVIEW_SUPERVISOR_AUTH_ROOT"), Options{
		Home: os.Getenv("OMNIVIEW_SUPERVISOR_AUTH_HOME"), Stopped: RequireStopped,
	})
	if err == nil {
		err = manager.ServeSupervisor(context.Background(), os.Getenv("OMNIVIEW_SUPERVISOR_AUTH_WORKSPACE"), io.Discard)
	}
	if err != nil {
		var failure *devcontract.Error
		if !errors.As(err, &failure) {
			failure = devcontract.Fail(5, "operation_failed", err.Error())
		}
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"error": failure})
		os.Exit(devcontract.ExitCode(failure))
	}
	os.Exit(0)
}

func TestRecoverRejectsDirectSupervisorGenerationReplay(t *testing.T) {
	m, _ := fixtureManager(t, "plugin-sdk")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "native-launch-authorization", Repositories: []string{"plugin-sdk"}})
	var err error
	t.Setenv("OMNIVIEW_SUPERVISOR_AUTH_TEST", "1")
	t.Setenv("OMNIVIEW_SUPERVISOR_AUTH_ROOT", m.Root)
	t.Setenv("OMNIVIEW_SUPERVISOR_AUTH_HOME", m.options.Home)
	t.Setenv("OMNIVIEW_SUPERVISOR_AUTH_WORKSPACE", w.Manifest.WorkspaceID)
	t.Cleanup(func() {
		stopContext, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer stopCancel()
		_, stopErr := m.Down(stopContext, w.Manifest.WorkspaceID)
		require.NoError(t, stopErr)
	})
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
	require.NoError(t, atomicJSON(path, refreshIntent{
		WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: refreshStart, WasRunning: true,
		Evidence: LinkProtocolEvidence{Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true},
		Launch:   LaunchOptions{Mode: "browser", Timeout: 10 * time.Second},
	}))
	first, err := m.Recover(ctx, w.Manifest.WorkspaceID, RefreshOptions{Executable: os.Args[0]})
	require.Error(t, err, "minimal source must fail real launch preflight")
	require.Equal(t, "error", first.Status.Phase, "retained launch failed before publication: %#v", err)
	require.NotEmpty(t, first.Status.Generation)
	var original supervisorRecord
	require.NoError(t, readLaunchJSON(launchPath(w, "supervisor.json"), &original))
	authorizationPath, err := m.supervisorLaunchAuthorizationPath(w, original.Generation)
	require.NoError(t, err)
	var authorization supervisorLaunchAuthorization
	require.NoError(t, devsession.ReadPrivateJSON(authorizationPath, &authorization))
	require.True(t, authorization.Claimed)
	require.Equal(t, original.Process, authorization.Process)
	_, err = m.Down(ctx, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	originalRecord, err := os.ReadFile(launchPath(w, "supervisor.json"))
	require.NoError(t, err)

	for _, claimed := range []bool{true, false} {
		// The false case models a child that exited before claiming its native
		// handoff. A different invocation cannot steal that unused authority.
		authorization.Claimed = claimed
		require.NoError(t, atomicOwnedJSON(authorizationPath, authorization, w.Manifest.WorkspaceID))
		command := exec.CommandContext(ctx, os.Args[0], "workspace", "supervise", "--root", m.Root, "--workspace", w.Root)
		command.Env = append(os.Environ(), supervisorGenerationEnvironment+"="+original.Generation)
		raw, replayErr := command.CombinedOutput()
		var exited *exec.ExitError
		require.ErrorAs(t, replayErr, &exited, "%s", raw)
		require.Equal(t, 4, exited.ExitCode())
		var response struct {
			Error *devcontract.Error `json:"error"`
		}
		require.NoError(t, json.Unmarshal(raw, &response), "%s", raw)
		require.NotNil(t, response.Error)
		require.Equal(t, "launch_authorization_invalid", response.Error.Code)
		after, readErr := os.ReadFile(launchPath(w, "supervisor.json"))
		require.NoError(t, readErr)
		require.True(t, bytes.Equal(originalRecord, after), "direct replay replaced supervisor ownership")
		var retained supervisorLaunchAuthorization
		require.NoError(t, devsession.ReadPrivateJSON(authorizationPath, &retained))
		require.Equal(t, authorization, retained, "direct replay consumed another invocation's handoff")
	}

	second, err := m.Recover(ctx, w.Manifest.WorkspaceID, RefreshOptions{Executable: os.Args[0]})
	require.Error(t, err, "minimal source still fails real launch preflight")
	require.Equal(t, "error", second.Status.Phase)
	require.NotEqual(t, first.Status.Generation, second.Status.Generation)
	var selected supervisorRecord
	require.NoError(t, readLaunchJSON(launchPath(w, "supervisor.json"), &selected))
	selectedAuthorization, err := m.supervisorLaunchAuthorizationPath(w, selected.Generation)
	require.NoError(t, err)
	var handoff supervisorLaunchAuthorization
	require.NoError(t, devsession.ReadPrivateJSON(selectedAuthorization, &handoff))
	require.True(t, handoff.Claimed)
	require.Equal(t, selected.Process, handoff.Process)
}

func TestRecoveryRejectsMalformedPersistedLaunchGenerations(t *testing.T) {
	t.Parallel()
	valid := NewGeneration()
	// Every case is a read-only refusal with unchanged intent bytes.
	m, w, j := recoveryFixture(t)
	path := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID, "refresh.json")
	for name, generations := range map[string][]string{
		"empty": {""}, "nil": {"00000000-0000-0000-0000-000000000000"},
		"noncanonical": {"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"},
		"traversal":    {"../private-payload"}, "duplicate": {valid, valid},
	} {
		for _, recover := range []bool{false, true} {
			t.Run(name+"/"+map[bool]string{false: "refresh", true: "recover"}[recover], func(t *testing.T) {
				require.NoError(t, atomicJSON(path, refreshIntent{
					WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: refreshStart, WasRunning: true,
					Evidence: j.Evidence, Launch: LaunchOptions{Mode: "browser"}, LaunchGenerations: generations,
				}))
				before, err := os.ReadFile(path)
				require.NoError(t, err)
				if recover {
					_, err = m.Recover(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
				} else {
					_, err = m.Refresh(context.Background(), w.Manifest.WorkspaceID, RefreshOptions{})
				}
				var failure *devcontract.Error
				require.ErrorAs(t, err, &failure)
				require.Equal(t, "invalid_refresh", failure.Code)
				after, err := os.ReadFile(path)
				require.NoError(t, err)
				require.Equal(t, before, after)
				require.NoFileExists(t, launchPath(w, "supervisor.json"))
			})
		}
	}
}
