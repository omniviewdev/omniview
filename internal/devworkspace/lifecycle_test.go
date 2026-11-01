package devworkspace

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofrs/flock"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func fixtureGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull, "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid", "GIT_TERMINAL_PROMPT=0", "GOWORK=off")
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "%s", out)
	return strings.TrimSpace(string(out))
}

func fixtureRepo(t *testing.T, root, name, plugin string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	require.NoError(t, os.MkdirAll(dir, 0700))
	fixtureGit(t, dir, "init", "-b", "main")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "README"), []byte("initial\n"), 0600))
	if plugin != "" {
		require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte("id: "+plugin+"\nname: Fixture\nversion: 1.0.0\n"), 0600))
	}
	fixtureGit(t, dir, "add", ".")
	fixtureGit(t, dir, "commit", "-m", "initial")
	return dir
}

func fixtureManager(t *testing.T) (*Manager, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "sources with spaces")
	require.NoError(t, os.MkdirAll(root, 0700))
	fixtureRepo(t, root, "omniview", "")
	fixtureRepo(t, root, "plugin-sdk", "")
	fixtureRepo(t, root, "omniview-plugin-kubernetes", "kubernetes")
	seed := fixtureRepo(t, t.TempDir(), "ui-seed", "")
	bare := filepath.Join(root, "ui", ".bare")
	require.NoError(t, os.MkdirAll(filepath.Dir(bare), 0700))
	fixtureGit(t, root, "clone", "--bare", seed, bare)
	fixtureGit(t, bare, "worktree", "add", filepath.Join(root, "ui", "main"), "main")
	_, err := Init(context.Background(), InitOptions{Root: root})
	require.NoError(t, err)
	m, err := Open(root, Options{Home: t.TempDir(), Stopped: func(context.Context, devcontract.ResolvedWorkspace) error { return nil }})
	require.NoError(t, err)
	return m, m.Root
}

func TestCreateIndependentFeaturesWithBareUIAndPluginMetadata(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	a, err := m.Create(ctx, CreateOptions{Slug: "feature-a", Repositories: []string{"plugin-sdk", "ui"}, Plugins: []string{"kubernetes"}})
	require.NoError(t, err)
	b, err := m.Create(ctx, CreateOptions{Slug: "feature-b", Repositories: []string{"ui"}, Plugins: []string{"kubernetes"}})
	require.NoError(t, err)
	require.NotEqual(t, a.Manifest.WorkspaceID, b.Manifest.WorkspaceID)
	require.Len(t, a.Manifest.Repositories, 4)
	require.Equal(t, "kubernetes", a.Manifest.Plugins[0].ID)
	paths, err := m.Paths(ctx, "feature-a")
	require.NoError(t, err)
	require.Equal(t, filepath.Join(root, "workspaces", "feature-a", "ui"), paths.Repositories["ui"])
	require.Equal(t, "main", fixtureGit(t, filepath.Join(root, "omniview"), "branch", "--show-current"))
	before := fixtureGit(t, filepath.Join(b.Root, "omniview"), "rev-parse", "HEAD")
	_, err = m.Remove(ctx, "feature-a", RemoveOptions{})
	require.NoError(t, err)
	require.Equal(t, before, fixtureGit(t, filepath.Join(b.Root, "omniview"), "rev-parse", "HEAD"))
	require.Equal(t, a.Manifest.Repositories[0].BaseCommit, fixtureGit(t, filepath.Join(root, "omniview"), "rev-parse", a.Manifest.Repositories[0].Branch))
	items, err := m.List(ctx)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "feature-b", items[0].Manifest.Slug)
}

func TestRegistryRejectsDuplicatesAndDoesNotChooseHistoricalBareClone(t *testing.T) {
	m, root := fixtureManager(t)
	fixtureGit(t, root, "clone", "--bare", filepath.Join(root, "omniview"), filepath.Join(root, "omniview.git"))
	reg, err := LoadRegistry(context.Background(), root)
	require.NoError(t, err)
	require.Equal(t, filepath.Join(root, "omniview", ".git"), reg.Repositories[0].CommonDir)
	_, err = Init(context.Background(), InitOptions{Root: root, Sources: []SourceSpec{{ID: "omniview", Path: filepath.Join(root, "omniview")}, {ID: "other", Path: filepath.Join(root, "omniview.git")}}})
	require.Error(t, err)
	_, err = m.Create(context.Background(), CreateOptions{Slug: "bad-plugin", Plugins: []string{"not-a-plugin"}})
	require.Error(t, err)
	_, err = os.Stat(filepath.Join(root, "workspaces", "bad-plugin"))
	require.True(t, os.IsNotExist(err))
}

