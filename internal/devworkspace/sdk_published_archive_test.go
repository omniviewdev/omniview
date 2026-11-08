package devworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/instance"
)

// pubSelfAttestedMetadata is plugin.yaml of a branch that commits its own
// state-isolation provenance. Archive metadata is never release trust, so the
// archive must drop it for a published SDK.
const pubSelfAttestedMetadata = "id: plugin\nname: Plugin\nversion: 0.1.0\nschema_version: 1\nsdk_protocol_version: 1\ncapabilities:\n  - resource\n" +
	"state_isolation:\n  schema_version: 1\n  capability: state-root-v1\n  sdk_module: github.com/omniviewdev/plugin-sdk\n  sdk_revision: " + "0123456789012345678901234567890123456789" + "\n  binary_sha256: " + "0000000000000000000000000000000000000000000000000000000000000000" + "\n"

// pubBackendGraph builds a real plugin backend against the world's published SDK
// through the graph's plugin-backend node (verify, compile with -mod=readonly,
// verify again, buildinfo check, attest under the published identity) and returns
// the graph ready to archive it.
func (e *pubEnv) backendGraph(w Workspace) (*BuildGraph, devcontract.Plugin, BuildNode) {
	t := e.t
	t.Helper()
	pubWrite(t, filepath.Join(w.Root, "plugin", "plugin.yaml"), pubSelfAttestedMetadata)
	e.activate()
	g := e.graph(w, nil)
	node := BuildNode{ID: "plugin-backend:plugin", Kind: "plugin-backend", PluginID: "plugin", Directory: filepath.Join(w.Root, "plugin")}
	g.Nodes = []BuildNode{node}
	require.NoError(t, g.buildNode(context.Background(), node))
	return g, w.Manifest.Plugins[0], node
}

func pubSHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// A real backend built against the published SDK is attested under its published
// identity and archived without source-style provenance. The receipt's backend
// digest is the ledger digest of the published binary, the host's own artifact
// verification accepts exactly the archived bytes, and bytes replaced after the
// attestation are refused.
func TestPublishedArchivePackagesAnAttestedBackendWithoutSourceProvenance(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	g, plugin, _ := env.backendGraph(w)

	identity, attested := g.attestedIdentity("plugin")
	require.True(t, attested, "the build must have attested the backend")
	published, isPublished := identity.Published()
	require.True(t, isPublished)
	require.Equal(t, env.sdk.Published(), published)

	binary := filepath.Join(w.Root, ".local", "build", "plugin", "plugin")
	built, err := os.ReadFile(binary)
	require.NoError(t, err)
	ledgerDigest, err := publishedGeneratedFileDigest(w, filepath.Join("build", "plugin", "plugin"))
	require.NoError(t, err)
	require.Equal(t, pubSHA256(built), ledgerDigest)

	path, receipt, err := g.PublishPluginArchive(context.Background(), plugin)
	require.NoError(t, err)

	require.Equal(t, ledgerDigest, receipt.BackendSHA256, "the receipt carries the ledger digest of the published binary")
	files := readArchiveFiles(t, path)
	require.Equal(t, string(built), string(files["bin/plugin"]))
	metadata := string(files["plugin.yaml"])
	require.Contains(t, metadata, "id: plugin")
	require.NotContains(t, metadata, "state_isolation", "a published archive carries no source-style provenance, even one the branch committed")
	require.NotContains(t, metadata, "binary_sha256")
	archived, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, pubSHA256(archived), receipt.ArchiveSHA256)

	// The destination's own private evidence accepts exactly the archived bytes.
	extracted := filepath.Join(t.TempDir(), "plugin")
	require.NoError(t, os.WriteFile(extracted, files["bin/plugin"], 0o700))
	require.NoError(t, instance.VerifyPluginArtifact(w.ResolvedWorkspace, "plugin", extracted))
	require.NoError(t, os.WriteFile(extracted, append(files["bin/plugin"], 0), 0o700))
	require.Error(t, instance.VerifyPluginArtifact(w.ResolvedWorkspace, "plugin", extracted), "any other bytes are refused")

	// Replacing the published binary after the attestation is refused, and
	// nothing new is published.
	require.NoError(t, os.WriteFile(binary, append(built, []byte("replaced after attestation")...), 0o700))
	_, _, err = g.PublishPluginArchive(context.Background(), plugin)
	require.Error(t, err)
	require.False(t, strings.Contains(err.Error(), "published archive"), "a replaced binary must fail before an archive is written: %v", err)
	require.Equal(t, string(archived), pubRead(t, path), "the earlier archive must be untouched")
}

// An SDK that changes between the build and the archive is refused with the typed
// identity-changed refusal: the archive re-verifies the published identity.
func TestPublishedArchiveRefusesWhenTheEffectiveSDKChangedAfterTheBuild(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	g, plugin, node := env.backendGraph(w)

	// The plugin's own go.mod and go.sum now select the other served release
	// (reviewed under the world's policy), a real change of the effective SDK.
	pubWrite(t, filepath.Join(node.Directory, "go.mod"), pubGoMod("example.com/plugin", "", env.other, env.uuid))
	pubWrite(t, filepath.Join(node.Directory, "go.sum"), pubSums(env.other, env.uuid))

	_, _, err := g.PublishPluginArchive(context.Background(), plugin)

	pubRequireCode(t, err, devsdk.CodeIdentityChanged, 4)
}
