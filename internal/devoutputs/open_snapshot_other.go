//go:build !darwin && !linux && !windows

package devoutputs

import (
	"fmt"
	"os"
)

func openSnapshotFile(string) (*os.File, error) {
	return nil, fmt.Errorf("no-follow nonblocking output snapshots are unsupported on this platform")
}
