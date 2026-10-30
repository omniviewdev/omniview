package devworkspace

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/stretchr/testify/require"
)

type resetModulesFixture struct {
	m        *Manager
	w        Workspace
	host     string
	installs int
	run      func(context.Context, string, string, ...string) ([]byte, error)
}

// A stopped, linked workspace whose composition was installed through the
// recorded writer by a fake pnpm that writes every selected modules tree.
func newResetModulesFixture(t *testing.T) *resetModulesFixture {
	t.Helper()
	ctx := context.Background()
	m, root := fixtureManager(t)
	// Keep fixture inputs committed so canonical retirement sees no user edits.
	source := filepath.Join(root, "omniview")
	require.NoError(t, os.WriteFile(filepath.Join(source, "package.json"), []byte(`{"name":"fixture","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"19.0.0","react-dom":"19.0.0"}}`), 0600))
	for _, name := range []string{"runtime", "providers", "vite-plugin"} {
		target := filepath.Join(source, "packages", "omniviewdev-"+name, "package.json")
		require.NoError(t, os.MkdirAll(filepath.Dir(target), 0700))
		require.NoError(t, os.WriteFile(target, []byte(`{"name":"@omniviewdev/`+name+`","version":"1.0.0"}`), 0600))
	}
	require.NoError(t, os.WriteFile(filepath.Join(source, "pnpm-workspace.yaml"), []byte("packages:\n  - packages/*\n"), 0600))
	fixtureGit(t, source, "add", "package.json", "pnpm-workspace.yaml", "packages")
	fixtureGit(t, source, "commit", "-m", "dependency fixture inputs")
	w, err := m.Create(ctx, CreateOptions{Slug: "reset-modules"})
	require.NoError(t, err)
	f := &resetModulesFixture{m: m, w: w, host: filepath.Join(w.Root, "omniview")}
	j := compositionJournalFixture(t, w)
	f.run = func(_ context.Context, dir, program string, args ...string) ([]byte, error) {
		require.Equal(t, "pnpm", program)
		if args[0] != "install" {
			return nil, nil
		}
		f.installs++
		roots := []string{dir}
		for _, pkg := range j.Plan.Composition.Packages {
			roots = append(roots, pkg.Path)
		}
		for _, root := range roots {
			require.NoError(t, os.WriteFile(filepath.Join(root, "node_modules", ".modules.yaml"), []byte("installed by recorded writer\n"), 0600))
		}
		return nil, os.WriteFile(filepath.Join(dir, "pnpm-lock.yaml"), []byte("lockfileVersion: '9.0'\n"), 0600)
	}
	require.NoError(t, installComposition(ctx, w.ResolvedWorkspace, j, f.run))
	j.Phase = "linked"
	require.NoError(t, saveLinkJournal(j))
	require.NoError(t, devoutputs.Validate(ctx, w.ResolvedWorkspace))
	return f
}

func (f *resetModulesFixture) outputJournal(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	path := filepath.Join(filepath.Dir(filepath.Dir(f.w.Root)), ".omniview-dev", "repository-outputs", f.w.Manifest.WorkspaceID, "journal.json")
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	var j struct{ Entries map[string]json.RawMessage }
	require.NoError(t, json.Unmarshal(raw, &j))
	return j.Entries
}

func TestResetModulesReinstallsExternallyChangedTreeThroughRecordedWriter(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	aggregate := filepath.Join(f.w.Root, "node_modules")
	foreign := filepath.Join(aggregate, "stray-install.js")
	require.NoError(t, os.WriteFile(foreign, []byte("written by an unrecorded pnpm install"), 0600))
	require.Error(t, devoutputs.Validate(ctx, f.w.ResolvedWorkspace), "foreign bytes in an owned tree must be refused")

	report, err := f.m.resetModules(ctx, f.w.Manifest.Slug, f.run)
	require.NoError(t, err)
	require.True(t, report.Reinstalled)
	require.Contains(t, report.Removed, aggregate)
	require.Equal(t, 2, f.installs)
	require.NoFileExists(t, foreign)
	require.FileExists(t, filepath.Join(aggregate, ".modules.yaml"))
	require.NoError(t, devoutputs.Validate(ctx, f.w.ResolvedWorkspace))
	owned, err := devoutputs.ValidatedOwnedPaths(ctx, f.w.ResolvedWorkspace)
	require.NoError(t, err)
	require.Contains(t, owned, aggregate, "the reinstalled tree is recorded by the composition writer")
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	require.Equal(t, "linked", j.Phase)
	require.NoError(t, checkLinkFiles(f.w.Root, j))
}

