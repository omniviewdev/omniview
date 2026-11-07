//go:build !darwin && !linux && !windows

package devoutputs

import (
	"fmt"
	"os"
)

func renamePinnedNoReplace(*os.File, string, *os.File, string) error {
	return fmt.Errorf("atomic handle-relative no-replace preservation is unsupported on this platform")
}
