//go:build darwin || linux

package extensionpolicy

import (
	"errors"
	"math"
	"os"
	"runtime"

	"github.com/fsnotify/fsnotify"
	"golang.org/x/sys/unix"
)

const privateReadFlags = os.O_RDONLY | unix.O_NOFOLLOW | unix.O_NONBLOCK

// UIDs and Linux filesystem magic numbers can arrive as signed 32-bit words.
// Recover their unsigned value without truncating a wider word into a trusted ID.
func kernelID32[T int | int32 | uint32 | int64](raw T) int64 {
	value := int64(raw)
	if value < 0 && value >= math.MinInt32 {
		return value + (math.MaxUint32 + 1)
	}
	return value
}

func inspectPermissions(f *os.File, info os.FileInfo, kind role) (int64, error) {
	var stat unix.Stat_t
	fd := int(f.Fd())
	defer runtime.KeepAlive(f)
	if err := unix.Fstat(fd, &stat); err != nil {
		return 0, err
	}
	if int64(stat.Uid) != kernelID32(os.Geteuid()) || info.Mode().Perm()&0o400 == 0 || !safeFilesystem(fd) {
		return 0, errUnsafe
	}
	if kind == profileDirectory {
		// Ordinary profile state may be world-readable, but nobody else may
		// replace the private directory or substitute its watched name.
		if info.Mode().Perm()&0o022 != 0 {
			return 0, errUnsafe
		}
	} else if info.Mode().Perm()&0o077 != 0 || kind == policyFile && stat.Nlink != 1 {
		return 0, errUnsafe
	}
	return stat.Ctim.Nano(), nil
}

type policyWatcher struct {
	w               *fsnotify.Watcher
	root, dir, file string
}

func newPolicyWatcher(root, dir, file string) (*policyWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err = w.Add(root); err == nil {
		err = w.Add(dir)
	}
	if err != nil {
		w.Close()
		return nil, err
	}
	return &policyWatcher{w: w, root: root, dir: dir, file: file}, nil
}

func (w *policyWatcher) next() error {
	for {
		select {
		case err := <-w.w.Errors:
			// Overflow, closed channels and all other gaps lose continuity.
			if err != nil {
				return err
			}
			return errUnsafe
		case e, ok := <-w.w.Events:
			if !ok {
				return errUnsafe
			}
			switch e.Name {
			case w.root, w.dir:
				if e.Has(fsnotify.Remove | fsnotify.Rename) {
					return errUnsafe // fsnotify removes this watch on rename
				}
				if e.Has(fsnotify.Chmod) {
					return nil
				}
			case w.file:
				return nil
			}
		}
	}
}

func (w *policyWatcher) interrupt() { w.w.Close() }
func (w *policyWatcher) close()     { w.w.Close() }

// The returned sibling is exactly the displaced policy, not a prior pathname
// read that could have raced another writer.
func exchangePolicy(root *os.Root, _ string, staged string) (string, error) {
	dir, err := root.Open(".")
	if err != nil {
		return "", err
	}
	defer dir.Close()
	if err = exchangeAt(int(dir.Fd()), staged, filename); err != nil {
		if errors.Is(err, unix.ENOSYS) || errors.Is(err, unix.ENOTSUP) || errors.Is(err, unix.EINVAL) {
			// An ordinary atomic rename is still safe. Without the displaced
			// object, however, this commit must fence every prior issuance.
			if err = root.Rename(staged, filename); err != nil {
				return "", err
			}
			return "", dir.Sync()
		}
		return "", err
	}
	return staged, dir.Sync()
}
