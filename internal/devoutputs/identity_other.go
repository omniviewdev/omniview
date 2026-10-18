//go:build !darwin && !linux && !windows

package devoutputs

import "fmt"

func directoryIdentity(string) (string, error) {
	return "", fmt.Errorf("stable repository output identity is unsupported on this platform")
}
