package devworkspace

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func TestNextCommandQuotesLiteralShellMetacharacters(t *testing.T) {
	values := []string{"space path", "$(exit 29)", "`exit 31`", "quote'path", "$HOME", "semi;colon"}
	for _, value := range values {
		command := "printf '%s' " + shellArgument(value)
		raw, err := exec.Command("/bin/sh", "-c", command).CombinedOutput()
		require.NoError(t, err)
		require.Equal(t, value, string(raw))
	}
	command := shellCommand([]string{"printf", "%s", "a b", "$HOME", "`exit 1`"})
	raw, err := exec.Command("/bin/sh", "-c", command).CombinedOutput()
	require.NoError(t, err)
	require.Equal(t, strings.Join([]string{"a b", "$HOME", "`exit 1`"}, ""), string(raw))
}

func TestFailedLaunchRecoveryTargetsOriginalProfileOutsideCollection(t *testing.T) {
	m, _ := fixtureManager(t)
	failed, err := m.Create(context.Background(), CreateOptions{Slug: "failed"})
	require.NoError(t, err)
	other, err := m.Create(context.Background(), CreateOptions{Slug: "other"})
	require.NoError(t, err)
	s := &workspaceSupervisor{
		workspace: failed,
		status:    Status{Workspace: failed, Phase: "building"},
		output:    io.Discard,
	}
	s.setPhase("error", errors.New("compiler failed"))
	command := exec.Command("/bin/sh", "-c", "set -- "+s.snapshot().RecoveryCommand+"; printf '%s\\000' \"$@\"")
	command.Dir = t.TempDir()
	raw, err := command.CombinedOutput()
	require.NoError(t, err, "%s", raw)
	arguments := strings.Split(strings.TrimSuffix(string(raw), "\x00"), "\x00")
	explicit := ""
	for i, argument := range arguments {
		if argument == "--workspace" && i+1 < len(arguments) {
			explicit = arguments[i+1]
		}
	}
	resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{
		CWD: command.Dir, Explicit: explicit, Home: m.options.Home,
	})
	require.NoError(t, err)
	require.Equal(t, failed.Manifest.WorkspaceID, resolved.Manifest.WorkspaceID)
	require.Equal(t, failed.StateRoot, resolved.StateRoot)
	_, err = devcontract.ResolveWorkspace(devcontract.ResolveOptions{
		CWD: other.Root, Explicit: explicit, Home: m.options.Home,
		EnvironmentManifest: other.ManifestPath,
	})
	var conflict *devcontract.Error
	require.ErrorAs(t, err, &conflict)
	require.Equal(t, "conflicting_target", conflict.Code)
}
