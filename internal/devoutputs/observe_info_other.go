//go:build !windows

package devoutputs

import "os"

func stableSnapshotInfo(_ string, observed os.FileInfo) (os.FileInfo, error) {
	return observed, nil
}
