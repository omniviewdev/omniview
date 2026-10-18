//go:build !linux && !darwin && !windows

package devsession

import "github.com/omniviewdev/omniview/internal/devcontract"

func inspectProcess(int) (string, string, error) {
	return "", "", ErrUnsupportedIdentity
}

func terminateExactProcess(devcontract.ProcessIdentity) error {
	return ErrUnsupportedIdentity
}
