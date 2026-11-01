//go:build !windows

package resource

import (
	"errors"
	"os"

	"github.com/omniviewdev/omniview/internal/appstate"
)

func openProfileCredentialFile(root *appstate.ScopedRoot, name string) (*os.File, error) {
	file, _, err := root.OpenPrivateFile(name, os.O_RDONLY)
	return file, err
}

func validateProfileCredentialDirectory(_ *appstate.ScopedRoot) error {
	return nil
}

func validatePublicConnectionProfileFile(_ *os.File) error {
	return nil
}

func restrictProfileCredentialFile(file *os.File) error {
	return file.Chmod(0o600)
}

func validateProfileCredentialFile(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
		return errors.New("connection profiles: private credentials require mode 0600")
	}
	return nil
}
