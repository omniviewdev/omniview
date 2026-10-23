package devsession

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofrs/flock"
)

// AcquirePrivateLock acquires a stable-inode private flock in an already ensured
// dedicated runtime directory. Name must be one portable leaf filename. Never
// initialize a lock by atomically replacing its path: that can bypass a held
// inode. This creates without following a leaf symlink/reparse point, restricts
// the initial handle, and checks that flock acquired that exact inode.
func AcquirePrivateLock(ctx context.Context, directory, name string) (*flock.Flock, error) {
	if !validLabel(name) || name == "." || name == ".." || !filepath.IsLocal(name) || filepath.Base(name) != name || strings.ContainsAny(name, "/\\") {
		return nil, fmt.Errorf("%w: lock name must be a single leaf filename", ErrOwnership)
	}
	path := filepath.Join(directory, name)
	if err := ValidatePrivateFile(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	file, err := openPrivateLockFile(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, err
	}
	current, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !opened.Mode().IsRegular() || !current.Mode().IsRegular() || !os.SameFile(opened, current) {
		return nil, fmt.Errorf("%w: private lock inode changed", ErrOwnership)
	}
	if err := restrictPrivateLockFile(file); err != nil {
		return nil, err
	}
	lock := flock.New(path, flock.SetPermissions(0600))
	ok, err := lock.TryLockContext(ctx, 10*time.Millisecond)
	if err != nil {
		lock.Close()
		return nil, err
	}
	if !ok {
		lock.Close()
		return nil, ctx.Err()
	}
	locked, err := lock.Stat()
	if err != nil {
		lock.Close()
		return nil, err
	}
	current, err = os.Lstat(path)
	if err != nil {
		lock.Close()
		return nil, err
	}
	if !current.Mode().IsRegular() || !os.SameFile(opened, locked) || !os.SameFile(opened, current) {
		lock.Close()
		return nil, fmt.Errorf("%w: private lock inode changed during acquisition", ErrOwnership)
	}
	if err := ValidatePrivateFile(path); err != nil {
		lock.Close()
		return nil, err
	}
	return lock, nil
}

// atomicPrivateWrite keeps the old complete file until its private replacement
// has been written, synced and closed. Temporary siblings are never discovery.
func atomicPrivateWrite(path string, write func(*os.File) error) error {
	if err := ValidatePrivateFile(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".session-write-*")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer func() { file.Close(); os.Remove(temporary) }()
	if err := restrictPrivatePath(temporary, false); err != nil {
		return err
	}
	if err := write(file); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := replacePrivateFile(temporary, path); err != nil {
		return err
	}
	return syncPrivateDirectory(filepath.Dir(path))
}
