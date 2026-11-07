package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/stretchr/testify/require"
)

func TestApplyingResetPreservesIntentAndDeletesOnlySelectedModules(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	j.Phase = "applying"
	require.NoError(t, saveLinkJournal(j))
	foreign := filepath.Join(f.host, "node_modules", "foreign.js")
	require.NoError(t, os.MkdirAll(filepath.Dir(foreign), 0700))
	require.NoError(t, os.WriteFile(foreign, []byte("unmanaged"), 0600))
	keep := filepath.Join(f.w.StateRoot, "keep")
	require.NoError(t, os.MkdirAll(f.w.StateRoot, 0700))
	require.NoError(t, os.WriteFile(keep, []byte("state"), 0600))
	report, err := f.m.ResetModules(ctx, f.w.Manifest.Slug)
	require.NoError(t, err)
	require.Equal(t, "applying", report.Phase)
	require.False(t, report.Reinstalled)
	require.NoFileExists(t, foreign)
	require.FileExists(t, keep)
	require.Equal(t, 1, f.installs)
	j, err = loadLinkJournal(f.w)
	require.NoError(t, err)
	require.Equal(t, "applying", j.Phase)
	require.NoError(t, installComposition(ctx, f.w.ResolvedWorkspace, j, f.run))
}

func TestRenameLinkAdmissionRejectsChangedAggregateBeforeTeardown(t *testing.T) {
	f := newResetModulesFixture(t)
	path := filepath.Join(f.w.Root, "package.json")
	require.NoError(t, os.WriteFile(path, []byte("changed"), 0600))
	_, err := renameOwnedRootPaths(context.Background(), f.w)
	require.Error(t, err)
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "changed", string(raw))
	require.FileExists(t, filepath.Join(f.w.Root, ".local", "links.json"))
}

func TestRenameLinkTeardownRemovesAbsoluteRootJournal(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	paths, err := renameOwnedRootPaths(ctx, f.w)
	require.NoError(t, err)
	require.Contains(t, paths, filepath.Join(f.w.Root, "package.json"))
	require.NoError(t, teardownRenameLinks(ctx, f.w))
	require.NoFileExists(t, filepath.Join(f.w.Root, "package.json"))
	require.NoFileExists(t, filepath.Join(f.w.Root, ".local", "links.json"))
	require.NoError(t, teardownRenameLinks(ctx, f.w))
}

func TestLinkedRenamePreservesWorkspaceIdentity(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	options := LaunchOptions{Mode: "browser", Watch: true, LinkEvidence: j.Evidence}
	require.NoError(t, saveLaunchJSON(launchPath(f.w, "launch.json"), options))
	slug := "renamed-linked"
	after, err := f.m.Edit(ctx, f.w.Manifest.Slug, EditOptions{Slug: &slug})
	require.NoError(t, err)
	require.Equal(t, f.w.Manifest.WorkspaceID, after.Manifest.WorkspaceID)
	require.Equal(t, f.w.StateRoot, after.StateRoot)
	require.Equal(t, f.w.Manifest.Repositories, after.Manifest.Repositories)
	require.NoDirExists(t, f.w.Root)
	require.NoFileExists(t, filepath.Join(after.Root, ".local", "links.json"))
	saved, err := LoadLaunchOptions(after)
	require.NoError(t, err)
	require.Equal(t, options, saved)
	require.NoError(t, ValidateGenerated(ctx, after))
	f.m.afterDurablePhase = func(kind, phase string) error {
		require.Equal(t, "refresh", kind)
		require.Equal(t, refreshStop, phase)
		return errPhaseInterrupted
	}
	_, err = f.m.Refresh(ctx, after.Manifest.WorkspaceID, RefreshOptions{})
	require.ErrorIs(t, err, errPhaseInterrupted)
}

func TestLinkedRenameRefusesUnknownMetadataAndRootNeighbors(t *testing.T) {
	for _, relative := range []string{".local/unknown", "foreign.txt"} {
		t.Run(relative, func(t *testing.T) {
			f := newResetModulesFixture(t)
			path := filepath.Join(f.w.Root, relative)
			require.NoError(t, os.WriteFile(path, []byte("keep"), 0600))
			slug := "not-moved"
			_, err := f.m.Edit(context.Background(), f.w.Manifest.Slug, EditOptions{Slug: &slug})
			require.Error(t, err)
			require.FileExists(t, path)
			require.FileExists(t, filepath.Join(f.w.Root, ".local", "links.json"))
			require.FileExists(t, filepath.Join(f.w.Root, "package.json"))
		})
	}
}

