// Package appstate centralises all filesystem state access for the Omniview
// application, providing a single source of truth for the state directory root.
package appstate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// buildStateDir is injected at build time via:
//
//	-X github.com/omniviewdev/omniview/internal/appstate.buildStateDir=<value>
var buildStateDir string //nolint:gochecknoglobals // injected via ldflags

// SelectedRoot returns the explicit environment/build selection, or an empty
// string. It never supplies the production default to a workspace resolver.
func SelectedRoot() (string, error) {
	if dir := os.Getenv("OMNIVIEW_STATE_DIR"); dir != "" {
		return expandAndValidate(dir)
	}
	if buildStateDir != "" {
		return expandAndValidate(buildStateDir)
	}
	return "", nil
}

// ResolveRoot preserves environment > ldflags > production default outside a
// workspace. Workspace context fails closed and owns its canonical UUID root.
func ResolveRoot() (string, error) {
	root, err := SelectedRoot()
	if err != nil {
		return "", err
	}
	if manifest := os.Getenv(devcontract.WorkspaceEnvironment); manifest != "" {
		workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{EnvironmentManifest: manifest, StateRoot: root})
		if err != nil {
			return "", err
		}
		return workspace.StateRoot, nil
	}
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("appstate: cannot determine home directory: %w", err)
		}
		root = filepath.Join(home, ".omniview")
	}
	return ValidateRoot(root)
}

// ValidateRoot is also applied to WithRoot: programmatic callers cannot bypass
// absolute-path, canonical-alias or selected-workspace ownership validation.
func ValidateRoot(root string) (string, error) {
	root, err := expandAndValidate(root)
	if err != nil {
		return "", err
	}
	root, err = devcontract.CanonicalPath(root)
	if err != nil {
		return "", err
	}
	if manifest := os.Getenv(devcontract.WorkspaceEnvironment); manifest != "" {
		workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{EnvironmentManifest: manifest, StateRoot: root})
		if err != nil {
			return "", err
		}
		return workspace.StateRoot, nil
	}
	return root, nil
}

// expandAndValidate expands ~ to the user's home directory and ensures the
// resulting path is absolute.
func expandAndValidate(dir string) (string, error) {
	if strings.ContainsRune(dir, '\x00') {
		return "", fmt.Errorf("appstate: state directory contains NUL")
	}
	if strings.HasPrefix(dir, "~/") || strings.HasPrefix(dir, `~\`) {
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
