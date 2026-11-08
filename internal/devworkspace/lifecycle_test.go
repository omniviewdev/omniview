package devworkspace

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
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

type fixtureRepoFile struct {
	path string
	mode os.FileMode
	data []byte
}

var fixtureRepoSeeds = struct {
	sync.Mutex
	files map[string][]fixtureRepoFile
}{files: make(map[string][]fixtureRepoFile)}

func fixtureRepo(t *testing.T, root, name, plugin string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	require.NoError(t, os.MkdirAll(dir, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "README"), []byte("initial\n"), 0600))
	if plugin != "" {
		require.NoError(t, os.WriteFile(filepath.Join(dir, "plugin.yaml"), []byte("id: "+plugin+"\nname: Fixture\nversion: 1.0.0\n"), 0600))
	}
	return fixtureSeedRepository(t, dir, "repository:"+plugin)
}

// fixtureSeedRepository is only for the fixed initial trees in fixtureRepo and
// graphFixture. Mutations and every operation under test still use real Git.
func fixtureSeedRepository(t *testing.T, dir, key string) string {
	t.Helper()
	// Copy immutable seed bytes, not shared repositories or worktrees. Every
	// fixture keeps independent refs, index, config, objects and file identities.
	fixtureRepoSeeds.Lock()
	if files, ok := fixtureRepoSeeds.files[key]; ok {
		fixtureRepoSeeds.Unlock()
		for _, file := range files {
			path := filepath.Join(dir, file.path)
			require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
			require.NoError(t, os.WriteFile(path, file.data, file.mode))
		}
		return dir
	}
	defer fixtureRepoSeeds.Unlock()
	fixtureGit(t, dir, "init", "--template=", "-b", "main")
	fixtureGit(t, dir, "add", ".")
	fixtureGit(t, dir, "commit", "-m", "initial")
	// Pack the immutable seed once. Copying a few pack files avoids creating
	// and deleting dozens of loose-object directories for every graph case.
	fixtureGit(t, dir, "-c", "pack.writeReverseIndex=false", "repack", "-ad", "--no-write-bitmap-index")
	var files []fixtureRepoFile
	// Callers already wrote their source trees. Copy only Git's immutable seed
	// metadata, not those same working files a second time.
	require.NoError(t, filepath.WalkDir(filepath.Join(dir, ".git"), func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			// Normal fixture mutations create their own reflogs.
			if filepath.ToSlash(relative) == ".git/logs" {
				return filepath.SkipDir
			}
			return nil
		}
		if filepath.ToSlash(relative) == ".git/COMMIT_EDITMSG" {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files = append(files, fixtureRepoFile{relative, info.Mode().Perm(), data})
		return nil
	}))
	fixtureRepoSeeds.files[key] = files
	return dir
}

func fixtureManager(t *testing.T, repositories ...string) (*Manager, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "sources with spaces")
	require.NoError(t, os.MkdirAll(root, 0700))
	if len(repositories) == 0 {
		repositories = []string{"omniview", "plugin-sdk", "kubernetes", "ui"}
	}
	selected := map[string]bool{"omniview": true}
	for _, id := range repositories {
		selected[id] = true
	}
	// Lifecycle cases start with a registered collection. Init/discovery have
	// dedicated tests; do not rediscover every source twice for each fixture.
	root, err := filepath.EvalSymlinks(root)
	require.NoError(t, err)
	registry := Registry{SchemaVersion: 1}
	for _, source := range []struct{ id, directory string }{
		{"omniview", "omniview"}, {"plugin-sdk", "plugin-sdk"}, {"kubernetes", "omniview-plugin-kubernetes"},
	} {
		if !selected[source.id] {
			continue
		}
		plugin := ""
		if source.id == "kubernetes" {
			plugin = "kubernetes"
		}
		fixtureRepo(t, root, source.directory, plugin)
		worktree := filepath.Join(root, source.directory)
		registry.Repositories = append(registry.Repositories, Source{ID: source.id, CommonDir: filepath.Join(worktree, ".git"), Worktree: worktree, DefaultRef: "main", Directory: source.directory})
	}
	if selected["ui"] {
		seed := fixtureRepo(t, t.TempDir(), "ui-seed", "")
		bare := filepath.Join(root, "ui", ".bare")
		require.NoError(t, os.MkdirAll(filepath.Dir(bare), 0700))
		fixtureGit(t, root, "clone", "--bare", seed, bare)
		fixtureGit(t, bare, "worktree", "add", filepath.Join(root, "ui", "main"), "main")
		registry.Repositories = append(registry.Repositories, Source{ID: "ui", CommonDir: bare, Worktree: filepath.Join(root, "ui", "main"), DefaultRef: "main", Directory: "ui"})
	}
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".omniview-dev"), 0700))
	fixtureJSON(t, filepath.Join(root, ".omniview-dev", "repositories.json"), registry)
	home, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	m := &Manager{Root: root, options: Options{Home: home, Stopped: func(context.Context, devcontract.ResolvedWorkspace) error { return nil }}}
	return m, root
}

