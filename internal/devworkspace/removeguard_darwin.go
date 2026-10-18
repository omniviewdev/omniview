//go:build darwin

package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"syscall"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"golang.org/x/sys/unix"
)

// lockRemoval retains the actual BSD-flock open file descriptions. A native
// helper may inherit duplicates, but only this parent releases these locks after
// the callback and the complete filesystem/Git transaction have finished.
func (m *Manager) lockRemoval(ctx context.Context, w devcontract.ResolvedWorkspace) (func(), []GuardFile, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if m.options.Stopped == nil {
		return nil, nil, devcontract.Fail(4, "stop_check_required", "a session-aware stopped guard is required before removing owned resources")
	}
	path, err := devcontract.ProfileGuardPath(m.options.Home, w.Manifest.WorkspaceID)
	if err != nil {
		return nil, nil, err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, nil, err
	}
	guards := make([]GuardFile, 0, 3)
	unlock := func() {
		for i := len(guards) - 1; i >= 0; i-- {
			_ = unix.Flock(int(guards[i].File.Fd()), unix.LOCK_UN)
			_ = guards[i].File.Close()
		}
	}
	guard, err := acquireRemovalFile(ctx, path, "uuid")
	if err != nil {
		return nil, nil, err
	}
	guards = append(guards, guard)
	if _, err = os.Stat(filepath.Dir(w.StateRoot)); err == nil {
		if err = m.ensureProfileOwner(w); err != nil {
			unlock()
			return nil, nil, err
		}
	} else if !os.IsNotExist(err) {
		unlock()
		return nil, nil, err
	}
	defaultState, err := m.defaultStateRoot(w.Manifest.WorkspaceID)
	if err != nil {
		unlock()
		return nil, nil, err
	}
	for i, root := range [2]string{w.StateRoot, defaultState} {
		if i == 1 && root == w.StateRoot {
			continue
		}
		info, e := os.Lstat(root)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			unlock()
			return nil, nil, e
		}
		if !info.IsDir() {
			unlock()
			return nil, nil, devcontract.Fail(4, "foreign_profile", "profile state root must be a real directory")
		}
		canonical, e := devcontract.CanonicalPath(root)
		if e != nil {
			unlock()
			return nil, nil, e
		}
		if canonical != root {
			unlock()
			return nil, nil, devcontract.Fail(4, "foreign_profile", "profile state root cannot be redirected through a symlink")
		}
		role := "selected-state"
		if i == 1 {
			role = "default-state"
			if e = devcontract.ValidateDefaultProfileOwnership(m.options.Home, w.Manifest.WorkspaceID); e != nil {
				unlock()
				return nil, nil, e
			}
		}
		guard, e = acquireRemovalFile(ctx, filepath.Join(root, ".lock"), role)
		if e != nil {
			unlock()
			return nil, nil, e
		}
		guards = append(guards, guard)
	}
	if err = m.options.Stopped(ctx, w); err != nil {
		unlock()
		return nil, nil, err
	}
	if err = ctx.Err(); err != nil {
		unlock()
		return nil, nil, err
	}
	return unlock, guards, nil
}

func acquireRemovalFile(ctx context.Context, path, role string) (GuardFile, error) {
	var result GuardFile
	if err := ctx.Err(); err != nil {
		return result, err
	}
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return result, err
	}
	if canonical != path {
		return result, devcontract.Fail(4, "foreign_profile_lock", "removal lock cannot be redirected through a symlink")
	}
	fd, err := unix.Open(path, unix.O_CREAT|unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return result, err
	}
	file := os.NewFile(uintptr(fd), path)
	closeFailure := func(err error) (GuardFile, error) { _ = file.Close(); return GuardFile{}, err }
	info, err := file.Stat()
	if err != nil {
		return closeFailure(err)
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || !ok || stat.Uid != uint32(os.Geteuid()) {
		return closeFailure(devcontract.Fail(4, "foreign_profile_lock", "removal guard must be a private regular file owned by the current user"))
	}
	pathInfo, err := os.Lstat(path)
	if err != nil {
		return closeFailure(err)
	}
	if !pathInfo.Mode().IsRegular() || !os.SameFile(info, pathInfo) {
		return closeFailure(devcontract.Fail(4, "foreign_profile_lock", "removal guard file identity changed during acquisition"))
	}
	if err = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		if err == unix.EWOULDBLOCK || err == unix.EAGAIN {
			return closeFailure(devcontract.Fail(4, "workspace_busy", "workspace or profile is in use by another process"))
		}
		return closeFailure(err)
	}
	if err = ctx.Err(); err != nil {
		_ = unix.Flock(fd, unix.LOCK_UN)
		return closeFailure(err)
	}
	return GuardFile{Role: role, File: file}, nil
}
