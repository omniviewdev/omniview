package devworkspace

import (
	"context"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// ValidateLifecycleContext resolves explicit destructive targets before effects,
// retaining A03 journal/retirement authority when the manifest was already moved.
func (m *Manager) ValidateLifecycleContext(ctx context.Context, name, environmentManifest, stateEnvironment string) (string, error) {
	w, inspectErr := m.Inspect(ctx, name)
	if inspectErr == nil {
		resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: w.ManifestPath, EnvironmentManifest: environmentManifest, StateRoot: stateEnvironment, Home: m.options.Home})
		if err != nil {
			return "", err
		}
		return resolved.Manifest.WorkspaceID, nil
	}
	var j *journal
	if root, err := m.workspaceRoot(name); err == nil {
		if _, err = os.Lstat(filepath.Join(root, "workspace.json")); err == nil {
			return "", inspectErr
		} else if !os.IsNotExist(err) {
			return "", err
		}
		j, err = loadJournal(root)
		if err != nil {
			return "", err
		}
	} else {
		var receiptErr error
		j, receiptErr = m.findRetirement(name)
		if receiptErr != nil {
			return "", inspectErr
		}
	}
	selected := j.SelectedStateRoot
	var err error
	if selected == "" {
		selected, err = m.defaultStateRoot(j.WorkspaceID)
		if err != nil {
			return "", err
		}
	}
	if environmentManifest != "" {
		canonical, err := devcontract.CanonicalPath(environmentManifest)
		if err != nil {
			return "", err
		}
		owned := false
		for _, root := range []string{j.Root, j.StageRoot, j.RenameTo, retiredRoot(j)} {
			if root != "" && canonical == filepath.Join(root, "workspace.json") {
				owned = true
				break
			}
		}
		if !owned {
			resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{EnvironmentManifest: environmentManifest, Home: m.options.Home})
			if err != nil {
				return "", err
			}
			if resolved.Manifest.WorkspaceID != j.WorkspaceID {
				return "", devcontract.Fail(4, "conflicting_target", "environment workspace differs from the explicit lifecycle target")
			}
		}
	}
	if stateEnvironment != "" {
		canonical, err := devcontract.CanonicalPath(stateEnvironment)
		if err != nil {
			return "", err
		}
		if canonical != selected {
			return "", devcontract.Fail(4, "conflicting_target", "environment state differs from the authoritative lifecycle profile")
		}
	}
	return j.WorkspaceID, nil
}
