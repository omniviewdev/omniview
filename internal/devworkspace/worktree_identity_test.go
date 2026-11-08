package devworkspace

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func TestWorktreeIdentityRejectsBranchSubstitutionAndDetachedHEAD(t *testing.T) {
	t.Parallel()
	for _, sourceName := range []string{"source with spaces", "source\nwith spaces"} {
		t.Run(sourceName, func(t *testing.T) {
			t.Parallel()
			ctx := context.Background()
			source := fixtureRepo(t, t.TempDir(), sourceName, "")
			root := filepath.Join(t.TempDir(), "collection")
			_, err := Init(ctx, InitOptions{Root: root, Sources: []SourceSpec{{ID: "omniview", Path: source, DefaultRef: "main"}}})
			require.NoError(t, err)
			manager, err := Open(root, Options{Home: t.TempDir()})
			require.NoError(t, err)
			workspace, err := manager.Create(ctx, CreateOptions{Slug: "identity"})
			require.NoError(t, err)
			journal, err := loadJournal(workspace.Root)
			require.NoError(t, err)
			owned := &journal.Resources[0]
			require.NoError(t, verifyWorktree(ctx, owned, true))
			fixtureGit(t, owned.Path, "checkout", "-b", "foreign-branch")
			assertForeign := func() {
				t.Helper()
				err := verifyWorktree(ctx, owned, false)
				var failure *devcontract.Error
				require.ErrorAs(t, err, &failure)
				require.Equal(t, "foreign_worktree", failure.Code)
			}
			assertForeign()
			fixtureGit(t, owned.Path, "checkout", owned.Repository.Branch)
			require.NoError(t, verifyWorktree(ctx, owned, true))
			fixtureGit(t, owned.Path, "checkout", "--detach")
			assertForeign()
		})
	}
}