func TestLinkedRenameRefusesRedirectedLinkJournal(t *testing.T) {
	f := newResetModulesFixture(t)
	path := filepath.Join(f.w.Root, ".local", "links.json")
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	outside := filepath.Join(t.TempDir(), "links.json")
	require.NoError(t, os.WriteFile(outside, raw, 0600))
	require.NoError(t, os.Remove(path))
	require.NoError(t, os.Symlink(outside, path))
	slug := "not-moved"
	_, err = f.m.Edit(context.Background(), f.w.Manifest.Slug, EditOptions{Slug: &slug})
	require.Error(t, err)
	retained, err := os.ReadFile(outside)
	require.NoError(t, err)
	require.Equal(t, raw, retained)
	require.FileExists(t, filepath.Join(f.w.Root, "package.json"))
}

func TestLinkedRenameResumesRestoredLinkFiles(t *testing.T) {
	ctx := context.Background()
	f := newResetModulesFixture(t)
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	j.Phase = "unlinking"
	require.NoError(t, saveLinkJournal(j))
	require.NoError(t, restoreLinkFiles(f.w.Root, j))
	require.NoError(t, teardownRenameLinks(ctx, f.w))
	require.NoError(t, teardownRenameLinks(ctx, f.w))
	require.NoFileExists(t, filepath.Join(f.w.Root, ".local", "links.json"))
}

func TestLinkedRenameRefusesChangedLinkJournalIdentity(t *testing.T) {
	f := newResetModulesFixture(t)
	path := filepath.Join(f.w.Root, ".local", "links.json")
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	j.WorkspaceID = "foreign"
	require.NoError(t, saveLinkJournal(j))
	before, err := os.ReadFile(path)
	require.NoError(t, err)
	slug := "not-moved"
	_, err = f.m.Edit(context.Background(), f.w.Manifest.Slug, EditOptions{Slug: &slug})
	require.Error(t, err)
	after, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, before, after)
	require.FileExists(t, filepath.Join(f.w.Root, "package.json"))
}

func TestApplyingModulesConflictGivesRetainedOrderedRecovery(t *testing.T) {
	f := newResetModulesFixture(t)
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	j.Phase = "applying"
	require.NoError(t, saveLinkJournal(j))
	require.NoError(t, saveLaunchJSON(launchPath(f.w, "launch.json"), LaunchOptions{
		Mode: "browser", LinkEvidence: j.Evidence,
	}))
	payload := workspaceOwnershipError(&devoutputs.Conflict{
		Producer: "modules", Target: filepath.Join(f.host, "node_modules"),
		Ownership: "unowned", Phase: "installation",
	}, f.w)
	conflict := payload.Details["ownershipConflict"].(*devoutputs.Conflict)
	executable, err := os.Executable()
	require.NoError(t, err)
	require.Equal(t, "applying", conflict.LifecyclePhase)
	require.Equal(t, [][]string{
		{executable, "workspace", "ownership", "--workspace", f.w.ManifestPath, "--json"},
		{executable, "workspace", "down", "--workspace", f.w.ManifestPath},
		{executable, "workspace", "reset-modules", "--workspace", f.w.ManifestPath},
		{executable, "workspace", "restart", "--workspace", f.w.ManifestPath},
	}, conflict.NextCommands)
}

func TestLinkedRenameRefusesUnfinishedInstallerBeforeMutation(t *testing.T) {
	f := newResetModulesFixture(t)
	j, err := loadLinkJournal(f.w)
	require.NoError(t, err)
	_, err = devoutputs.BeginCompositionInstall(context.Background(), f.w.ResolvedWorkspace, *j.Plan.Composition)
	require.NoError(t, err)
	slug := "not-moved"
	_, err = f.m.Edit(context.Background(), f.w.Manifest.Slug, EditOptions{Slug: &slug})
	require.Error(t, err)
	require.DirExists(t, f.w.Root)
	require.FileExists(t, filepath.Join(f.w.Root, "package.json"))
	require.FileExists(t, filepath.Join(f.w.Root, ".local", "links.json"))
}

