//go:build !windows && !darwin && !linux

package terminal

import "errors"

// processCwd is not available on a platform where the host has no cheap way to read it.
func processCwd(int) (string, error) { return "", errors.ErrUnsupported }
