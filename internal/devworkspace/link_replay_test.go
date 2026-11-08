package devworkspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFailedLinkResetReplaysAppliedFiles(t *testing.T) {
	t.Parallel()
	for _, mutation := range []string{"none", "foreign", "symlink", "identity"} {
		t.Run(mutation, func(t *testing.T) {
			ctx := context.Background()
			m, w, j := recoveryFixture(t)
			calls := 0
			run := func(_ context.Context, dir, _ string, args ...string) ([]byte, error) {
				if args[0] == "install" {
					calls++
					require.NoError(t, os.WriteFile(filepath.Join(dir, "node_modules", "partial"), []byte("partial install"), 0600))
					if calls == 1 {
						return nil, errors.New("failed install")
					}
				}
				return nil, nil
			}
			_, err := m.link(ctx, w.Manifest.Slug, LinkOptions{Evidence: j.Evidence}, run)
			require.ErrorContains(t, err, "failed install")
			reset, err := m.ResetModules(ctx, w.Manifest.Slug)
			require.NoError(t, err)
			require.Equal(t, "applying", reset.Phase)
			require.False(t, reset.Reinstalled)
			path := filepath.Join(w.Root, "package.json")
			switch mutation {
			case "foreign":
				require.NoError(t, os.WriteFile(path, []byte("foreign bytes"), 0600))
			case "symlink":
				outside := filepath.Join(t.TempDir(), "package.json")
				require.NoError(t, os.WriteFile(outside, j.Files[0].Applied, 0600))
				require.NoError(t, os.Remove(path))
				require.NoError(t, os.Symlink(outside, path))
			case "identity":
				j.WorkspaceID = "11111111-1111-4111-8111-111111111111"
				require.NoError(t, atomicJSON(filepath.Join(w.Root, ".local", "links.json"), j))
			}
			report, err := m.link(ctx, w.Manifest.Slug, LinkOptions{Evidence: j.Evidence}, run)
			if mutation != "none" {
				require.Error(t, err)
				require.Equal(t, 1, calls, "refusal must precede another installer")
				return
			}
			require.NoError(t, err)
			require.Equal(t, "linked", report.Phase)
			require.Equal(t, 2, calls)
		})
	}
}
