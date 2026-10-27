package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func selectedRepository(t *testing.T, w Workspace, id string) devcontract.Repository {
	t.Helper()
	for _, repository := range w.Manifest.Repositories {
		if repository.ID == id {
			return repository
		}
	}
	t.Fatalf("repository %q is not selected", id)
	return devcontract.Repository{}
}

func TestRepositoryAddRemovePreservesMappingsAndReferencedResources(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	before, err := LoadRegistry(root)
	require.NoError(t, err)
	source := fixtureRepo(t, t.TempDir(), "provider-source", "provider-plugin")
	spec := SourceSpec{ID: "provider", Path: source, Directory: "custom-provider"}
	reg, err := AddRepository(ctx, root, spec)
	require.NoError(t, err)
	require.Equal(t, before.Repositories, reg.Repositories[:len(before.Repositories)])
	_, err = AddRepository(ctx, root, spec)
	require.Error(t, err)
	unchanged, err := LoadRegistry(root)
	require.NoError(t, err)
	require.Equal(t, reg, unchanged)

	w, err := m.Create(ctx, CreateOptions{Slug: "registered-provider", Plugins: []string{"provider-plugin"}})
	require.NoError(t, err)
	provider := selectedRepository(t, w, "provider")
	require.Equal(t, "custom-provider", provider.Directory)
	require.NoError(t, os.MkdirAll(w.StateRoot, 0700))
	_, err = RemoveRepository(ctx, root, "provider")
	require.Error(t, err)
	_, err = m.Edit(ctx, w.Manifest.WorkspaceID, EditOptions{RemovePlugins: []string{"provider-plugin"}, RemoveRepositories: []string{"provider"}})
	require.NoError(t, err)
	_, err = RemoveRepository(ctx, root, "provider")
	require.Error(t, err, "retained resources must keep their source mapping")
	require.Equal(t, provider.BaseCommit, fixtureGit(t, source, "rev-parse", provider.Branch))
	_, err = m.Remove(ctx, w.Manifest.WorkspaceID, RemoveOptions{})
	require.NoError(t, err)
	reg, err = RemoveRepository(ctx, root, "provider")
	require.NoError(t, err)
	require.Equal(t, before, reg)
	require.DirExists(t, source)
	require.Equal(t, provider.BaseCommit, fixtureGit(t, source, "rev-parse", provider.Branch))
	require.DirExists(t, w.StateRoot)
	_, err = RemoveRepository(ctx, root, "omniview")
	require.Error(t, err)
}

func TestEditResolvesPluginIdentityFromSelectedAndRetainedCommits(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	source := fixtureRepo(t, t.TempDir(), "not-the-plugin-id", "committed-plugin")
	_, err := AddRepository(ctx, root, SourceSpec{ID: "provider", Path: source})
	require.NoError(t, err)
	w, err := m.Create(ctx, CreateOptions{Slug: "metadata-selection", Repositories: []string{"provider"}})
	require.NoError(t, err)
	original := selectedRepository(t, w, "provider")
	require.NoError(t, os.WriteFile(filepath.Join(source, "plugin.yaml"), []byte("id: newer-plugin\n"), 0600))
	fixtureGit(t, source, "add", "plugin.yaml")
	fixtureGit(t, source, "commit", "-m", "change plugin identity")
	require.NoError(t, os.WriteFile(filepath.Join(source, "plugin.yaml"), []byte("id: dirty-plugin\n"), 0600))

	w, err = m.Edit(ctx, w.Manifest.WorkspaceID, EditOptions{AddPlugins: []string{"committed-plugin"}})
	require.NoError(t, err)
	require.Equal(t, "provider", w.Manifest.Plugins[0].RepositoryID)
	require.Equal(t, original.BaseCommit, selectedRepository(t, w, "provider").BaseCommit)
	w, err = m.Edit(ctx, w.Manifest.WorkspaceID, EditOptions{RemovePlugins: []string{"committed-plugin"}, RemoveRepositories: []string{"provider"}})
	require.NoError(t, err)
	w, err = m.Edit(ctx, w.Manifest.WorkspaceID, EditOptions{AddPlugins: []string{"committed-plugin"}})
	require.NoError(t, err)
	require.Equal(t, original.BaseCommit, selectedRepository(t, w, "provider").BaseCommit)
	require.Equal(t, original.BaseRef, selectedRepository(t, w, "provider").BaseRef)
	w, err = m.Edit(ctx, w.Manifest.WorkspaceID, EditOptions{RemovePlugins: []string{"committed-plugin"}, AddPlugins: []string{"newer-plugin"}, Refs: map[string]string{"provider": "main"}})
	require.NoError(t, err)
	require.Equal(t, "newer-plugin", w.Manifest.Plugins[0].ID)
	require.Equal(t, fixtureGit(t, source, "rev-parse", "HEAD"), selectedRepository(t, w, "provider").BaseCommit)
	data, err := os.ReadFile(filepath.Join(source, "plugin.yaml"))
	require.NoError(t, err)
	require.Equal(t, "id: dirty-plugin\n", string(data))
}

