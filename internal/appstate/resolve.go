// Package appstate centralises all filesystem state access for the Omniview
// application, providing a single source of truth for the state directory root.
package appstate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// buildStateDir is injected at build time via:
//
//	-X github.com/omniviewdev/omniview/internal/appstate.buildStateDir=<value>
var buildStateDir string //nolint:gochecknoglobals // injected via ldflags

// ResolveRoot determines the application state directory.
// Priority: OMNIVIEW_STATE_DIR env var > buildStateDir ldflags > ~/.omniview.
// Exported for use by secondary binaries (e.g., cmd/omniview-plugin-dev).
func ResolveRoot() (string, error) {
	if dir := os.Getenv("OMNIVIEW_STATE_DIR"); dir != "" {
		return expandAndValidate(dir)
	}
	if buildStateDir != "" {
		return expandAndValidate(buildStateDir)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("appstate: cannot determine home directory: %w", err)
	}
	return filepath.Join(home, ".omniview"), nil
}

// expandAndValidate expands ~ to the user's home directory and ensures the
// resulting path is absolute.
func expandAndValidate(dir string) (string, error) {
	if strings.HasPrefix(dir, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("appstate: cannot expand ~: %w", err)
		}
		dir = filepath.Join(home, dir[2:])
	} else if dir == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("appstate: cannot expand ~: %w", err)
		}
		dir = home
	}
	if !filepath.IsAbs(dir) {
		return "", fmt.Errorf("appstate: state directory must be absolute, got %q", dir)
	}
	return filepath.Clean(dir), nil
}
