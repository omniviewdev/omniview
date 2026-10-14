package utils

import (
	"os"

	"github.com/omniviewdev/omniview/internal/appstate"
)

const (
	// storeDirPerm is the permission for a plugin's store directory.
	storeDirPerm os.FileMode = 0o700
	// storeFilePerm is the permission for a plugin's store files.
	storeFilePerm os.FileMode = 0o600
)

// InitializePluginStore creates the store directory for the given plugin.
func InitializePluginStore(storeRoot *appstate.ScopedRoot) error {
	return storeRoot.MkdirAll(".", storeDirPerm)
}

// GetStore returns a file handle to the store for the given plugin and capability.
// If the store does not exist, it will be created.
// Make sure to close the file handle after using it!
func GetStore(capability string, storeRoot *appstate.ScopedRoot) (*os.File, error) {
	if err := InitializePluginStore(storeRoot); err != nil {
		return nil, err
	}

	return storeRoot.OpenFile(capability, os.O_CREATE|os.O_RDWR, storeFilePerm)
}

// RemoveStore removes the store for the given plugin and capability.
func RemoveStore(capability string, storeRoot *appstate.ScopedRoot) error {
	return storeRoot.Remove(capability)
}
