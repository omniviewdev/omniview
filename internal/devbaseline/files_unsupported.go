//go:build !darwin && !linux && !windows

package devbaseline

import "os"

// Unknown platforms compile for read-only integration but fail before opening
// source state or staging; there is no non-atomic replacement fallback.
func independentFile(_ string, _ os.FileInfo) error            { return checkPlatform() }
func syncDirectory(_ string) error                             { return checkPlatform() }
func finalize(_, _ string) error                               { return checkPlatform() }
func acquireSourceLock(_ string) (func() error, string, error) { return nil, "", checkPlatform() }
