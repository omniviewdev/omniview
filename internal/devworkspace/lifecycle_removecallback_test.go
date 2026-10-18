package devworkspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func TestRemovalCallbackCannotPrecedeCanonicalRefusals(t *testing.T) {
	for _, kind := range []string{"dirty", "user commits", "foreign default profile"} {
		t.Run(kind, func(t *testing.T) {
			m, _ := fixtureManager(t)
			ctx := context.Background()
			w, err := m.Create(ctx, CreateOptions{Slug: "callback-refusal"})
			require.NoError(t, err)
			host := filepath.Join(w.Root, "omniview")
			switch kind {
			case "dirty":
				require.NoError(t, os.WriteFile(filepath.Join(host, "keep"), []byte("user file"), 0600))
			case "user commits":
				fixtureGit(t, host, "commit", "--allow-empty", "-m", "user commit")
			case "foreign default profile":
				bindFixtureProfile(t, m, w)
				require.NoError(t, atomicJSON(filepath.Join(filepath.Dir(w.StateRoot), ".workspace-owner.json"), profileOwner{SchemaVersion: 1, WorkspaceID: "60813fa5-179c-4146-b210-ab0fa6b79870"}))
			}
			called := false
			_, err = m.Remove(ctx, "callback-refusal", RemoveOptions{PurgeState: true, DeleteBranches: true, BeforeRemove: func(context.Context, Workspace, []GuardFile) error { called = true; return nil }})
			require.Error(t, err)
			require.False(t, called, "irreversible callbacks must not precede canonical ownership/Git refusal checks")
			require.DirExists(t, host)
			current, err := m.Inspect(ctx, "callback-refusal")
			require.NoError(t, err)
			require.Equal(t, "complete", current.Phase)
		})
	}
}

func TestRemovalCallbackErrorPreservesSourcesAndRunsUnderUUIDGuard(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "callback-failure"})
	require.NoError(t, err)
	failure := errors.New("native cleanup did not complete")
	_, err = m.Remove(ctx, "callback-failure", RemoveOptions{PurgeState: true, BeforeRemove: func(ctx context.Context, selected Workspace, guards []GuardFile) error {
		require.Equal(t, w.Manifest.WorkspaceID, selected.Manifest.WorkspaceID)
		require.DirExists(t, filepath.Join(selected.Root, "omniview"))
		_, lockErr := devcontract.LockProfile(ctx, m.options.Home, selected.Manifest.WorkspaceID)
		require.Error(t, lockErr, "callback must not run after releasing its UUID guard")
		return failure
	}})
	require.ErrorIs(t, err, failure)
	require.DirExists(t, filepath.Join(w.Root, "omniview"))
	require.FileExists(t, filepath.Join(filepath.Dir(w.StateRoot), ".workspace-owner.json"))
	current, err := m.Inspect(ctx, "callback-failure")
	require.NoError(t, err)
	require.Equal(t, "complete", current.Phase)
	release, err := devcontract.LockProfile(ctx, m.options.Home, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.NoError(t, release())
}

func TestGeneratedValidationPrecedesCallbackAndCleanupMustLeaveStrictMetadata(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "generated-callback"})
	require.NoError(t, err)
	generated := filepath.Join(w.Root, ".local", "owned-generated-output")
	require.NoError(t, os.WriteFile(generated, []byte("authored bytes"), 0600))
	callbackCalled := false
	refusal := errors.New("generated output changed")
	_, err = m.Remove(ctx, "generated-callback", RemoveOptions{ValidateGenerated: func(context.Context, Workspace) error { return refusal }, BeforeRemove: func(context.Context, Workspace, []GuardFile) error { callbackCalled = true; return nil }})
	require.ErrorIs(t, err, refusal)
	require.False(t, callbackCalled)
	require.FileExists(t, generated)
	validated := false
	_, err = m.Remove(ctx, "generated-callback", RemoveOptions{ValidateGenerated: func(context.Context, Workspace) error {
		data, err := os.ReadFile(generated)
		if err != nil {
			return err
		}
		require.Equal(t, "authored bytes", string(data))
		validated = true
		return nil
	}, BeforeRemove: func(context.Context, Workspace, []GuardFile) error {
		require.True(t, validated)
		require.FileExists(t, generated, "helper/output must remain available until the irreversible callback completes")
		require.DirExists(t, filepath.Join(w.Root, "omniview"))
		return os.Remove(generated)
	}})
	require.NoError(t, err)
	require.NoDirExists(t, w.Root)
}
