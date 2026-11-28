//go:build !windows

package linkresolve

import (
	"io/fs"
	"os"
	"syscall"
)

// ReadDir reads at most n entries of a directory. It opens the path as a directory only, never through a link, and never waits: a path that was
// swapped for a pipe or a device between the parent's read and this open is refused by the kernel (ENOTDIR, ELOOP), not opened.
func (OSFS) ReadDir(p string, n int) ([]fs.DirEntry, error) {
	f, err := os.OpenFile(p, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	return f.ReadDir(n)
}
