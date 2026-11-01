//go:build darwin || linux

package devworkspace

import (
	"context"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestStartRetainsFailedSupervisorForRecovery(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "failed-launch"})
	require.NoError(t, err)
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

	status, err := m.Start(ctx, w.Manifest.WorkspaceID, LaunchOptions{Mode: "browser", ReviewedSDKRevision: strings.Repeat("a", 40)}, "/must-not-launch", io.Discard)
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
