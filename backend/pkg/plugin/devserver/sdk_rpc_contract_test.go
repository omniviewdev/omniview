package devserver

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// This default (untagged) contract deliberately compiles only two tiny Go
// consumers. The IDE, Kubernetes, bindings and frontend build graphs are absent.
// Removing the SDK API, failing to rebuild either consumer, bypassing settings
// RPC, promoting a failed build, or dropping persisted hydration must fail here.
func TestSelectedSDKAPIRealCompileRPCAndRecovery(t *testing.T) {
	// testing.T.Context is canceled before Cleanup runs. This fixture owns its
	// bounded lifetime explicitly so cleanup can close host stdin and drain SDK
	// lifecycle processes before cancellation would force-kill those children.
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	fixture := newSDKRPCContract(t, ctx)
	a := fixture.profile(t, "a")

	// Meaningful missing-before evidence comes from the actual compiler, not a
	// missing helper symbol or a simulated compiler callback.
	for _, target := range []string{"./host", "./pkg"} {
		output, err := a.compile(target, filepath.Join(a.source, "missing-api"))
		require.Error(t, err, "%s unexpectedly compiled before the API existed", target)
		require.Contains(t, string(output), "WithContractLabel")
		require.Contains(t, string(output), "undefined")
	}
	a.writeAPI(t, "original")
	b := fixture.profile(t, "b")
	b.writeAPI(t, "original")

	a.start(t)
	b.start(t)
	firstA, firstB := a.ready(t), b.ready(t)
	require.Equal(t, "host original", firstA.hostLabel)
	require.Equal(t, "plugin original", firstA.pluginLabel)
	require.Equal(t, "host original", firstB.hostLabel)
	require.Equal(t, "plugin original", firstB.pluginLabel)
	require.NotEqual(t, firstA.pluginPID, firstB.pluginPID)
	require.NotEqual(t, a.workspace.StateRoot, b.workspace.StateRoot)
	a.set(t, 23)
	a.assertValue(t, 23)
	b.assertValue(t, 0)
	installedBefore := a.artifactDigest(t)
	identityBefore := a.identity(t)

	// Only the owned SDK copy changes. A real fsnotify dependency observation
	// drives the production Go builder; old output cannot count as fresh ready.
	a.writeBrokenAPI(t)
	failed := a.failed(t)
	require.Contains(t, failed, "syntax error")
	require.Equal(t, installedBefore, a.artifactDigest(t), "failed compilation published stale/new output")
	require.Equal(t, firstA, a.current(t), "failed build committed a new consumer generation")
	a.assertNoReady(t)
	a.assertValue(t, 23)
	b.assertValue(t, 0)

	// Host compilation independently rejects the same invalid selected source.
	output, err := a.compile("./host", filepath.Join(a.source, "invalid-host"))
	require.Error(t, err)
	require.Contains(t, string(output), "syntax error")
	_, err = os.Stat(filepath.Join(a.source, "invalid-host"))
	require.True(t, os.IsNotExist(err), "failed host compile left a publishable artifact: %v", err)

	a.writeAPI(t, "repaired")
	repaired := a.ready(t)
	require.NotEqual(t, firstA.pluginPID, repaired.pluginPID)
	require.NotEqual(t, firstA.hostPID, repaired.hostPID)
	require.Equal(t, "host repaired", repaired.hostLabel)
	require.Equal(t, "plugin repaired", repaired.pluginLabel)
	require.NotEqual(t, installedBefore, a.artifactDigest(t))
	require.NotEqual(t, identityBefore.SourceDigest, a.identity(t).SourceDigest)
	a.assertValue(t, 23)
	a.assertPersisted(t, 23)
	// B has its own selected source, owned process and actual store, not a
	// canned baseline response; query its unchanged RPC provider again.
	require.Equal(t, firstB, b.current(t))
	b.assertLabels(t, "original")
	b.assertValue(t, 0)
	b.assertPersisted(t, 0)
}
