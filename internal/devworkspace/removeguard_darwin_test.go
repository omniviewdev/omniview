//go:build darwin

package devworkspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/gofrs/flock"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

func TestDarwinRemovalCapabilitiesRetainSameLockedFileDescriptions(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "guard-capabilities"})
	require.NoError(t, err)
	state := bindFixtureProfile(t, m, w)
	for _, path := range []string{state, w.StateRoot} {
		require.NoError(t, os.MkdirAll(path, 0700))
	}
	uuidPath, err := devcontract.ProfileGuardPath(m.options.Home, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	paths := map[string]string{"uuid": uuidPath, "selected-state": filepath.Join(state, ".lock"), "default-state": filepath.Join(w.StateRoot, ".lock")}
	failure := errors.New("stop after native capability probe")
	_, err = m.Remove(ctx, "guard-capabilities", RemoveOptions{PurgeState: true, BeforeRemove: func(ctx context.Context, selected Workspace, guards []GuardFile) error {
		require.Equal(t, state, selected.StateRoot)
		require.Len(t, guards, 3)
		seen := map[string]bool{}
		for _, guard := range guards {
			require.False(t, seen[guard.Role])
			seen[guard.Role] = true
			path, ok := paths[guard.Role]
			require.True(t, ok)
			fdInfo, err := guard.File.Stat()
			require.NoError(t, err)
			pathInfo, err := os.Stat(path)
			require.NoError(t, err)
			require.True(t, os.SameFile(fdInfo, pathInfo))
			require.Zero(t, fdInfo.Mode().Perm()&0077)
			// Cmd.ExtraFiles inherits a duplicate of this same OFD. Rechecking
			// flock on it succeeds; closing the duplicate must not unlock parent.
			duplicate, err := unix.Dup(int(guard.File.Fd()))
			require.NoError(t, err)
			require.NoError(t, unix.Flock(duplicate, unix.LOCK_EX|unix.LOCK_NB))
			require.NoError(t, unix.Close(duplicate))
			contender := flock.New(path)
			ok, err = contender.TryLock()
			require.NoError(t, err)
			if ok {
				_ = contender.Unlock()
			}
			require.False(t, ok, "closing inherited duplicate must leave parent OFD locked")
		}
		return failure
	}})
	require.ErrorIs(t, err, failure)
	require.DirExists(t, filepath.Join(w.Root, "omniview"))
	release, err := devcontract.LockProfile(ctx, m.options.Home, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.NoError(t, release())
}

func TestDarwinDefaultSelectedStateHasNoDuplicateDefaultCapability(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "same-state-capability"})
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(w.StateRoot, 0700))
	failure := errors.New("leave fixture intact")
	_, err = m.Remove(ctx, "same-state-capability", RemoveOptions{BeforeRemove: func(_ context.Context, _ Workspace, guards []GuardFile) error {
		require.Len(t, guards, 2)
		require.Equal(t, "uuid", guards[0].Role)
		require.Equal(t, "selected-state", guards[1].Role)
		return failure
	}})
	require.ErrorIs(t, err, failure)
}
