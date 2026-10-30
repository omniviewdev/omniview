package devoutputs

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestManagedLoaderResetPreservesUnmanagedRootArtifacts(t *testing.T) {
	for _, kind := range []string{"file", "directory", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			w, plan, consumer := compositionFixture(t)
			install, err := BeginCompositionInstall(ctx, w, plan)
			require.NoError(t, err)
			writeOutput(t, filepath.Join(consumer, "node_modules", "owned.js"), "installed")
			require.NoError(t, install.Finish(ctx))
			artifact := filepath.Join(consumer, "vite.config.ts.timestamp-123-abcdef.mjs")
			foreign := filepath.Join(t.TempDir(), "foreign")
			writeOutput(t, foreign, "foreign bytes")
			switch kind {
			case "file":
				writeOutput(t, artifact, "user bytes")
			case "directory":
				writeOutput(t, filepath.Join(artifact, "user"), "user bytes")
			case "symlink":
				require.NoError(t, os.Symlink(foreign, artifact))
			}
			original, err := os.Lstat(artifact)
			require.NoError(t, err)
			writer, err := BeginVite(ctx, w, consumer)
			require.NoError(t, err)
			loader := filepath.Join(consumer, "node_modules", ".vite-temp", "vite.config.ts.timestamp-456-fedcba.mjs")
			writeOutput(t, loader, "managed loader")
			require.Error(t, Restore(ctx, w), "live writer must retain its evidence")
			require.NoError(t, writer.Finish(ctx))
			_, err = ResetDependencyTrees(ctx, w, []string{consumer}, true)
			require.NoError(t, err)
			_, err = ResetDependencyTrees(ctx, w, []string{consumer}, true)
			require.NoError(t, err, "explicit reset is retryable")
			require.NoError(t, Restore(ctx, w))
			current, err := os.Lstat(artifact)
			require.NoError(t, err)
			require.True(t, os.SameFile(original, current))
			actual, err := os.ReadFile(foreign)
			require.NoError(t, err)
			require.Equal(t, "foreign bytes", string(actual))
			require.NoFileExists(t, loader)
		})
	}
}

func TestManagedLoaderPreallocatesOwnedDirectoryBeforeProducer(t *testing.T) {
	ctx := context.Background()
	w, plan, consumer := compositionFixture(t)
	install, err := BeginCompositionInstall(ctx, w, plan)
	require.NoError(t, err)
	writeOutput(t, filepath.Join(consumer, "node_modules", "owned.js"), "installed")
	require.NoError(t, install.Finish(ctx))
	root := filepath.Join(consumer, "node_modules", ".vite-temp")
	foreign := t.TempDir()
	require.NoError(t, os.Symlink(foreign, root))
	_, err = BeginVite(ctx, w, consumer)
	require.Error(t, err, "redirected loader directory cannot admit a producer")
	require.NoError(t, os.Remove(root))
	writer, err := BeginVite(ctx, w, consumer)
	require.NoError(t, err, "retry admits only the owned loader directory")
	info, err := os.Lstat(root)
	require.NoError(t, err)
	require.True(t, info.IsDir())
	require.Zero(t, info.Mode()&os.ModeSymlink)
	require.Equal(t, os.FileMode(0700), info.Mode().Perm())
	require.NoError(t, locked(ctx, writer.s, func(j *journal) error {
		require.NotNil(t, j.Entries[root+"|"+string(loaderCache)])
		require.Nil(t, j.Entries[consumer+"|"+string(loaderFiles)], "root timestamp files are never adopted")
		return nil
	}))
	require.NoError(t, writer.Finish(ctx))
}
