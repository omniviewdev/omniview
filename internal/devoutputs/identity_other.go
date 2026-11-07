//go:build !darwin && !linux && !windows

package devoutputs

import (
	"fmt"
	"os"
)

func directoryIdentity(string) (string, error) {
	return "", fmt.Errorf("stable repository output identity is unsupported on this platform")
}

func directoryHandleIdentity(*os.File) (string, error) {
	return "", fmt.Errorf("stable repository output identity is unsupported on this platform")
}
