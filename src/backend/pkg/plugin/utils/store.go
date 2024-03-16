package utils

import (
	"errors"
	"os"
	"path/filepath"
)

// GetPluginStorePath returns the path to the plugin store for the given plugin.
func GetPluginStorePath(pluginID string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	basePluginPath := filepath.Join(homeDir, ".omniview", "plugins", pluginID)

	// check to make sure the plugin store directory exists
	if _, err = os.Stat(basePluginPath); os.IsNotExist(err) {
		return "", errors.New("failed to create plugin store: plugin is not installed")
	}

	return filepath.Join(homeDir, ".omniview", "plugins", pluginID, "store"), nil
}

// initializeStore creates the store directory for the given plugin and capability.
func InitializePluginStore(pluginID string) error {
	storePath, err := GetPluginStorePath(pluginID)
	if err != nil {
		return err
	}

	return os.MkdirAll(storePath, 0700)
}

// getStore returns a file handle to the store for the given plugin and capability.
// If the store does not exist, it will be created.
// Make sure to close the file handle after using it!
func GetStore(capability, pluginID string) (*os.File, error) {
	storePath, err := GetPluginStorePath(pluginID)
	if err != nil {
		return nil, err
	}

	if err = InitializePluginStore(pluginID); err != nil {
		return nil, err
	}

	return os.OpenFile(filepath.Join(storePath, capability), os.O_CREATE|os.O_RDWR, 0600)
}

// removeStore removes the store for the given plugin and capability.
func RemoveStore(capability, pluginID string) error {
	storePath, err := GetPluginStorePath(pluginID)
	if err != nil {
		return err
	}
	return os.Remove(filepath.Join(storePath, capability))
}
