package instance

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestExplicitArtifactHomeKeepsRealGuardOwnershipAndHashChecks(t *testing.T) {
	workspace := artifactWorkspaceFixture(t)
	managerHome, err := os.UserHomeDir()
	require.NoError(t, err)
	ambient, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	t.Setenv("HOME", ambient)
	t.Setenv("USERPROFILE", ambient)
	binary := filepath.Join(t.TempDir(), "plugin")
	require.NoError(t, os.WriteFile(binary, []byte("trusted builder fixture"), 0700))
	identity := fixtureSDK(t)
	release, err := devcontract.LockProfile(context.Background(), managerHome, workspace.Manifest.WorkspaceID)
	require.NoError(t, err)
	defer func() {
		if release != nil {
			require.NoError(t, release())
		}
	}()
	var busy *devcontract.Error
	err = RecordBuiltArtifactAtHome(managerHome, workspace, "plugin", binary, identity)
	require.ErrorAs(t, err, &busy)
	require.Equal(t, "profile_busy", busy.Code)
	require.NoError(t, release())
	release = nil

	require.NoError(t, RecordBuiltArtifactAtHome(managerHome, workspace, "plugin", binary, identity))
	require.NoError(t, VerifyPluginArtifactAtHome(managerHome, workspace, "plugin", binary))
	require.Error(t, VerifyPluginArtifact(workspace, "plugin", binary))
	_, err = os.Lstat(filepath.Join(ambient, ".omniview-dev"))
	require.True(t, os.IsNotExist(err), "explicit-home recording must not create ambient profile resources")
	require.Error(t, RecordBuiltArtifactAtHome("relative-home", workspace, "plugin", binary, identity))
	require.Error(t, RecordBuiltArtifactAtHome(managerHome, workspace, "../foreign", binary, identity))
	require.NoError(t, os.WriteFile(binary, []byte("replaced bytes"), 0700))
	require.Error(t, VerifyPluginArtifactAtHome(managerHome, workspace, "plugin", binary))
}
