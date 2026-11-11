package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
)

// This compiles a real plugin against the hermetic published SDK, reproduces
// the non-reentrant UUID guard refusal, then records under the manager's actual
// home and invokes the verified archive writer while stopped guards are held.
func TestStoppedArchiveRecordsRealBackendBetweenGuardsWithoutAmbientHome(t *testing.T) {
	ctx := context.Background()
	env := newPubEnv(t)
	workspace := env.workspace()
	env.activate()
	ambient, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	t.Setenv("HOME", ambient)
	t.Setenv("USERPROFILE", ambient)
	graph := env.graph(workspace, nil)
	graph.manager = &Manager{options: Options{Home: env.home}}
	backend := BuildNode{ID: "plugin-backend:plugin", Kind: "plugin-backend", PluginID: "plugin", Directory: filepath.Join(workspace.Root, "plugin")}
	graph.Nodes = []BuildNode{backend}

	release, err := devcontract.LockProfile(ctx, env.home, workspace.Manifest.WorkspaceID)
	require.NoError(t, err)
	defer func() {
		if release != nil {
			require.NoError(t, release())
		}
	}()
	binary, identity, err := graph.buildPluginBackendOutput(ctx, backend)
	require.NoError(t, err)
	_, attested := graph.attestedIdentity("plugin")
	require.False(t, attested, "output production must not invent an artifact record")
	err = graph.recordArtifact("plugin", binary, identity)
	var busy *devcontract.Error
	require.ErrorAs(t, err, &busy)
	require.Equal(t, "profile_busy", busy.Code, "recording must never bypass an already-held real UUID guard")
	_, attested = graph.attestedIdentity("plugin")
	require.False(t, attested)
	require.NoError(t, release())
	release = nil

	require.NoError(t, graph.recordArtifact("plugin", binary, identity))
	require.NoError(t, instance.VerifyPluginArtifactAtHome(env.home, workspace.ResolvedWorkspace, "plugin", binary))
	require.Error(t, instance.VerifyPluginArtifact(workspace.ResolvedWorkspace, "plugin", binary), "ambient home must not authorize private manager evidence")
	_, err = os.Lstat(filepath.Join(ambient, ".omniview-dev"))
	require.True(t, os.IsNotExist(err), "recording must not touch the ambient/native profile tree")

	release, err = devcontract.LockProfile(ctx, env.home, workspace.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(workspace.StateRoot, 0700))
	rootRelease, err := tryLock(filepath.Join(workspace.StateRoot, ".lock"))
	require.NoError(t, err)
	defer rootRelease()
	archive, receipt, err := graph.PublishPluginArchive(ctx, workspace.Manifest.Plugins[0])
	require.NoError(t, err)
	files := readArchiveFiles(t, archive)
	require.NotEmpty(t, files["bin/plugin"])
	require.Equal(t, pubSHA256(files["bin/plugin"]), receipt.BackendSHA256)
	archived, err := os.ReadFile(archive)
	require.NoError(t, err)
	require.Equal(t, pubSHA256(archived), receipt.ArchiveSHA256)
	require.NoError(t, os.WriteFile(binary, append(files["bin/plugin"], 0), 0700))
	_, _, err = graph.PublishPluginArchive(ctx, workspace.Manifest.Plugins[0])
	require.Error(t, err, "backend replacement after recording must still fail canonical ownership/hash checks")
	require.Equal(t, string(archived), pubRead(t, archive))
}
