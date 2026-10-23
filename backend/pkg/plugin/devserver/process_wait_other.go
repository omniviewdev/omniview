//go:build !linux && !darwin && !windows

package devserver

import "fmt"

func awaitOwnedExit(int) error {
	return fmt.Errorf("nonreaping managed process observation is unsupported on this platform")
}
