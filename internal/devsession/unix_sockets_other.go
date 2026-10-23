//go:build !darwin && !linux

package devsession

import "github.com/omniviewdev/omniview/internal/devcontract"

// Other platforms retain go-plugin's existing transport. This is not a claim
// of Unix socket support or runtime verification on those platforms.
type UnixSocketDirectory struct{}

func CreateUnixSocketDirectory(string, devcontract.ProcessIdentity) (*UnixSocketDirectory, error) {
	return nil, nil
}

func ReadUnixSocketDirectory(string, string, string, string) (string, error) {
	return "", nil
}

func (*UnixSocketDirectory) Close() error { return nil }
