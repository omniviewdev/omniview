//go:build !windows

package devoutputs

import "os"

func observeSnapshotPath(path string) (os.FileInfo, error) {
	return os.Lstat(path)
}