func TestResetModulesRemovesUnrecordedSelectedPackageModules(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	runtime := filepath.Join(f.host, "packages", "omniviewdev-runtime", "node_modules")
	require.NoError(t, devoutputs.Restore(ctx, f.w.ResolvedWorkspace), "forget every recorded output")
	require.NoError(t, os.MkdirAll(runtime, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(runtime, "foreign.js"), []byte("standalone install"), 0600))

	report, err := f.m.resetModules(ctx, f.w.Manifest.Slug, f.run)
	require.NoError(t, err)
	require.Contains(t, report.Removed, runtime)
	require.NoFileExists(t, filepath.Join(runtime, "foreign.js"))
	require.FileExists(t, filepath.Join(runtime, ".modules.yaml"))
	require.NoError(t, devoutputs.Validate(ctx, f.w.ResolvedWorkspace))
}

func TestResetModulesDiscardsInterruptedWriterIntent(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	// An installer that never finished leaves live writer intent on every tree.
	_, err = devoutputs.BeginCompositionInstall(ctx, f.w.ResolvedWorkspace, *j.Plan.Composition)
	require.NoError(t, err)
	require.Error(t, devoutputs.Validate(ctx, f.w.ResolvedWorkspace))

	_, err = f.m.resetModules(ctx, f.w.Manifest.Slug, f.run)
	require.NoError(t, err)
	require.NoError(t, devoutputs.Validate(ctx, f.w.ResolvedWorkspace))
}

func TestResetModulesRefusesRedirectedModulesTree(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	require.NoError(t, devoutputs.Restore(ctx, f.w.ResolvedWorkspace), "forget every recorded output")
	outside := t.TempDir()
	kept := filepath.Join(outside, "kept.js")
	require.NoError(t, os.WriteFile(kept, []byte("outside the workspace"), 0600))
	runtime := filepath.Join(f.host, "packages", "omniviewdev-runtime", "node_modules")
	require.NoError(t, os.Symlink(outside, runtime))

	_, err := f.m.resetModules(ctx, f.w.Manifest.Slug, f.run)
	require.ErrorContains(t, err, "symlink")
	require.FileExists(t, kept)
	require.Equal(t, 1, f.installs)
}

func TestResetModulesLeavesPublishedDistributionUntouched(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	stage, err := devoutputs.Prepare(ctx, f.w.ResolvedWorkspace, f.host, devoutputs.Distribution)
	require.NoError(t, err)
	published := []byte("export const published = true\n")
	require.NoError(t, os.WriteFile(filepath.Join(stage.Directory, "index.js"), published, 0600))
	require.NoError(t, devoutputs.Publish(ctx, stage))
	key := filepath.Join(f.host, "dist") + "|" + string(devoutputs.Distribution)
	before := f.outputJournal(t)[key]
	require.NotEmpty(t, before)
	require.NoError(t, os.WriteFile(filepath.Join(f.w.Root, "node_modules", "stray.js"), []byte("foreign"), 0600))

	report, err := f.m.resetModules(ctx, f.w.Manifest.Slug, f.run)
	require.NoError(t, err)
	require.NotContains(t, report.Removed, filepath.Join(f.host, "dist"))
	require.JSONEq(t, string(before), string(f.outputJournal(t)[key]))
	actual, err := os.ReadFile(filepath.Join(f.host, "dist", "index.js"))
	require.NoError(t, err)
	require.Equal(t, published, actual)
	require.NoError(t, devoutputs.Validate(ctx, f.w.ResolvedWorkspace))
}

func TestResetModulesRefusesUnlessStopped(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	foreign := filepath.Join(f.w.Root, "node_modules", "stray.js")
	require.NoError(t, os.WriteFile(foreign, []byte("foreign"), 0600))
	before := f.outputJournal(t)
	f.m.options.Stopped = func(context.Context, devcontract.ResolvedWorkspace) error {
		return devcontract.Fail(4, "workspace_running", "workspace supervisor is running")
	}

	_, err := f.m.resetModules(ctx, f.w.Manifest.Slug, f.run)
	require.ErrorContains(t, err, "running")
	require.Equal(t, 1, f.installs)
	require.FileExists(t, foreign)
	require.Equal(t, before, f.outputJournal(t))
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	require.Equal(t, "linked", j.Phase)
}

