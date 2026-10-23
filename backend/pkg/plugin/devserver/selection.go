package devserver

import (
	"fmt"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// ValidateManagedSource reports whether workspace selection is authoritative and
// rejects an unselected or rebound development source. ConfigureWorkspace is the
// sole source of this policy; persisted plugin state cannot extend the manifest.
func (manager *DevServerManager) ValidateManagedSource(id, source string) (bool, error) {
	manager.mu.RLock()
	workspace := manager.workspace
	manager.mu.RUnlock()
	if workspace == nil {
		return false, nil
	}
	for _, plugin := range workspace.Manifest.Plugins {
		if plugin.ID != id {
			continue
		}
		expected, err := workspace.RepositoryPath(plugin.RepositoryID)
		if err != nil {
			return true, err
		}
		expected, err = devcontract.CanonicalPath(expected)
		if err != nil {
			return true, err
		}
		if source == "" {
			return true, fmt.Errorf("plugin %s has no selected development source; workspace edit/relink required", id)
		}
		actual, err := devcontract.CanonicalPath(source)
		if err != nil {
			return true, err
		}
		if actual != expected {
			return true, fmt.Errorf("plugin %s development source differs from workspace selection %s; workspace edit/relink required", id, expected)
		}
		return true, nil
	}
	return true, fmt.Errorf("development plugin %s is not selected by this workspace; workspace edit required before link or start", id)
}