func TestInterruptedCreateResumesOwnedWorktreesAndRollbackPreservesForeign(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	_, err := m.Create(cancelled, CreateOptions{Slug: "cancelled"})
	require.Error(t, err)
	// An interrupted create has a durable intent before any Git changes. Build
	// that state directly rather than timing a process kill against a fast Git.
	reg, err := LoadRegistry(ctx, m.Root)
	require.NoError(t, err)
	manifest, err := m.plan(ctx, reg, CreateOptions{Slug: "interrupted", Repositories: []string{"ui"}})
	require.NoError(t, err)
	dir := filepath.Join(m.Root, "workspaces", "interrupted")
	j := newJournal(dir, manifest, reg)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, ".local"), 0700))
	require.NoError(t, saveJournal(dir, j))
	require.NoError(t, writeManifest(dir, manifest))
	require.NoError(t, m.addWorktree(ctx, dir, j, &j.Resources[0]))
	resumed, err := m.Resume(ctx, "interrupted")
	require.NoError(t, err)
	require.Equal(t, manifest.WorkspaceID, resumed.Manifest.WorkspaceID)
	require.Len(t, resumed.Manifest.Repositories, 2)
	_, err = m.Create(ctx, CreateOptions{Slug: "interrupted"})
	require.Error(t, err, "existing workspace must require explicit resume")

	manifest, err = m.plan(ctx, reg, CreateOptions{Slug: "rollback"})
	require.NoError(t, err)
	dir = filepath.Join(m.Root, "workspaces", "rollback")
	j = newJournal(dir, manifest, reg)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, ".local"), 0700))
	require.NoError(t, saveJournal(dir, j))
	require.NoError(t, writeManifest(dir, manifest))
	require.NoError(t, m.addWorktree(ctx, dir, j, &j.Resources[0]))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "foreign-note"), []byte("keep"), 0600))
	err = m.Rollback(ctx, "rollback")
	require.Error(t, err)
	require.FileExists(t, filepath.Join(dir, "foreign-note"))
}

func TestOccupiedBranchIsNeverAttached(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	reg, err := LoadRegistry(ctx, root)
	require.NoError(t, err)
	manifest, err := m.plan(ctx, reg, CreateOptions{Slug: "occupied"})
	require.NoError(t, err)
	branch := manifest.Repositories[0].Branch
	fixtureGit(t, filepath.Join(root, "omniview"), "worktree", "add", "-b", branch, filepath.Join(t.TempDir(), "occupied"), "main")
	dir := filepath.Join(root, "workspaces", "occupied")
	j := newJournal(dir, manifest, reg)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, ".local"), 0700))
	require.NoError(t, saveJournal(dir, j))
	require.NoError(t, writeManifest(dir, manifest))
	_, err = m.Resume(ctx, "occupied")
	require.Error(t, err)
	require.NoDirExists(t, filepath.Join(dir, "omniview"))
	require.NoError(t, m.Rollback(ctx, "occupied"))
	require.NoDirExists(t, dir)
	require.Equal(t, manifest.Repositories[0].BaseCommit, fixtureGit(t, filepath.Join(root, "omniview"), "rev-parse", branch))
}

func TestEditPreservesIdentityAndRejectsDirtyRefAndCommitLoss(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	a, err := m.Create(ctx, CreateOptions{Slug: "editable"})
	require.NoError(t, err)
	name := "Renamed display"
	b, err := m.Edit(ctx, "editable", EditOptions{DisplayName: &name, AddRepositories: []string{"ui"}, AddPlugins: []string{"kubernetes"}})
	require.NoError(t, err)
	require.Equal(t, a.Manifest.WorkspaceID, b.Manifest.WorkspaceID)
	require.Equal(t, name, b.Manifest.DisplayName)
	fixtureGit(t, filepath.Join(root, "omniview"), "commit", "--allow-empty", "-m", "next")
	worktree := filepath.Join(a.Root, "omniview")
	require.NoError(t, os.WriteFile(filepath.Join(worktree, "dirty"), []byte("keep"), 0600))
	_, err = m.Edit(ctx, "editable", EditOptions{Refs: map[string]string{"omniview": "main"}})
	require.Error(t, err)
	require.NoError(t, os.Remove(filepath.Join(worktree, "dirty")))
	b, err = m.Edit(ctx, "editable", EditOptions{Refs: map[string]string{"omniview": "main"}})
	require.NoError(t, err)
	require.Equal(t, fixtureGit(t, filepath.Join(root, "omniview"), "rev-parse", "HEAD"), fixtureGit(t, worktree, "rev-parse", "HEAD"))
	fixtureGit(t, worktree, "commit", "--allow-empty", "-m", "user feature commit")
	_, err = m.Edit(ctx, "editable", EditOptions{Refs: map[string]string{"omniview": "HEAD~1"}})
	require.Error(t, err)
	_, err = m.Remove(ctx, "editable", RemoveOptions{DeleteBranches: true})
	require.Error(t, err, "explicit branch deletion cannot discard user commits")
	_, err = m.Remove(ctx, "editable", RemoveOptions{})
	require.NoError(t, err, "default removal retains user commits on feature branch")
}

