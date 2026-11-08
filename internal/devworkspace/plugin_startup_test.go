package devworkspace

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func startupWorkspace(t *testing.T, declarations [][2]string) Workspace {
	t.Helper()
	workspace := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: t.TempDir()}}
	for _, declaration := range declarations {
		id, owner := declaration[0], declaration[1]
		path := filepath.Join(workspace.Root, id)
		require.NoError(t, os.MkdirAll(path, 0700))
		metadata := fmt.Sprintf("id: %s\ncapabilities: [resource, tools]\n", id)
		if owner != "" {
			metadata += fmt.Sprintf("requires:\n  connections:\n    - plugin: %s\n      operations: [catalog]\n      resource_types: [example/items]\n", owner)
		}
		require.NoError(t, os.WriteFile(filepath.Join(path, "plugin.yaml"), []byte(metadata), 0600))
		workspace.Manifest.Repositories = append(workspace.Manifest.Repositories, devcontract.Repository{ID: id, Directory: id})
		workspace.Manifest.Plugins = append(workspace.Manifest.Plugins, devcontract.Plugin{ID: id, RepositoryID: id, Mode: "managed"})
	}
	return workspace
}

func TestManagedPluginStartupResolvesTransitiveOwners(t *testing.T) {
	t.Parallel()
	workspace := startupWorkspace(t, [][2]string{{"consumer", "middle"}, {"unrelated", ""}, {"middle", "owner"}, {"owner", ""}})
	ordered, err := managedPluginStartupOrder(&workspace)
	require.NoError(t, err)
	ids := make([]string, len(ordered))
	for index, plugin := range ordered {
		ids[index] = plugin.ID
	}
	require.Equal(t, []string{"owner", "middle", "consumer", "unrelated"}, ids)
}

func TestManagedPluginStartupRejectsCycleBeforeActivation(t *testing.T) {
	t.Parallel()
	workspace := startupWorkspace(t, [][2]string{{"independent", ""}, {"consumer", "owner"}, {"owner", "consumer"}})
	ordered, err := managedPluginStartupOrder(&workspace)
	require.Error(t, err)
	require.Nil(t, ordered, "a cycle must not expose a partially activatable plan")
}

func TestManagedPluginStartupLeavesUnselectedOwnerToHostAdmission(t *testing.T) {
	t.Parallel()
	workspace := startupWorkspace(t, [][2]string{{"consumer", "installed-owner"}})
	ordered, err := managedPluginStartupOrder(&workspace)
	require.NoError(t, err)
	require.Equal(t, []devcontract.Plugin{{ID: "consumer", RepositoryID: "consumer", Mode: "managed"}}, ordered)
}
