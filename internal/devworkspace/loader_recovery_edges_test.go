package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/stretchr/testify/require"
)

// No subprocess is launched. The stopped guard authorizes explicit dependency
// reset, including the managed Vite loader cache, without adopting root files.
func TestLoaderRecoveryEdgesStoppedWriterHasSupportedRecovery(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	_, err := devoutputs.BeginVite(ctx, f.w.ResolvedWorkspace, f.host)
	require.NoError(t, err)
	artifact := filepath.Join(f.host, "node_modules", ".vite-temp", "vite.config.ts.timestamp-123-abcdef.mjs")
	require.NoError(t, os.WriteFile(artifact, []byte("owned loader output"), 0600))
	profile := bindFixtureProfile(t, f.m, f.w)
	require.NoError(t, os.MkdirAll(profile, 0700))
	canaries := map[string]string{
		filepath.Join(f.host, "vite.config.ts"):                          "export default {}\n",
		filepath.Join(f.host, "unrelated.txt"):                           "user bytes\n",
		filepath.Join(profile, "profile-state"):                          "profile bytes\n",
		filepath.Join(f.host, "vite.config.ts.timestamp-456-fedcba.mjs"): "unmanaged root loader bytes\n",
	}
	for path, value := range canaries {
		require.NoError(t, os.WriteFile(path, []byte(value), 0600))
	}
	assertCanaries := func() {
		for path, value := range canaries {
			actual, readErr := os.ReadFile(path)
			require.NoError(t, readErr)
			require.Equal(t, value, string(actual))
		}
	}
	_, err = f.m.Unlink(ctx, f.w.Manifest.Slug)
	require.Error(t, err, "normal unlink must refuse a retained writer")
	link, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	require.Equal(t, "unlinking", link.Phase)

	report, err := f.m.ResetModules(ctx, f.w.Manifest.Slug)
	require.NoError(t, err)
	require.Equal(t, "unlinking", report.Phase)
	require.False(t, report.Reinstalled)
	require.Equal(t, 1, f.installs)
	entries := f.outputJournal(t)
	require.Empty(t, entries, "reset retires only managed dependency outputs")
	_, err = os.Lstat(artifact)
	require.True(t, os.IsNotExist(err), "explicit dependency reset removes the managed loader cache")
	assertCanaries()

	// Recovery resumes retirement after dependency-only reset. Unmanaged
	// root-level loader files remain outside both operations' authority.
	launch := LaunchOptions{
		Mode:                "browser",
		ReviewedSDKRevision: fixtureGit(t, filepath.Join(f.m.Root, "plugin-sdk"), "rev-parse", "HEAD"),
	}
	result, recoverErr := f.m.Recover(ctx, f.w.Manifest.Slug, RefreshOptions{Launch: &launch})
	assertCanaries()
	if recoverErr != nil {
		require.Equal(t, "retire", result.Phase, "recovery must reach output retirement, not fail a launch prerequisite")
		require.Equal(t, entries, f.outputJournal(t))
		t.Fatalf("managed loader cache has no supported recovery after explicit dependency reset: %v", recoverErr)
	}
	unlinked, err := f.m.Unlink(ctx, f.w.Manifest.Slug)
	require.NoError(t, err)
	require.Equal(t, "unlinked", unlinked.Phase)
	assertCanaries()
}