func TestDirtyForeignAndRunningWorktreesCannotBeRemoved(t *testing.T) {
	for _, kind := range []string{"dirty", "foreign", "running"} {
		t.Run(kind, func(t *testing.T) {
			m, _ := fixtureManager(t)
			ctx := context.Background()
			a, err := m.Create(ctx, CreateOptions{Slug: "protected"})
			require.NoError(t, err)
			path := filepath.Join(a.Root, "omniview")
			switch kind {
			case "dirty":
				require.NoError(t, os.WriteFile(filepath.Join(path, "untracked"), []byte("keep"), 0600))
			case "foreign":
				fixtureGit(t, path, "checkout", "--detach")
			case "running":
				require.NoError(t, os.MkdirAll(a.StateRoot, 0700))
				lock := flock.New(filepath.Join(a.StateRoot, ".lock"))
				require.NoError(t, lock.Lock())
				t.Cleanup(func() { _ = lock.Unlock() })
			}
			_, err = m.Remove(ctx, "protected", RemoveOptions{})
			require.Error(t, err)
			require.DirExists(t, path)
		})
	}
}

func TestStateRetainedUnlessExplicitOwnedPurge(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	for _, purge := range []bool{false, true} {
		slug := "retain"
		if purge {
			slug = "purge"
		}
		a, err := m.Create(ctx, CreateOptions{Slug: slug})
		require.NoError(t, err)
		require.NoError(t, os.MkdirAll(a.StateRoot, 0700))
		require.NoError(t, os.WriteFile(filepath.Join(a.StateRoot, "sentinel"), []byte("state"), 0600))
		result, err := m.Remove(ctx, slug, RemoveOptions{PurgeState: purge, DeleteBranches: true})
		require.NoError(t, err)
		require.Equal(t, !purge, result.StateRetained)
		if purge {
			require.NoDirExists(t, filepath.Dir(a.StateRoot))
		} else {
			require.FileExists(t, filepath.Join(a.StateRoot, "sentinel"))
		}
	}
}

func TestManifestIsPortableAndOwnershipCannotBeForgedByChangingManifest(t *testing.T) {
	m, _ := fixtureManager(t)
	a, err := m.Create(context.Background(), CreateOptions{Slug: "portable"})
	require.NoError(t, err)
	data, err := os.ReadFile(a.ManifestPath)
	require.NoError(t, err)
	require.NotContains(t, string(data), m.Root)
	var changed devcontract.WorkspaceManifest
	require.NoError(t, json.Unmarshal(data, &changed))
	changed.Repositories[0].Branch = "main"
	require.NoError(t, writeManifest(a.Root, changed))
	_, err = m.Remove(context.Background(), "portable", RemoveOptions{})
	require.Error(t, err)
	require.DirExists(t, filepath.Join(a.Root, "omniview"))
}

func TestSlugRenameMovesGitWorktreesWithoutChangingProfileOrBranches(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	before, err := m.Create(ctx, CreateOptions{Slug: "before", Repositories: []string{"ui"}})
	require.NoError(t, err)
	slug := "after"
	after, err := m.Edit(ctx, "before", EditOptions{Slug: &slug})
	require.NoError(t, err)
	require.Equal(t, before.Manifest.WorkspaceID, after.Manifest.WorkspaceID)
	require.Equal(t, before.StateRoot, after.StateRoot)
	require.Equal(t, "after", after.Manifest.Slug)
	require.NoDirExists(t, before.Root)
	for _, r := range after.Manifest.Repositories {
		require.Equal(t, r.Branch, fixtureGit(t, filepath.Join(after.Root, r.Directory), "branch", "--show-current"))
	}
	_, err = m.Inspect(ctx, "before")
	require.Error(t, err)
	_, err = m.Remove(ctx, "after", RemoveOptions{})
	require.NoError(t, err)
}

