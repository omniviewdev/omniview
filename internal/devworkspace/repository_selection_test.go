package devworkspace

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
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

func TestPluginDiscoveryDoesNotFetchUnselectedRemote(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	remote := fixtureRepo(t, t.TempDir(), "offline-upstream", "unselected-plugin")
	clone := filepath.Join(t.TempDir(), "clone")
	fixtureGit(t, root, "clone", remote, clone)
	_, err := AddRepository(ctx, root, SourceSpec{ID: "offline", Path: clone, DefaultRef: "origin/main"})
	require.NoError(t, err)
	fixtureGit(t, clone, "remote", "set-url", "origin", filepath.Join(t.TempDir(), "unreachable"))
	source := fixtureRepo(t, t.TempDir(), "selected", "selected-plugin")
	_, err = AddRepository(ctx, root, SourceSpec{ID: "selected", Path: source})
	require.NoError(t, err)
	w, err := m.Create(ctx, CreateOptions{Slug: "offline-discovery", Plugins: []string{"selected-plugin"}})
	require.NoError(t, err)
	require.Equal(t, "selected", w.Manifest.Plugins[0].RepositoryID)
}

func TestPluginSelectionRevalidatesFetchedIdentity(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	remote := fixtureRepo(t, t.TempDir(), "changing-upstream", "old-plugin")
	clone := filepath.Join(t.TempDir(), "clone")
	fixtureGit(t, root, "clone", remote, clone)
	_, err := AddRepository(ctx, root, SourceSpec{ID: "changing", Path: clone, DefaultRef: "origin/main"})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(remote, "plugin.yaml"), []byte("id: new-plugin\n"), 0600))
	fixtureGit(t, remote, "add", "plugin.yaml")
	fixtureGit(t, remote, "commit", "-m", "change identity")
	_, err = m.Create(ctx, CreateOptions{Slug: "changed-identity", Plugins: []string{"old-plugin"}})
	require.ErrorContains(t, err, "changed committed plugin identity")
}

func TestSelectedFetchUsesGlobalCredentialHelperOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test helper uses POSIX shell")
	}
	ctx := context.Background()
	remote := fixtureRepo(t, t.TempDir(), "authenticated", "")
	bare := filepath.Join(t.TempDir(), "remote.git")
	fixtureGit(t, remote, "clone", "--bare", remote, bare)
	fixtureGit(t, bare, "update-server-info")
	var authenticated atomic.Bool
	files := http.FileServer(http.Dir(bare))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != "fixture-user" || password != "fixture-secret" {
			w.Header().Set("WWW-Authenticate", `Basic realm="fixture"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		authenticated.Store(true)
		files.ServeHTTP(w, r)
	}))
	defer server.Close()
	clone := filepath.Join(t.TempDir(), "clone")
	fixtureGit(t, remote, "clone", remote, clone)
	fixtureGit(t, clone, "remote", "set-url", "origin", server.URL)
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	config := "[credential]\n\thelper = \"!f() { echo username=fixture-user; echo password=fixture-secret; }; f\"\n[fetch]\n\toutput = invalid-global-setting\n"
	require.NoError(t, os.WriteFile(filepath.Join(home, ".gitconfig"), []byte(config), 0600))
	commit, err := resolveSelectedCommit(ctx, filepath.Join(clone, ".git"), "origin/main")
	require.NoError(t, err)
	require.Equal(t, fixtureGit(t, remote, "rev-parse", "HEAD"), commit)
	require.True(t, authenticated.Load())
	_, err = git(ctx, clone, "", "config", "--get", "credential.helper")
	require.Error(t, err, "ordinary Git operations must not read global helpers")
	fixtureGit(t, clone, "remote", "set-url", "origin", "https://private-user:private-secret@127.0.0.1:1/repo")
	_, err = resolveSelectedCommit(ctx, filepath.Join(clone, ".git"), "origin/main")
	require.Error(t, err)
	require.False(t, strings.Contains(err.Error(), "private-secret"))
	require.False(t, strings.Contains(err.Error(), "private-user"))
}

func TestPluginDiscoveryReportsMissingSourcePath(t *testing.T) {
	m, root := fixtureManager(t)
	reg, err := LoadRegistry(root)
	require.NoError(t, err)
	reg.Repositories = append(reg.Repositories, Source{ID: "missing", CommonDir: filepath.Join(t.TempDir(), "missing"), DefaultRef: "main", Directory: "missing"})
	_, err = m.plan(context.Background(), reg, CreateOptions{Slug: "missing-source", Plugins: []string{"unknown"}})
	require.Error(t, err)
	require.ErrorContains(t, err, reg.Repositories[len(reg.Repositories)-1].CommonDir)
}