// fixtureJSON writes initial fixture data, not a mutation under test.
func fixtureJSON(t *testing.T, path string, value any) {
	t.Helper()
	data, err := json.MarshalIndent(value, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
	require.NoError(t, os.WriteFile(path, append(data, '\n'), 0600))
}

// fixtureWorkspace prepares a completed workspace for non-creation scenarios.
// Real Git owns independent branches, markers and worktree administrative paths.
// Creation/publication recovery tests continue to exercise Manager.Create.
func fixtureWorkspace(t *testing.T, m *Manager, options CreateOptions) Workspace {
	t.Helper()
	ctx := context.Background()
	raw, err := os.ReadFile(filepath.Join(m.Root, ".omniview-dev", "repositories.json"))
	require.NoError(t, err)
	var registry Registry
	require.NoError(t, json.Unmarshal(raw, &registry))
	manifest, err := m.plan(ctx, registry, options)
	require.NoError(t, err)
	root := filepath.Join(m.Root, "workspaces", manifest.Slug)
	require.NoError(t, os.MkdirAll(root, 0700))
	j := newJournal(root, manifest, registry)
	for index := range j.Resources {
		resource := &j.Resources[index]
		transaction := fmt.Sprintf("start\ncreate refs/heads/%s %s\ncreate %s %s\nprepare\ncommit\n",
			resource.Repository.Branch, resource.Repository.BaseCommit, resource.Marker, resource.Repository.BaseCommit)
		_, err := git(ctx, resource.CommonDir, transaction, "update-ref", "--stdin")
		require.NoError(t, err)
		_, err = git(ctx, resource.CommonDir, "", "-c", "core.hooksPath="+os.DevNull, "worktree", "add", "--", resource.Path, resource.Repository.Branch)
		require.NoError(t, err)
		// Git just wrote this private worktree's administrative pointer.
		pointer, err := os.ReadFile(filepath.Join(resource.Path, ".git"))
		require.NoError(t, err)
		directory, valid := strings.CutPrefix(strings.TrimSuffix(string(pointer), "\n"), "gitdir: ")
		require.True(t, valid, "worktree has no Git administrative pointer")
		if !filepath.IsAbs(directory) {
			directory = filepath.Join(resource.Path, directory)
		}
		resource.GitDir, err = filepath.EvalSymlinks(directory)
		require.NoError(t, err)
	}
	fixtureJSON(t, filepath.Join(root, "workspace.json"), manifest)
	resolved, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: root, Home: m.options.Home})
	require.NoError(t, err)
	require.NoError(t, m.ensureProfileOwner(resolved))
	require.NoError(t, m.captureProfileBinding(resolved, j))
	j.Phase = "complete"
	fixtureJSON(t, filepath.Join(root, ".local", "ownership.json"), j)
	w := Workspace{ResolvedWorkspace: resolved, Phase: j.Phase}
	w.Metadata = OwnershipMetadataPaths(w)
	return w
}

func TestCreateIndependentFeaturesWithBareUIAndPluginMetadata(t *testing.T) {
	t.Parallel()
	m, root := fixtureManager(t)
	ctx := context.Background()
	// This case owns automatic discovery coverage; other lifecycle fixtures
	// start from a registered collection rather than repeating Init.
	require.NoError(t, os.Remove(filepath.Join(root, ".omniview-dev", "repositories.json")))
	_, err := Init(ctx, InitOptions{Root: root})
	require.NoError(t, err)
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
	t.Parallel()
	m, root := fixtureManager(t, "omniview")
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
	t.Parallel()
	m, _ := fixtureManager(t, "ui")
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
	t.Parallel()
	m, root := fixtureManager(t, "omniview")
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
	t.Parallel()
	m, root := fixtureManager(t, "ui", "kubernetes")
	ctx := context.Background()
	a := fixtureWorkspace(t, m, CreateOptions{Slug: "editable"})
	var err error
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
	t.Parallel()
	for _, kind := range []string{"dirty", "foreign", "running"} {
		t.Run(kind, func(t *testing.T) {
			m, _ := fixtureManager(t, "omniview")
			ctx := context.Background()
			a := fixtureWorkspace(t, m, CreateOptions{Slug: "protected"})
			var err error
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
	t.Parallel()
	m, _ := fixtureManager(t, "omniview")
	ctx := context.Background()
	for _, purge := range []bool{false, true} {
		slug := "retain"
		if purge {
			slug = "purge"
		}
		a := fixtureWorkspace(t, m, CreateOptions{Slug: slug})
		var err error
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
	t.Parallel()
	m, _ := fixtureManager(t, "omniview")
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
	t.Parallel()
	m, _ := fixtureManager(t, "ui")
	ctx := context.Background()
	before := fixtureWorkspace(t, m, CreateOptions{Slug: "before", Repositories: []string{"ui"}})
	var err error
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
	t.Parallel()
	m, root := fixtureManager(t, "omniview")
	ctx := context.Background()
	fixtureWorkspace(t, m, CreateOptions{Slug: "guarded"})
	var err error
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
	t.Parallel()
	m, root := fixtureManager(t, "omniview")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "ref-resume"})
	var err error
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
	t.Parallel()
	m, root := fixtureManager(t, "ui")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "old-name", Repositories: []string{"ui"}})
	var err error
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
	t.Parallel()
	m, root := fixtureManager(t, "ui")
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
	t.Parallel()
	m, root := fixtureManager(t, "ui")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "reselect", Repositories: []string{"ui"}})
	var err error
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
