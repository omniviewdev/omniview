package devworkspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/stretchr/testify/require"
)

func TestRemovalRetainsUnixSocketProofBeforeNativeCallbackOrPurge(t *testing.T) {
	for _, kind := range []string{"malformed", "foreign-directory"} {
		t.Run(kind, func(t *testing.T) {
			m, _ := fixtureManager(t)
			ctx := context.Background()
			w, err := m.Create(ctx, CreateOptions{Slug: "socket-proof"})
			require.NoError(t, err)
			require.NoError(t, devcontract.EnsureDefaultProfileOwnership(m.options.Home, w.Manifest.WorkspaceID))
			profile, err := m.defaultProfileRoot(w.Manifest.WorkspaceID)
			require.NoError(t, err)
			runtime := filepath.Join(profile, "runtime")
			require.NoError(t, os.MkdirAll(runtime, 0700))
			proof := filepath.Join(runtime, "unix-sockets-9d799eef-e491-493f-942a-54ac906ca34e.json")
			if kind == "malformed" {
				require.NoError(t, os.WriteFile(proof, []byte("{"), 0600))
			} else {
				require.NoError(t, os.Mkdir(proof, 0700))
			}
			called := false
			_, err = m.Remove(ctx, "socket-proof", RemoveOptions{PurgeState: true, DeleteBranches: true, BeforeRemove: func(context.Context, Workspace, []GuardFile) error { called = true; return nil }})
			require.True(t, errors.Is(err, devsession.ErrOwnership), "retained proof must cause the socket-specific ownership refusal: %v", err)
			require.False(t, called, "native deletion must not precede retained transport ownership checks")
			require.DirExists(t, filepath.Join(w.Root, "omniview"))
			_, statErr := os.Lstat(proof)
			require.NoError(t, statErr, "last external-namespace provenance was purged")
			current, inspectErr := m.Inspect(ctx, "socket-proof")
			require.NoError(t, inspectErr)
			require.Equal(t, "complete", current.Phase)
		})
	}
}