func TestRenameLaunchRestorationResumesAfterMove(t *testing.T) {
	for _, restored := range []bool{false, true} {
		t.Run(map[bool]string{false: "before-launch-publication", true: "after-launch-publication"}[restored], func(t *testing.T) {
			ctx := context.Background()
			m, root := fixtureManager(t)
			w, err := m.Create(ctx, CreateOptions{Slug: "launch-before"})
			require.NoError(t, err)
			_, _, accepted := recoveryFixture(t)
			options := LaunchOptions{Mode: "browser", LinkEvidence: accepted.Evidence}
			require.NoError(t, saveLaunchJSON(launchPath(w, "launch.json"), options))
			j, err := loadJournal(w.Root)
			require.NoError(t, err)
			j.Phase, j.Manifest.Slug, j.RenameLaunch = "rename", "launch-after", &options
			j.RenameTo = filepath.Join(root, "workspaces", j.Manifest.Slug)
			require.NoError(t, saveJournal(w.Root, j))
			require.NoError(t, CleanGenerated(w))
			require.NoError(t, os.Rename(w.Root, j.RenameTo))
			if restored {
				require.NoError(t, writeManifest(j.RenameTo, j.Manifest))
				require.NoError(t, saveLaunchJSON(filepath.Join(j.RenameTo, ".local", "launch.json"), options))
			}
			after, err := m.Resume(ctx, "launch-after")
			require.NoError(t, err)
			saved, err := LoadLaunchOptions(after)
			require.NoError(t, err)
			require.Equal(t, options, saved)
			require.NoError(t, ValidateGenerated(ctx, after))
			final, err := loadJournal(after.Root)
			require.NoError(t, err)
			require.Nil(t, final.RenameLaunch)
		})
	}
}

func TestRenamePublicationInterruptedBeforeLedger(t *testing.T) {
	for _, foreign := range []bool{false, true} {
		t.Run(map[bool]string{false: "resume", true: "foreign"}[foreign], func(t *testing.T) {
			ctx := context.Background()
			m, root := fixtureManager(t)
			w, err := m.Create(ctx, CreateOptions{Slug: "publication-before"})
			require.NoError(t, err)
			_, _, accepted := recoveryFixture(t)
			options := LaunchOptions{Mode: "browser", LinkEvidence: accepted.Evidence}
			data, err := json.Marshal(options)
			require.NoError(t, err)
			data = append(data, '\n')
			j, err := loadJournal(w.Root)
			require.NoError(t, err)
			j.Phase, j.Manifest.Slug, j.RenameLaunch = "rename", "publication-after", &options
			j.RenameTo = filepath.Join(root, "workspaces", j.Manifest.Slug)
			j.RenameFiles = map[string][]byte{"launch.json": data}
			require.NoError(t, saveJournal(w.Root, j))
			require.NoError(t, os.Rename(w.Root, j.RenameTo))
			require.NoError(t, writeManifest(j.RenameTo, j.Manifest))
			interrupted := errors.New("interrupted after publication")
			require.ErrorIs(t, restoreRenameFile(j.RenameTo, "launch.json", data, func() error { return interrupted }), interrupted)
			if foreign {
				require.NoError(t, os.WriteFile(filepath.Join(j.RenameTo, ".local", "launch.json"), []byte("foreign"), 0600))
			}
			after, err := m.Resume(ctx, "publication-after")
			if foreign {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.NoError(t, ValidateGenerated(ctx, after))
		})
	}
}

func TestSeededRenameRetainsReceiptAndDisclosure(t *testing.T) {
	ctx := context.Background()
	m, _ := fixtureManager(t)
	w, err := m.Create(ctx, CreateOptions{Slug: "seed-before"})
	require.NoError(t, err)
	_, _, accepted := recoveryFixture(t)
	source, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	options := LaunchOptions{Mode: "browser", LinkEvidence: accepted.Evidence, BaselineSource: source}
	require.NoError(t, saveLaunchJSON(launchPath(w, "launch.json"), options))
	s := &workspaceSupervisor{workspace: w, manager: m, options: options, generation: NewGeneration()}
	err = s.seed(ctx)
	require.NoError(t, err, "seed error: %#v", err)
	receipt, err := os.ReadFile(filepath.Join(w.StateRoot, "baseline.json"))
	require.NoError(t, err)
	slug := "seed-after"
	after, err := m.Edit(ctx, w.Manifest.Slug, EditOptions{Slug: &slug})
	require.NoError(t, err)
	s.workspace = after
	require.NoError(t, s.seed(ctx))
	retained, err := os.ReadFile(filepath.Join(after.StateRoot, "baseline.json"))
	require.NoError(t, err)
	require.Equal(t, receipt, retained)
	require.FileExists(t, launchPath(after, "baseline-seeded.json"))
	require.FileExists(t, launchPath(after, "baseline-intent.json"))
	require.NoError(t, ValidateGenerated(ctx, after))
}
