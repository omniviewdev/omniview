package devcontract

import (
	"context"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
	"github.com/google/uuid"
)

// ProfileGuardPath returns the canonical stable UUID guard location without
// creating directories or files. Native lifecycle callers open this same inode
// as LockProfile; no cleanup operation may remove it.
func ProfileGuardPath(home, workspaceID string) (string, error) {
	id, err := uuid.Parse(workspaceID)
	if err != nil || id == uuid.Nil || id.String() != workspaceID {
		return "", Fail(2, "invalid_identity", "profile lock requires a canonical nonzero workspace UUID")
	}
	if home == "" {
		home, err = os.UserHomeDir()
		if err != nil {
			return "", err
		}
	}
	home, err = CanonicalPath(home)
	if err != nil {
		return "", err
	}
	base, err := CanonicalPath(filepath.Join(home, ".omniview-dev"))
	if err != nil {
		return "", err
	}
	locks := filepath.Join(base, "locks")
	if info, e := os.Lstat(locks); e == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", Fail(4, "foreign_profile_lock", "profile lock directory cannot be a symlink")
	} else if e != nil && !os.IsNotExist(e) {
		return "", e
	}
	canonical, err := CanonicalPath(locks)
	if err != nil {
		return "", err
	}
	if canonical != locks {
		return "", Fail(4, "foreign_profile_lock", "profile lock directory cannot be redirected through a symlink")
	}
	path := filepath.Join(locks, workspaceID+".lock")
	if info, e := os.Lstat(path); e == nil && !info.Mode().IsRegular() {
		return "", Fail(4, "foreign_profile_lock", "profile lock file must be a regular file")
	} else if e != nil && !os.IsNotExist(e) {
		return "", e
	}
	canonical, err = CanonicalPath(path)
	if err != nil {
		return "", err
	}
	if canonical != path {
		return "", Fail(4, "foreign_profile_lock", "profile lock file cannot be redirected through a symlink")
	}
	return path, nil
}

// LockProfile serializes startup, baseline publication and profile deletion.
// Its inode is outside the profile tree and must never be removed by cleanup.
// Acquire this guard before an existing state/.lock; startup may release it only
// after acquiring that root flock. A missing state root remains missing.
func LockProfile(ctx context.Context, home, workspaceID string) (func() error, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, err := ProfileGuardPath(home, workspaceID)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	guard := flock.New(path)
	ok, err := guard.TryLock()
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, Fail(4, "profile_busy", "workspace profile lifecycle is in use by another process")
	}
	if err = ctx.Err(); err != nil {
		_ = guard.Unlock()
		return nil, err
	}
	return guard.Unlock, nil
}
