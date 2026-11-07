package devoutputs

import (
	"fmt"
	"os"
)

// pinDirectory resolves a directory once and retains its filesystem object.
// An expected identity is checked against the opened handle, never a second
// pathname observation. No payload is read while resolving this capability.
func pinDirectory(path, expected string) (*os.File, error) {
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	directory, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	actual, err := directoryHandleIdentity(directory)
	if err != nil || expected != "" && actual != expected {
		directory.Close()
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("output parent identity differs from the selected directory")
	}
	return directory, nil
}
