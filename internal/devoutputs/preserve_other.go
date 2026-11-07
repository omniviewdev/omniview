//go:build !darwin && !linux && !windows

package devoutputs

import "fmt"

func preserveRename(source, destination string) error {
	return fmt.Errorf("atomic no-replace preservation is unsupported on this platform")
}
