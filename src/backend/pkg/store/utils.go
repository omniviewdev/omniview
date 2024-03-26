// This file contains general helpers for interacting with a slice of local store
package store

import (
	"fmt"
	"os"
	"path/filepath"
)

// getBasePath returns the base path for the omniview store.
func getBasePath() string {
	baseDir, err := os.UserHomeDir()
	if err != nil {
		// if we can't get a home directory, we can't continue
		panic("failed to get or create a home directory")
	}
	return filepath.Join(baseDir, ".omniview")
}

func getStoreFile(store string) (*os.File, error) {
	storePath := filepath.Join(getBasePath(), store)
	if _, err := os.Stat(storePath); os.IsNotExist(err) {
		// make sure the parent directory exists
		if err = os.MkdirAll(filepath.Dir(storePath), 0755); err != nil {
			return nil, err
		}
	}
	return os.OpenFile(storePath, os.O_RDWR|os.O_CREATE, 0755)
}

// ExpandTilde takes a path and if it starts with a ~, it will replace it with the home directory.
func ExpandTilde(path string) (string, error) {
	if path[:2] == "~/" {
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
