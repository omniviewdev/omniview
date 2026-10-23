package devcontract

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/gofrs/flock"

	"github.com/stretchr/testify/require"
)

func TestProfileGuardSurvivesStateDirectoryReplacement(t *testing.T) {
	home := t.TempDir()
	id := "c62cc039-b839-4b82-81e1-8b0106319f17"
	release, err := LockProfile(context.Background(), home, id)
	require.NoError(t, err)
	defer release()
	profile := filepath.Join(home, ".omniview-dev", "profiles", id)
	require.NoError(t, os.MkdirAll(filepath.Join(profile, "state"), 0700))
	require.NoError(t, os.RemoveAll(profile))
	require.NoError(t, os.MkdirAll(filepath.Join(profile, "state"), 0700))
	_, err = LockProfile(context.Background(), home, id)
	require.Error(t, err, "a new state/.lock inode must not bypass the external profile guard")
	other, err := LockProfile(context.Background(), home, "60813fa5-179c-4146-b210-ab0fa6b79870")
	require.NoError(t, err)
	require.NoError(t, other())
}

func TestProfileGuardDoesNotCreateStateAndRejectsRedirectedLocks(t *testing.T) {
	home := t.TempDir()
	id := "c62cc039-b839-4b82-81e1-8b0106319f17"
	release, err := LockProfile(context.Background(), home, id)
	require.NoError(t, err)
	require.NoDirExists(t, filepath.Join(home, ".omniview-dev", "profiles", id))
	require.NoError(t, release())
	path := filepath.Join(home, ".omniview-dev", "locks", id+".lock")
	require.NoError(t, os.Remove(path))
	require.NoError(t, os.Symlink(filepath.Join(t.TempDir(), "foreign"), path))
	_, err = LockProfile(context.Background(), home, id)
	require.Error(t, err)
	_, err = LockProfile(context.Background(), home, "../foreign")
	require.Error(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = LockProfile(ctx, home, "60813fa5-179c-4146-b210-ab0fa6b79870")
	require.ErrorIs(t, err, context.Canceled)
}

func TestProfileGuardCanonicalizesSharedContainerAndDefaultHome(t *testing.T) {
	home := t.TempDir()
	alias := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(home, ".omniview-dev"), 0700))
	if err := os.Symlink(filepath.Join(home, ".omniview-dev"), filepath.Join(alias, ".omniview-dev")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	id := "c62cc039-b839-4b82-81e1-8b0106319f17"
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	release, err := LockProfile(context.Background(), "", id)
	require.NoError(t, err)
	defer release()
	_, err = LockProfile(context.Background(), alias, id)
	require.Error(t, err, "container aliases must contend on one stable lock inode")
	require.NoDirExists(t, filepath.Join(home, ".omniview-dev", "profiles"))
}

func TestProfileGuardPathIsReadOnlyAndMatchesLockProfile(t *testing.T) {
	home := t.TempDir()
	id := "c62cc039-b839-4b82-81e1-8b0106319f17"
	path, err := ProfileGuardPath(home, id)
	require.NoError(t, err)
	canonicalHome, err := CanonicalPath(home)
	require.NoError(t, err)
	require.Equal(t, filepath.Join(canonicalHome, ".omniview-dev", "locks", id+".lock"), path)
	require.NoDirExists(t, filepath.Join(home, ".omniview-dev"))
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
	lock := flock.New(path)
	require.NoError(t, lock.Lock())
	defer lock.Close()
	_, err = LockProfile(context.Background(), home, id)
	require.Equal(t, 4, ExitCode(err), "native guard path must contend with LockProfile")
	require.NoDirExists(t, filepath.Join(home, ".omniview-dev", "profiles"))
}

func TestProfileGuardPathRejectsForeignLocksWithoutMutation(t *testing.T) {
	id := "c62cc039-b839-4b82-81e1-8b0106319f17"
	for _, kind := range []string{"directory symlink", "file symlink", "invalid UUID"} {
		t.Run(kind, func(t *testing.T) {
			home := t.TempDir()
			selectedID := id
			locks := filepath.Join(home, ".omniview-dev", "locks")
			if kind == "invalid UUID" {
				selectedID = "../foreign"
			} else {
				require.NoError(t, os.MkdirAll(filepath.Dir(locks), 0700))
				if kind == "directory symlink" {
					require.NoError(t, os.Symlink(t.TempDir(), locks))
				} else {
					require.NoError(t, os.MkdirAll(locks, 0700))
					target := filepath.Join(t.TempDir(), "foreign.lock")
					require.NoError(t, os.WriteFile(target, nil, 0600))
					require.NoError(t, os.Symlink(target, filepath.Join(locks, id+".lock")))
				}
			}
			_, err := ProfileGuardPath(home, selectedID)
			require.Error(t, err)
			require.NoDirExists(t, filepath.Join(home, ".omniview-dev", "profiles"))
		})
	}
}
