package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

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
	slug := "renamed-linked"
	after, err := f.m.Edit(ctx, f.w.Manifest.Slug, EditOptions{Slug: &slug})
	require.NoError(t, err)
	require.Equal(t, f.w.Manifest.WorkspaceID, after.Manifest.WorkspaceID)
	require.Equal(t, f.w.StateRoot, after.StateRoot)
	require.Equal(t, f.w.Manifest.Repositories, after.Manifest.Repositories)
	require.NoDirExists(t, f.w.Root)
	require.NoFileExists(t, filepath.Join(after.Root, ".local", "links.json"))
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
