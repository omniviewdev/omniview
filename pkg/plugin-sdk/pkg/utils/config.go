package utils

import (
	"fmt"
	"os"
	"path/filepath"
)

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
