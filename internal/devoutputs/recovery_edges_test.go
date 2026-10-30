package devoutputs

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRecoveryEdgesFinishRejectsReplacementAndRetriesExactRoot(t *testing.T) {
	for _, replacement := range []string{"directory", "redirected"} {
		t.Run(replacement, func(t *testing.T) {
			ctx := context.Background()
			w, plan, consumer := compositionFixture(t)
			install, err := BeginCompositionInstall(ctx, w, plan)
			require.NoError(t, err)
			writeOutput(t, filepath.Join(consumer, "node_modules", "owned.js"), "installed")
			require.NoError(t, install.Finish(ctx))
			writer, err := BeginVite(ctx, w, consumer)
			require.NoError(t, err)
			loader := filepath.Join(consumer, "vite.config.ts.timestamp-123-abcdef.mjs")
			writeOutput(t, loader, "unmanaged root loader")
			root := filepath.Join(consumer, "node_modules", ".vite-temp")
			writeOutput(t, filepath.Join(root, "owned.mjs"), "owned cache")
			saved := filepath.Join(consumer, "original-cache-root")
			require.NoError(t, os.Rename(root, saved))
			foreign := filepath.Join(t.TempDir(), "foreign-cache")
			writeOutput(t, filepath.Join(foreign, "user.mjs"), "foreign bytes")
			if replacement == "redirected" {
				require.NoError(t, os.Symlink(foreign, root))
			} else {
				writeOutput(t, filepath.Join(root, "user.mjs"), "replacement bytes")
			}
			before, err := os.ReadFile(writer.s.path)
			require.NoError(t, err)
			require.Error(t, writer.Finish(ctx), "terminal producer evidence cannot authorize a replacement root")
			after, err := os.ReadFile(writer.s.path)
			require.NoError(t, err)
			require.Equal(t, before, after, "failed Finish must not partially release other capability roots")
			require.False(t, writer.finished)
			require.Error(t, Restore(ctx, w), "failed Finish must retain ownership authority")
			actual, err := os.ReadFile(filepath.Join(foreign, "user.mjs"))
			require.NoError(t, err)
			require.Equal(t, "foreign bytes", string(actual))
			actual, err = os.ReadFile(loader)
			require.NoError(t, err)
			require.Equal(t, "unmanaged root loader", string(actual))
			// Move the foreign artifact aside, without deleting or adopting it.
			quarantine := filepath.Join(consumer, "replacement-cache-root")
			require.NoError(t, os.Rename(root, quarantine))
			require.NoError(t, os.Rename(saved, root))
			require.NoError(t, writer.Finish(ctx), "same capability must retry against its original root")
			require.NoError(t, writer.Finish(ctx), "successful Finish is idempotent")
			_, err = os.Lstat(quarantine)
			require.NoError(t, err, "foreign artifact must survive successful finalization")
			if replacement == "directory" {
				actual, err = os.ReadFile(filepath.Join(quarantine, "user.mjs"))
				require.NoError(t, err)
				require.Equal(t, "replacement bytes", string(actual))
			}
		})
	}
}

func TestRecoveryEdgesResetPreflightFailurePreservesEveryEarlierTree(t *testing.T) {
	ctx := context.Background()
	w, plan, consumer := compositionFixture(t)
	install, err := BeginCompositionInstall(ctx, w, plan)
	require.NoError(t, err)
	owned := filepath.Join(consumer, "node_modules", "owned.js")
	writeOutput(t, owned, "installed bytes")
	require.NoError(t, install.Finish(ctx))
	s, err := newScope(w)
	require.NoError(t, err)
	before, err := os.ReadFile(s.path)
	require.NoError(t, err)
	outside := t.TempDir()
	foreign := filepath.Join(outside, "node_modules", "foreign.js")
	writeOutput(t, foreign, "foreign bytes")
	removed, err := ResetDependencyTrees(ctx, w, []string{consumer, outside}, false)
	require.Error(t, err)
	require.Empty(t, removed, "preflight failure must not report successful deletion")
	after, err := os.ReadFile(s.path)
	require.NoError(t, err)
	require.Equal(t, before, after)
	actual, err := os.ReadFile(owned)
	require.NoError(t, err)
	require.Equal(t, "installed bytes", string(actual))
	actual, err = os.ReadFile(foreign)
	require.NoError(t, err)
	require.Equal(t, "foreign bytes", string(actual))
	removed, err = ResetDependencyTrees(ctx, w, []string{consumer}, false)
	require.NoError(t, err)
	require.Contains(t, removed, filepath.Join(consumer, "node_modules"))
	require.NoFileExists(t, owned)
	_, err = ResetDependencyTrees(ctx, w, []string{consumer}, false)
	require.NoError(t, err, "retry after successful cleanup must not recreate output")
	require.FileExists(t, foreign)
}
