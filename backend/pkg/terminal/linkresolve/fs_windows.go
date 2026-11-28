//go:build windows

package linkresolve

import (
	"io/fs"
	"os"
)

// ReadDir reads at most n entries of a directory.
func (OSFS) ReadDir(p string, n int) ([]fs.DirEntry, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	return f.ReadDir(n)
}
