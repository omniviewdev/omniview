package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func upstreamFixture(t *testing.T) (*Manager, Workspace, string, string) {
	t.Helper()
	ctx := context.Background()
	m, root := fixtureManager(t)
	remote := fixtureRepo(t, t.TempDir(), "remote", "")
	source := filepath.Join(root, "omniview")
	fixtureGit(t, source, "remote", "add", "origin", remote)
	w, err := m.Create(ctx, CreateOptions{Slug: "upstream", Refs: map[string]string{"omniview": "origin/main"}})
	require.NoError(t, err)
	return m, w, remote, source
}

func upstreamCommit(t *testing.T, path, name, contents string) string {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(path, name), []byte(contents), 0600))
	fixtureGit(t, path, "add", "--", name)
	fixtureGit(t, path, "commit", "-m", name)
	return fixtureGit(t, path, "rev-parse", "HEAD")
}

func TestUpstreamCheckFetchesRemoteWithoutChangingCanonicalOrOwnedHEAD(t *testing.T) {
	m, w, remote, source := upstreamFixture(t)
	canonical := fixtureGit(t, source, "rev-parse", "HEAD")
	target := upstreamCommit(t, remote, "component.ts", "export const value = 2")
	plan, err := m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{})
	require.NoError(t, err)
	require.Equal(t, "update_available", plan.Result)
	require.Len(t, plan.Repositories, 1)
	require.Equal(t, "behind", plan.Repositories[0].Classification)
	require.Equal(t, target, plan.Repositories[0].TargetSHA)
	require.False(t, plan.DependencyChanged)
	require.Equal(t, canonical, fixtureGit(t, source, "rev-parse", "HEAD"))
	require.Equal(t, w.Manifest.Repositories[0].BaseCommit,
		fixtureGit(t, filepath.Join(w.Root, w.Manifest.Repositories[0].Directory), "rev-parse", "HEAD"))
}

func TestUpstreamAncestryAndTreeEquality(t *testing.T) {
	for _, kind := range []string{"current", "ahead", "divergent", "equal-divergent"} {
		t.Run(kind, func(t *testing.T) {
			m, w, remote, _ := upstreamFixture(t)
			checkout := filepath.Join(w.Root, w.Manifest.Repositories[0].Directory)
			if kind != "current" {
				upstreamCommit(t, checkout, "local.txt", "same tree\n")
			}
			if kind == "divergent" {
				upstreamCommit(t, remote, "remote.txt", "different\n")
			}
			if kind == "equal-divergent" {
				fixtureGit(t, remote, "-c", "user.name=Other", "-c", "user.email=other@example.invalid",
					"commit", "--allow-empty", "-m", "different parent")
				upstreamCommit(t, remote, "local.txt", "same tree\n")
			}
			before := fixtureGit(t, checkout, "rev-parse", "HEAD")
			plan, err := m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{})
			require.NoError(t, err)
			expected := kind
			if kind == "equal-divergent" {
				expected = "divergent"
			}
			require.Equal(t, expected, plan.Repositories[0].Classification)
			require.Equal(t, kind == "current" || kind == "equal-divergent", plan.Repositories[0].TreesEqual)
			if kind != "current" {
				require.Equal(t, "blocked", plan.Result)
			}
			require.Equal(t, before, fixtureGit(t, checkout, "rev-parse", "HEAD"))
		})
	}
}

func TestUpstreamReportsAllDirtyPathsAndPreservesIndex(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	checkout := filepath.Join(w.Root, w.Manifest.Repositories[0].Directory)
	require.NoError(t, os.WriteFile(filepath.Join(checkout, "README"), []byte("staged"), 0600))
	fixtureGit(t, checkout, "add", "README")
	require.NoError(t, os.WriteFile(filepath.Join(checkout, "README"), []byte("unstaged"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(checkout, "untracked"), []byte("mine"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(checkout, ".gitignore"), []byte("ignored\n"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(checkout, "ignored"), []byte("private"), 0600))
	upstreamCommit(t, remote, "remote.txt", "new")
	before := fixtureGit(t, checkout, "diff", "--cached")
	plan, err := m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{})
	require.NoError(t, err)
	require.Equal(t, "blocked", plan.Result)
	require.ElementsMatch(t, []string{"README", "untracked", "ignored", ".gitignore"}, plan.Repositories[0].BlockerPaths)
	require.Equal(t, before, fixtureGit(t, checkout, "diff", "--cached"))
}

func TestUpstreamDependencyInputsAndMissingBranch(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	upstreamCommit(t, remote, "package.json", `{"name":"fixture","packageManager":"pnpm@12.14.0"}`)
	plan, err := m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{})
	require.NoError(t, err)
	require.True(t, plan.DependencyChanged)
	require.NotEmpty(t, plan.CompositionFingerprint)
	fixtureGit(t, remote, "branch", "-m", "gone")
	plan, err = m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{})
	require.NoError(t, err)
	require.Equal(t, "blocked", plan.Result)
	require.Empty(t, plan.Repositories[0].TargetSHA)
}

