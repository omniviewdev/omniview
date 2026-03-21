// This file contains general helpers for interacting with a slice of local store
package store

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/appstate"
)

// getStoreFile opens (or creates) a store file relative to the given ScopedRoot.
func getStoreFile(root *appstate.ScopedRoot, store string) (*os.File, error) {
	// Ensure parent directories exist within the scope.
	dir := filepath.Dir(store)
	if dir != "." && dir != "" {
		if err := root.MkdirAll(dir, 0755); err != nil {
			return nil, err
		}
	}
	return root.OpenFile(store, os.O_RDWR|os.O_CREATE, 0644)
}

// ExpandTilde takes a path and if it starts with a ~, it will replace it with the home directory.
func ExpandTilde(path string) (string, error) {
	if len(path) >= 2 && path[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %w", err)
		}
		path = filepath.Join(home, path[2:])
	}
	return path, nil
}

// DeexpandTilde takes a path and if it is in the home directory, it will replace it with a ~.
func DeexpandTilde(path string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		// fallback to the original path
		return path
	}
	if home != "" {
		path = filepath.Join("~", path[len(home):])
	}
	return path
}