func TestMissingStoppedGuardFailsClosedAndSameOriginSourcesAreAmbiguous(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	_, err := m.Create(ctx, CreateOptions{Slug: "guarded"})
	require.NoError(t, err)
	unguarded, err := Open(root, Options{Home: m.options.Home})
	require.NoError(t, err)
	_, err = unguarded.Remove(ctx, "guarded", RemoveOptions{})
	require.Error(t, err)
	require.DirExists(t, filepath.Join(root, "workspaces", "guarded", "omniview"))
	duplicateRoot := t.TempDir()
	host := fixtureRepo(t, duplicateRoot, "host", "")
	other := fixtureRepo(t, duplicateRoot, "other", "")
	fixtureGit(t, host, "remote", "add", "origin", "https://secret@example.invalid/team/repo.git")
	fixtureGit(t, other, "remote", "add", "origin", "https://different@example.invalid/team/repo.git")
	_, err = Init(ctx, InitOptions{Root: duplicateRoot, Sources: []SourceSpec{{ID: "omniview", Path: host}, {ID: "other", Path: other}}})
	require.Error(t, err)
	require.NotContains(t, err.Error(), "secret")
}

func TestInterruptedRefTransitionResumesAfterMarkerAdvance(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "ref-resume"})
	require.NoError(t, err)
	fixtureGit(t, filepath.Join(root, "omniview"), "commit", "--allow-empty", "-m", "advance source")
	target := fixtureGit(t, filepath.Join(root, "omniview"), "rev-parse", "HEAD")
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	j.Phase = "edit"
	j.Manifest.Repositories[0].BaseCommit = target
	j.Resources[0].RefTarget = target
	require.NoError(t, saveJournal(w.Root, j))
	fixtureGit(t, filepath.Join(w.Root, "omniview"), "merge", "--ff-only", target)
	fixtureGit(t, filepath.Join(root, "omniview"), "update-ref", j.Resources[0].Marker, target)
	resumed, err := m.Resume(ctx, "ref-resume")
	require.NoError(t, err)
	require.Equal(t, "complete", resumed.Phase)
	require.Equal(t, target, resumed.Manifest.Repositories[0].BaseCommit)
}

func TestInterruptedRenameRepairsMovedWorktreesOnResume(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "old-name", Repositories: []string{"ui"}})
	require.NoError(t, err)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	j.Phase, j.Manifest.Slug = "rename", "new-name"
	j.RenameTo = filepath.Join(root, "workspaces", "new-name")
	require.NoError(t, saveJournal(w.Root, j))
	require.NoError(t, os.Rename(w.Root, j.RenameTo))
	resumed, err := m.Resume(ctx, "new-name")
	require.NoError(t, err)
	require.Equal(t, w.Manifest.WorkspaceID, resumed.Manifest.WorkspaceID)
	require.Equal(t, "complete", resumed.Phase)
	_, err = m.Remove(ctx, "new-name", RemoveOptions{})
	require.NoError(t, err)
}

func TestCleanPartialCreationRollbackDeletesOnlyOwnedUnmodifiedResources(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	reg, err := LoadRegistry(ctx, root)
	require.NoError(t, err)
	manifest, err := m.plan(ctx, reg, CreateOptions{Slug: "rollback-clean", Repositories: []string{"ui"}})
	require.NoError(t, err)
	dir := filepath.Join(root, "workspaces", "rollback-clean")
	j := newJournal(dir, manifest, reg)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, ".local"), 0700))
	require.NoError(t, saveJournal(dir, j))
	require.NoError(t, m.addWorktree(ctx, dir, j, &j.Resources[0]))
	require.NoError(t, m.Rollback(ctx, "rollback-clean"))
	require.NoDirExists(t, dir)
	branch := fixtureGit(t, filepath.Join(root, "omniview"), "branch", "--list", manifest.Repositories[0].Branch)
	require.Empty(t, branch)
	require.Equal(t, "main", fixtureGit(t, filepath.Join(root, "omniview"), "branch", "--show-current"))
}

func TestRetiredSourceCanBeReselectedWithItsOriginalBranchAndCommits(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "reselect", Repositories: []string{"ui"}})
	require.NoError(t, err)
	ui := filepath.Join(w.Root, "ui")
	fixtureGit(t, ui, "commit", "--allow-empty", "-m", "preserved feature commit")
	tip := fixtureGit(t, ui, "rev-parse", "HEAD")
	branch := fixtureGit(t, ui, "branch", "--show-current")
	_, err = m.Edit(ctx, "reselect", EditOptions{RemoveRepositories: []string{"ui"}})
	require.NoError(t, err)
	slug := "reselected"
	_, err = m.Edit(ctx, "reselect", EditOptions{Slug: &slug})
	require.NoError(t, err)
	w, err = m.Edit(ctx, "reselected", EditOptions{AddRepositories: []string{"ui"}})
	require.NoError(t, err)
	ui = filepath.Join(root, "workspaces", "reselected", "ui")
	require.Equal(t, tip, fixtureGit(t, ui, "rev-parse", "HEAD"))
	require.Equal(t, branch, fixtureGit(t, ui, "branch", "--show-current"))
	for _, r := range w.Manifest.Repositories {
		if r.ID == "ui" {
			require.Equal(t, branch, r.Branch)
		}
	}
}
