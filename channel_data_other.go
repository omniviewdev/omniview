//go:build !linux && !darwin && !windows

package main

import (
	"fmt"
	"os"
)

func profileLockStatus(string) string { return "unknown" }

func captureProfileIdentity(path string) (os.FileInfo, error) {
	return os.Lstat(path)
}

func deleteInactiveProfile(_ string, _ os.FileInfo) error {
	return fmt.Errorf("safe channel data deletion is unavailable on this platform")
}