func TestResetModulesUnblocksInterruptedUnlinkWithoutReinstall(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	stage, err := devoutputs.Prepare(ctx, f.w.ResolvedWorkspace, f.host, devoutputs.Distribution)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(stage.Directory, "index.js"), []byte("published"), 0600))
	require.NoError(t, devoutputs.Publish(ctx, stage))
	distKey := filepath.Join(f.host, "dist") + "|" + string(devoutputs.Distribution)
	// A manual vitest run leaves an unowned Vite loader cache in an owned tree.
	runtime := filepath.Join(f.host, "packages", "omniviewdev-runtime", "node_modules")
	require.NoError(t, os.Mkdir(filepath.Join(runtime, ".vite-temp"), 0700))
	_, err = f.m.Unlink(ctx, f.w.Manifest.Slug)
	require.ErrorContains(t, err, "owned generated tree changed")
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	require.Equal(t, "unlinking", j.Phase)
	dist := f.outputJournal(t)[distKey]

	report, err := f.m.ResetModules(ctx, f.w.Manifest.Slug)
	require.NoError(t, err)
	require.False(t, report.Reinstalled)
	require.Equal(t, "unlinking", report.Phase)
	require.Contains(t, report.Removed, runtime)
	require.Contains(t, report.Removed, filepath.Join(f.w.Root, "node_modules"))
	require.Equal(t, 1, f.installs, "delete-only mode never reinstalls into a partial overlay")
	require.NoDirExists(t, runtime)
	entries := f.outputJournal(t)
	require.JSONEq(t, string(dist), string(entries[distKey]), "other outputs stay for the resumed unlink")
	for key := range entries {
		require.Equal(t, distKey, key)
	}

	unlinked, err := f.m.Unlink(ctx, f.w.Manifest.Slug)
	require.NoError(t, err)
	require.Equal(t, "unlinked", unlinked.Phase)
	require.NoDirExists(t, filepath.Join(f.host, "dist"))
	_, err = os.Lstat(filepath.Join(f.w.Root, ".local", "links.json"))
	require.True(t, os.IsNotExist(err))
}

func TestResetModulesRetiresCompilerCachesAndPreservesSiblingState(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	sibling, err := f.m.Create(ctx, CreateOptions{Slug: "unrelated-sibling"})
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(sibling.StateRoot, 0700))
	sentinel := filepath.Join(sibling.StateRoot, "keep")
	require.NoError(t, os.WriteFile(sentinel, []byte("sibling state"), 0600))
	stage, err := devoutputs.Prepare(ctx, f.w.ResolvedWorkspace, f.host, devoutputs.Distribution)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(stage.Directory, "index.js"), []byte("published distribution"), 0600))
	require.NoError(t, devoutputs.Publish(ctx, stage))
	runtime := filepath.Join(f.host, "packages", "omniviewdev-runtime", "node_modules")
	cache := filepath.Join(runtime, ".tmp", "tsconfig.app.tsbuildinfo")
	require.NoError(t, os.MkdirAll(filepath.Dir(cache), 0700))
	require.NoError(t, os.WriteFile(cache, []byte(`{"version":"5.9.3"}`), 0600))
	require.Error(t, devoutputs.Validate(ctx, f.w.ResolvedWorkspace))
	_, err = f.m.Unlink(ctx, f.w.Manifest.Slug)
	require.ErrorContains(t, err, "owned generated tree changed")
	journal, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	require.Equal(t, "unlinking", journal.Phase)
	require.FileExists(t, cache, "guarded unlink must not discard changed dependency bytes")
	report, err := f.m.ResetModules(ctx, f.w.Manifest.Slug)
	require.NoError(t, err)
	require.Equal(t, "unlinking", report.Phase)
	require.False(t, report.Reinstalled)
	require.Equal(t, 1, f.installs, "unlink recovery must not run an installer")
	require.Contains(t, report.Removed, runtime)
	require.NoDirExists(t, runtime)
	require.FileExists(t, filepath.Join(f.host, "dist", "index.js"), "dependency reset must leave distributions to canonical unlink")
	require.FileExists(t, sentinel)
	unlinked, err := f.m.Unlink(ctx, f.w.Manifest.Slug)
	require.NoError(t, err)
	require.Equal(t, "unlinked", unlinked.Phase)
	_, err = f.m.RemoveWorkspace(ctx, f.w.Manifest.Slug, RemoveOptions{PurgeState: true, DeleteBranches: true}, io.Discard)
	require.NoError(t, err)
	require.NoDirExists(t, f.w.Root)
	require.DirExists(t, sibling.Root)
	contents, err := os.ReadFile(sentinel)
	require.NoError(t, err)
	require.Equal(t, "sibling state", string(contents))
}
