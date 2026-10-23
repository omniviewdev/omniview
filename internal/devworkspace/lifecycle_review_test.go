package devworkspace

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func TestAbsentStateStaysAbsentThroughEditAndPartialCreateResume(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "no-state", Baseline: new("offline-source")})
	require.NoError(t, err)
	require.NoDirExists(t, w.StateRoot)
	name := "New display"
	_, err = m.Edit(ctx, "no-state", EditOptions{DisplayName: &name})
	require.NoError(t, err)
	require.NoDirExists(t, w.StateRoot)
	reg, err := LoadRegistry(root)
	require.NoError(t, err)
	manifest, err := m.plan(ctx, reg, CreateOptions{Slug: "stage-resume", Baseline: new("offline-source")})
	require.NoError(t, err)
	stage, j, err := m.prepareCreate(manifest, reg)
	require.NoError(t, err)
	require.NoDirExists(t, j.Root)
	require.FileExists(t, filepath.Join(stage, ".local", "ownership.json"))
	require.NoError(t, os.Remove(filepath.Join(stage, "workspace.json")))
	_, err = m.Create(ctx, CreateOptions{Slug: "stage-resume"})
	require.Error(t, err, "an unpublished durable intent requires resume, not a second UUID")
	require.NoDirExists(t, j.Root)
	resumed, err := m.Resume(ctx, "stage-resume")
	require.NoError(t, err)
	require.Equal(t, manifest.WorkspaceID, resumed.Manifest.WorkspaceID)
	require.NoDirExists(t, stage)
	require.NoDirExists(t, resumed.StateRoot)
}

func TestOwnedPartialWriteRecoveryDoesNotDeleteForeignWriteFiles(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "staged-writes"})
	require.NoError(t, err)
	manifestPending := ownedStagingPath(w.ManifestPath, w.Manifest.WorkspaceID)
	journalPending := ownedStagingPath(filepath.Join(w.Root, ".local", "ownership.json"), w.Manifest.WorkspaceID)
	for _, path := range []string{manifestPending, journalPending} {
		require.NoError(t, os.WriteFile(path, []byte("{partial"), 0600))
	}
	_, err = m.Remove(ctx, "staged-writes", RemoveOptions{})
	require.NoError(t, err)

	w, err = m.Create(ctx, CreateOptions{Slug: "foreign-write"})
	require.NoError(t, err)
	foreign := filepath.Join(w.Root, ".local", ".write-user-data")
	require.NoError(t, os.WriteFile(foreign, []byte("keep"), 0600))
	_, err = m.Remove(ctx, "foreign-write", RemoveOptions{})
	require.Error(t, err)
	require.FileExists(t, foreign)
	require.DirExists(t, filepath.Join(w.Root, "omniview"))
}

func TestRemovalResumesAfterRetiredJournalAndManifestWereUnlinked(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "retired"})
	require.NoError(t, err)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	for i := range j.Resources {
		require.NoError(t, removeWorktree(ctx, &j.Resources[i]))
		j.Resources[i].Removed = true
	}
	j.Phase = "retire"
	require.NoError(t, saveJournal(w.Root, j))
	require.NoError(t, m.saveRetirement(j))
	retired := retiredRoot(j)
	require.NoError(t, os.Rename(w.Root, retired))
	j.Retired = true
	require.NoError(t, m.saveRetirement(j))
	for _, path := range []string{filepath.Join(retired, "workspace.json"), filepath.Join(retired, ".local", "ownership.json"), filepath.Join(retired, ".local")} {
		require.NoError(t, os.Remove(path))
	}
	foreign := filepath.Join(retired, "foreign-after-crash")
	require.NoError(t, os.WriteFile(foreign, []byte("keep"), 0600))
	_, err = m.Remove(ctx, "retired", RemoveOptions{})
	require.Error(t, err)
	require.FileExists(t, foreign)
	require.FileExists(t, m.retirementPath(j.WorkspaceID))
	require.NoError(t, os.Remove(foreign))
	_, err = m.Remove(ctx, "retired", RemoveOptions{})
	require.NoError(t, err)
	require.NoDirExists(t, retired)
	require.NoFileExists(t, m.retirementPath(j.WorkspaceID))
}

func TestStableProfileGuardBlocksRemovalBeforeAnyWorktreeChanges(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "external-lock"})
	require.NoError(t, err)
	release, err := devcontract.LockProfile(ctx, m.options.Home, w.Manifest.WorkspaceID)
	require.NoError(t, err)
	defer release()
	_, err = m.Remove(ctx, "external-lock", RemoveOptions{PurgeState: true})
	require.Error(t, err)
	require.DirExists(t, filepath.Join(w.Root, "omniview"))
}

func TestFileURLAndLocalPathOriginsAreOneSourceIdentity(t *testing.T) {
	root := filepath.Join(t.TempDir(), "paths with spaces")
	require.NoError(t, os.MkdirAll(root, 0700))
	remote := fixtureRepo(t, root, "remote.git", "")
	host := fixtureRepo(t, root, "host", "")
	other := fixtureRepo(t, root, "other", "")
	fileURL := (&url.URL{Scheme: "file", Path: remote}).String()
	fixtureGit(t, host, "remote", "add", "origin", fileURL)
	fixtureGit(t, other, "remote", "add", "origin", remote)
	_, err := Init(context.Background(), InitOptions{Root: root, Sources: []SourceSpec{{ID: "omniview", Path: host}, {ID: "other", Path: other}}})
	require.Error(t, err)
}

func TestRemovalResumesAfterProfilePurgeBeforeRetirement(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "purge-boundary"})
	require.NoError(t, err)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	for i := range j.Resources {
		require.NoError(t, removeWorktree(ctx, &j.Resources[i]))
		j.Resources[i].Removed = true
	}
	j.Phase, j.PurgeState = "remove", true
	require.NoError(t, saveJournal(w.Root, j))
	require.NoError(t, os.RemoveAll(filepath.Dir(w.StateRoot)))
	_, err = m.Remove(ctx, "purge-boundary", RemoveOptions{PurgeState: true})
	require.NoError(t, err)
	require.NoDirExists(t, w.Root)
	require.NoDirExists(t, filepath.Dir(w.StateRoot))
	require.FileExists(t, filepath.Join(m.options.Home, ".omniview-dev", "locks", w.Manifest.WorkspaceID+".lock"))
}