func TestUpstreamMigrationNeverGuessesPlainBranches(t *testing.T) {
	source := fixtureRepo(t, t.TempDir(), "source", "")
	ctx := context.Background()
	fixtureGit(t, source, "remote", "add", "origin", source)
	fixtureGit(t, source, "remote", "add", "other", source)
	for _, ref := range []string{"main", "refs/heads/main", "unknown/main"} {
		upstream, err := ResolveRepositoryUpstream(ctx, source, devcontract.Repository{BaseRef: ref})
		require.NoError(t, err)
		require.Nil(t, upstream)
	}
	for _, ref := range []string{"origin/main", "refs/remotes/origin/main"} {
		upstream, err := ResolveRepositoryUpstream(ctx, source, devcontract.Repository{BaseRef: ref})
		require.NoError(t, err)
		require.Equal(t, &devcontract.RepositoryUpstream{Remote: "origin", Branch: "refs/heads/main"}, upstream)
	}
}

func TestUpstreamPinsAndUnconfiguredSelection(t *testing.T) {
	m, w, _, source := upstreamFixture(t)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	for _, ref := range []string{"main", w.Manifest.Repositories[0].BaseCommit, "refs/tags/release"} {
		if ref == "refs/tags/release" {
			fixtureGit(t, source, "tag", "release", w.Manifest.Repositories[0].BaseCommit)
		}
		repository := w.Manifest.Repositories[0]
		repository.BaseRef = ref
		repository.Upstream = nil // Model a legacy selection without explicit policy.
		p := m.planRepository(context.Background(), w, j.Resources[0], repository, nil)
		if ref == "main" {
			require.Equal(t, "upstream_not_configured", p.BlockedReason)
		} else {
			require.Equal(t, "pinned", p.Classification)
		}
	}
}

func TestUpstreamSchemaRejectsUnsafeRefs(t *testing.T) {
	for _, upstream := range []devcontract.RepositoryUpstream{
		{Remote: "-option", Branch: "refs/heads/main"},
		{Remote: "origin", Branch: "main"},
		{Remote: "origin", Branch: "refs/heads/a..b"},
		{Remote: "origin", Branch: "refs/heads/a.lock"},
		{Remote: "origin", Branch: "refs/heads/"},
	} {
		require.Error(t, upstream.Validate())
	}
	require.NoError(t, (devcontract.RepositoryUpstream{Remote: "origin", Branch: "refs/heads/feature/next"}).Validate())
}

func TestUpstreamTargetPluginIdentityCannotChange(t *testing.T) {
	m, w, remote, _ := upstreamFixture(t)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	w.Manifest.Plugins = []devcontract.Plugin{{ID: "expected", RepositoryID: "omniview", Mode: "managed"}}
	upstreamCommit(t, remote, "plugin.yaml", "id: replacement\n")
	p := m.planRepository(context.Background(), w, j.Resources[0], w.Manifest.Repositories[0], nil)
	require.Equal(t, "plugin_identity_changed", p.BlockedReason)
	require.Contains(t, p.BlockerPaths, "plugin.yaml")
}

func TestUpstreamCheckRejectsUnknownCohortBeforeFetch(t *testing.T) {
	m, w, remote, source := upstreamFixture(t)
	target := upstreamCommit(t, remote, "new.txt", "new")
	before := fixtureGit(t, source, "rev-parse", "refs/remotes/origin/main")
	_, err := m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{Repositories: []string{"missing"}})
	require.Error(t, err)
	require.NotEqual(t, target, before)
	require.Equal(t, before, fixtureGit(t, source, "rev-parse", "refs/remotes/origin/main"))
}

func TestUpstreamDirtyParserPreservesWhitespaceAndRenamePaths(t *testing.T) {
	m, w, _, _ := upstreamFixture(t)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	checkout := j.Resources[0].Path
	fixtureGit(t, checkout, "mv", "README", " renamed file ")
	require.NoError(t, os.WriteFile(filepath.Join(checkout, " untracked\nfile "), []byte("private"), 0600))
	paths, err := upstreamDirtyPaths(context.Background(), j.Resources[0], nil)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"README", " renamed file ", " untracked\nfile "}, paths)
	require.NotEmpty(t, m.Root)
}

func TestUpstreamDirtyExemptionNeverHidesStagedOverlay(t *testing.T) {
	_, w, _, _ := upstreamFixture(t)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	checkout := j.Resources[0].Path
	path := filepath.Join(checkout, "README")
	require.NoError(t, os.WriteFile(path, []byte("managed overlay"), 0600))
	paths, err := upstreamDirtyPaths(context.Background(), j.Resources[0], map[string]string{path: "validated"})
	require.NoError(t, err)
	require.Empty(t, paths)
	fixtureGit(t, checkout, "add", "README")
	paths, err = upstreamDirtyPaths(context.Background(), j.Resources[0], map[string]string{path: "validated"})
	require.NoError(t, err)
	require.Equal(t, []string{"README"}, paths)
}

