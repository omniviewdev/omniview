package settings

import (
	"errors"
	"os"
	"path/filepath"
)

// TODO - move this to a globally usable package.
const (
	BaseDir   = ".omniview"
	StoreFile = "settings"
)

// TODO - move this to a globally usable package.
func getBaseStorePath(pluginID string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if pluginID != "" {
		return filepath.Join(homeDir, BaseDir, "plugins", pluginID), nil
	}
	return filepath.Join(homeDir, BaseDir), nil
}

// GetStorePath returns the path to the settings store.
func GetStorePath(pluginID string) (string, error) {
	base, err := getBaseStorePath(pluginID)
	if err != nil {
		return "", err
	}

	return filepath.Join(base, StoreFile), nil
}

// GetStore returns the settings store, initializing it if necessary.
func GetStore(pluginID string) (*os.File, error) {
	storePath, err := GetStorePath(pluginID)
	if err != nil {
		return nil, err
	}

	// check if the parent directory needs to be created
	base := filepath.Dir(storePath)
	if _, err = os.Stat(base); errors.Is(err, os.ErrNotExist) {
		if err = os.MkdirAll(base, 0755); err != nil {
			return nil, err
		}
	}

	return os.OpenFile(storePath, os.O_CREATE|os.O_RDWR, 0600)
}

// RemoveStore removes the settings store from the system. This should
// only ever be used when a user decides to reset to factory settings.
func RemoveStore(pluginID string) error {
	storePath, err := GetStorePath(pluginID)
	if err != nil {
		return err
	}

	return os.Remove(storePath)
}
