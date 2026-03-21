package utils

import (
	"os"

	"github.com/omniviewdev/omniview/internal/appstate"
)

// InitializePluginStore creates the store directory for the given plugin.
func InitializePluginStore(storeRoot *appstate.ScopedRoot) error {
	return storeRoot.MkdirAll(".", 0700)
}

// GetStore returns a file handle to the store for the given plugin and capability.
// If the store does not exist, it will be created.
// Make sure to close the file handle after using it!
func GetStore(capability string, storeRoot *appstate.ScopedRoot) (*os.File, error) {
	if err := InitializePluginStore(storeRoot); err != nil {
		return nil, err
	}

	return storeRoot.OpenFile(capability, os.O_CREATE|os.O_RDWR, 0600)
}

// RemoveStore removes the store for the given plugin and capability.
func RemoveStore(capability string, storeRoot *appstate.ScopedRoot) error {
	return storeRoot.Remove(capability)
}