func TestUpstreamOwnedPublicationDeletionKeepsAuthoredDeletionsVisible(t *testing.T) {
	_, w, _, _ := upstreamFixture(t)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	checkout := j.Resources[0].Path
	dist := filepath.Join(checkout, "dist")
	require.NoError(t, os.MkdirAll(dist, 0700))
	placeholder := filepath.Join(dist, ".gitkeep")
	require.NoError(t, os.WriteFile(placeholder, nil, 0600))
	fixtureGit(t, checkout, "add", "dist/.gitkeep")
	fixtureGit(t, checkout, "commit", "-m", "tracked publication placeholder")
	// A publisher replaces the tracked placeholder with generated distribution bytes.
	require.NoError(t, os.Remove(placeholder))
	require.NoError(t, os.WriteFile(filepath.Join(dist, "index.js"), []byte("export const published = true;\n"), 0600))
	owned := map[string]string{dist: "owned_output"}
	paths, err := upstreamDirtyPaths(context.Background(), j.Resources[0], owned)
	require.NoError(t, err)
	require.Empty(t, paths)
	paths, err = upstreamDirtyPaths(context.Background(), j.Resources[0], nil)
	require.NoError(t, err)
	require.Contains(t, paths, "dist/.gitkeep")
	fixtureGit(t, checkout, "add", "-u", "--", "dist/.gitkeep")
	paths, err = upstreamDirtyPaths(context.Background(), j.Resources[0], owned)
	require.NoError(t, err)
	require.Equal(t, []string{"dist/.gitkeep"}, paths)
	// Missing managed overlays are not rebuildable output deletions.
	require.NoError(t, os.Remove(filepath.Join(checkout, "README")))
	owned[filepath.Join(checkout, "README")] = "validated"
	paths, err = upstreamDirtyPaths(context.Background(), j.Resources[0], owned)
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"README", "dist/.gitkeep"}, paths)
}

func TestUpstreamCompositionFingerprintRespectsWorkspaceLocks(t *testing.T) {
	source := fixtureRepo(t, t.TempDir(), "source", "")
	ctx := context.Background()
	first, err := upstreamDependencyFingerprint(ctx, source, fixtureGit(t, source, "rev-parse", "HEAD"))
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(source, "member"), 0700))
	commit := upstreamCommit(t, source, "member/pnpm-lock.yaml", "obsolete")
	next, err := upstreamDependencyFingerprint(ctx, source, commit)
	require.NoError(t, err)
	require.Equal(t, first, next)
	commit = upstreamCommit(t, source, "member/pnpm-workspace.yaml", "packages: []")
	next, err = upstreamDependencyFingerprint(ctx, source, commit)
	require.NoError(t, err)
	require.NotEqual(t, first, next)
	before := next
	commit = upstreamCommit(t, source, "member/pnpm-lock.yaml", "authoritative change")
	next, err = upstreamDependencyFingerprint(ctx, source, commit)
	require.NoError(t, err)
	require.NotEqual(t, before, next)
}

func TestUpstreamCurrentCheckDoesNotRewriteWorkspaceMetadata(t *testing.T) {
	m, w, _, _ := upstreamFixture(t)
	manifest, err := os.ReadFile(w.ManifestPath)
	require.NoError(t, err)
	journalPath := filepath.Join(w.Root, ".local", "ownership.json")
	journal, err := os.ReadFile(journalPath)
	require.NoError(t, err)
	plan, err := m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{})
	require.NoError(t, err)
	require.Equal(t, "up_to_date", plan.Result)
	after, err := os.ReadFile(w.ManifestPath)
	require.NoError(t, err)
	require.Equal(t, manifest, after)
	after, err = os.ReadFile(journalPath)
	require.NoError(t, err)
	require.Equal(t, journal, after)
	require.NoFileExists(t, filepath.Join(w.Root, ".local", "refresh.json"))
}

func TestLegacyPlainBranchOffersExplicitChoicesWithoutChoosingRemote(t *testing.T) {
	m, w, remote, source := upstreamFixture(t)
	fixtureGit(t, source, "remote", "add", "alternative", remote)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	j.Manifest.Repositories[0].BaseRef = "main"
	j.Manifest.Repositories[0].Upstream = nil
	j.Resources[0].Repository = j.Manifest.Repositories[0]
	require.NoError(t, writeManifest(w.Root, j.Manifest))
	require.NoError(t, saveJournal(w.Root, j))
	plan, err := m.PlanUpdate(context.Background(), w.Manifest.Slug, UpdateOptions{})
	require.NoError(t, err)
	require.Equal(t, "blocked", plan.Result)
	require.Empty(t, plan.Repositories[0].Remote)
	require.Len(t, plan.Repositories[0].ConfigurationChoices, 2)
	for _, choice := range plan.Repositories[0].ConfigurationChoices {
		require.Contains(t, choice.NextArgv, "--upstream")
		require.Contains(t, choice.NextCommand, shellArgument(m.Root))
	}
}
