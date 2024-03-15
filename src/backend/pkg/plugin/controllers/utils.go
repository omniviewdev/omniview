package controllers

import (
	"errors"
	"os"
	"path/filepath"
)

// getPluginStorePath returns the path to the plugin store for the given plugin.
func getPluginStorePath(pluginID string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	basePluginPath := filepath.Join(homeDir, ".omniview", "plugins", pluginID)

	// check to make sure the plugin store directory exists
	if _, err := os.Stat(basePluginPath); os.IsNotExist(err) {
		return "", errors.New("failed to create plugin store: plugin is not installed")
	}

	return filepath.Join(homeDir, ".omniview", "plugins", pluginID, "store"), nil
}

// initializeStore creates the store directory for the given plugin and capability.
func initializePluginStore(pluginID string) error {
	storePath, err := getPluginStorePath(pluginID)
	if err != nil {
		return err
	}

	return os.MkdirAll(storePath, 0700)
}

// getStore returns a file handle to the store for the given plugin and capability.
// If the store does not exist, it will be created.
// Make sure to close the file handle after using it!
func getStore(cap, pluginID string) (*os.File, error) {
	storePath, err := getPluginStorePath(pluginID)
	if err != nil {
		return nil, err
	}

	if err := initializePluginStore(pluginID); err != nil {
		return nil, err
	}

	return os.OpenFile(filepath.Join(storePath, cap), os.O_CREATE|os.O_RDWR, 0600)
}

// removeStore removes the store for the given plugin and capability.
func removeStore(cap, pluginID string) error {
	storePath, err := getPluginStorePath(pluginID)
	if err != nil {
		return err
	}
	return os.Remove(filepath.Join(storePath, cap))
}