func TestRemoteTrackingSelectionFetchesBeforeResolvingAndPinsDoNotFetch(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	remote := fixtureRepo(t, t.TempDir(), "upstream", "remote-plugin")
	clone := filepath.Join(t.TempDir(), "source")
	fixtureGit(t, root, "clone", remote, clone)
	initial := fixtureGit(t, clone, "rev-parse", "HEAD")
	fixtureGit(t, remote, "commit", "--allow-empty", "-m", "advance before registration")
	registered := fixtureGit(t, remote, "rev-parse", "HEAD")
	_, err := AddRepository(ctx, root, SourceSpec{ID: "remote-provider", Path: clone, DefaultRef: "origin/main"})
	require.NoError(t, err)
	require.Equal(t, registered, fixtureGit(t, clone, "rev-parse", "origin/main"))
	fixtureGit(t, remote, "commit", "--allow-empty", "-m", "advance before selection")
	latest := fixtureGit(t, remote, "rev-parse", "HEAD")
	w, err := m.Create(ctx, CreateOptions{Slug: "tracking-selection", Plugins: []string{"remote-plugin"}, Refs: map[string]string{"remote-provider": "origin/main"}})
	require.NoError(t, err)
	selected := selectedRepository(t, w, "remote-provider")
	require.Equal(t, "origin/main", selected.BaseRef)
	require.Equal(t, latest, selected.BaseCommit)
	require.Equal(t, initial, fixtureGit(t, clone, "rev-parse", "HEAD"), "fetch must not move the source checkout")

	fixtureGit(t, clone, "remote", "set-url", "origin", filepath.Join(t.TempDir(), "unavailable"))
	w, err = m.Create(ctx, CreateOptions{Slug: "pinned-selection", Repositories: []string{"remote-provider"}, Refs: map[string]string{"remote-provider": initial}})
	require.NoError(t, err)
	selected = selectedRepository(t, w, "remote-provider")
	require.Equal(t, initial, selected.BaseRef)
	require.Equal(t, initial, selected.BaseCommit)
}

func TestRepositoryRemovalRefusesDirtyWorkspaceWithoutChangingRegistry(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "keep-dirty-provider", Repositories: []string{"ui"}})
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(w.StateRoot, 0700))
	path := filepath.Join(w.Root, "ui", "private-note")
	require.NoError(t, os.WriteFile(path, []byte("keep"), 0600))
	before, err := LoadRegistry(root)
	require.NoError(t, err)
	_, err = RemoveRepository(ctx, root, "ui")
	require.Error(t, err)
	_, err = m.Remove(ctx, w.Manifest.WorkspaceID, RemoveOptions{})
	require.Error(t, err)
	require.FileExists(t, path)
	require.DirExists(t, w.StateRoot)
	after, err := LoadRegistry(root)
	require.NoError(t, err)
	require.Equal(t, before, after)
}

func TestPinnedRefClassification(t *testing.T) {
	require.True(t, IsPinnedRef("abcdef0"))
	require.True(t, IsPinnedRef("0123456789012345678901234567890123456789"))
	require.False(t, IsPinnedRef("origin/main"))
	require.False(t, IsPinnedRef("refs/remotes/origin/main"))
	require.False(t, IsPinnedRef("main"))
	require.False(t, IsPinnedRef("HEAD~1"))
}
