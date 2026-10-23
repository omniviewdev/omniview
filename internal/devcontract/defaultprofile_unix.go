//go:build !windows

package devcontract

import (
	"os"
	"path/filepath"
)

func publishDefaultProfileOwner(source, destination string) error {
	if err := os.Link(source, destination); err != nil {
		return err
	}
	profile := filepath.Dir(destination)
	for _, path := range []string{profile, filepath.Dir(profile)} {
		directory, err := os.Open(path)
		if err != nil {
			return err
		}
		syncErr := directory.Sync()
		closeErr := directory.Close()
		if syncErr != nil {
			return syncErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}
