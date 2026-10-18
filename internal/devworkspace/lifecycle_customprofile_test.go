package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/gofrs/flock"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

type profileOwner struct {
	SchemaVersion int    `json:"schemaVersion"`
	WorkspaceID   string `json:"workspaceID"`
}

func bindFixtureProfile(t *testing.T, m *Manager, w Workspace) string {
	t.Helper()
	state, err := devcontract.CanonicalPath(filepath.Join(t.TempDir(), "external-profile", "state"))
	require.NoError(t, err)
	bound, err := devcontract.SetCustomProfile(context.Background(), w.ResolvedWorkspace, state, m.options.Home)
	require.NoError(t, err)
	require.Equal(t, state, bound.StateRoot)
	require.NoDirExists(t, state)
	return state
}

func TestProfileBindingSurvivesManagerRenameAndDefaultRuntimePaths(t *testing.T) {
	for _, custom := range []bool{false, true} {
		t.Run(map[bool]string{false: "default", true: "custom"}[custom], func(t *testing.T) {
			m, _ := fixtureManager(t)
			ctx := context.Background()
			w, err := m.Create(ctx, CreateOptions{Slug: "bound-profile"})
			require.NoError(t, err)
			state := w.StateRoot
			if custom {
				state = bindFixtureProfile(t, m, w)
			}
			slug := "renamed-profile"
			renamed, err := m.Edit(ctx, "bound-profile", EditOptions{Slug: &slug})
			require.NoError(t, err)
			require.Equal(t, w.Manifest.WorkspaceID, renamed.Manifest.WorkspaceID)
			require.Equal(t, state, renamed.StateRoot)
			require.NoDirExists(t, state)
			paths, err := m.Paths(ctx, slug)
			require.NoError(t, err)
			defaultProfile := filepath.Join(m.options.Home, ".omniview-dev", "profiles", w.Manifest.WorkspaceID)
			require.Equal(t, filepath.Join(defaultProfile, "runtime"), paths.RuntimeRoot)
			require.Equal(t, filepath.Join(defaultProfile, "webview"), paths.WebviewRoot)
			require.Equal(t, state, paths.StateRoot)
			result, err := m.Remove(ctx, slug, RemoveOptions{})
			require.NoError(t, err)
			require.Equal(t, state, result.StateRoot)
			require.NoDirExists(t, state)
			if custom {
				require.FileExists(t, filepath.Join(filepath.Dir(state), ".omniview-profile.json"))
				require.FileExists(t, filepath.Join(m.options.Home, ".omniview-dev", "custom-profiles.json"))
			}
		})
	}
}

func TestCustomPurgeRemovesStateAndOwnedDefaultStorageButKeepsClaims(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "custom-purge"})
	require.NoError(t, err)
	state := bindFixtureProfile(t, m, w)
	require.NoError(t, os.MkdirAll(state, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(state, "sentinel"), []byte("state"), 0600))
	profile := filepath.Dir(w.StateRoot)
	for _, name := range []string{"runtime", "webview"} {
		require.NoError(t, os.MkdirAll(filepath.Join(profile, name), 0700))
		require.NoError(t, os.WriteFile(filepath.Join(profile, name, "sentinel"), []byte("own storage"), 0600))
	}
	foreign := filepath.Join(m.options.Home, ".omniview-dev", "profiles", "60813fa5-179c-4146-b210-ab0fa6b79870")
	require.NoError(t, os.MkdirAll(filepath.Join(foreign, "webview"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(foreign, "webview", "sentinel"), []byte("foreign storage"), 0600))
	require.NoError(t, atomicJSON(filepath.Join(foreign, ".workspace-owner.json"), profileOwner{SchemaVersion: 1, WorkspaceID: "60813fa5-179c-4146-b210-ab0fa6b79870"}))
	result, err := m.Remove(ctx, "custom-purge", RemoveOptions{PurgeState: true})
	require.NoError(t, err)
	require.Equal(t, state, result.StateRoot)
	require.NoDirExists(t, state)
	require.FileExists(t, filepath.Join(filepath.Dir(state), ".omniview-profile.json"))
	require.NoError(t, devcontract.ValidateCustomProfileClaim(state, w.Manifest.WorkspaceID, m.options.Home))
	require.NoDirExists(t, profile)
	require.FileExists(t, filepath.Join(foreign, ".workspace-owner.json"))
	require.FileExists(t, filepath.Join(foreign, "webview", "sentinel"))
}

func TestRetiredCustomBindingSnapshotSurvivesLocalBindingUnlink(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "custom-retire"})
	require.NoError(t, err)
	state := bindFixtureProfile(t, m, w)
	w, err = m.Inspect(ctx, "custom-retire")
	require.NoError(t, err)
	j, err := loadJournal(w.Root)
	require.NoError(t, err)
	require.NoError(t, m.captureProfileBinding(w.ResolvedWorkspace, j))
	for i := range j.Resources {
		require.NoError(t, removeWorktree(ctx, &j.Resources[i]))
		j.Resources[i].Removed = true
	}
	j.Phase = "retire"
	require.NoError(t, saveJournal(w.Root, j))
	require.NoError(t, m.saveRetirement(j))
	tomb := retiredRoot(j)
	require.NoError(t, os.Rename(w.Root, tomb))
	j.Retired = true
	require.NoError(t, m.saveRetirement(j))
	for _, path := range []string{filepath.Join(tomb, ".local", "profile.json"), filepath.Join(tomb, "workspace.json"), filepath.Join(tomb, ".local", "ownership.json"), filepath.Join(tomb, ".local")} {
		require.NoError(t, os.Remove(path))
	}
	result, err := m.Remove(ctx, "custom-retire", RemoveOptions{})
	require.NoError(t, err)
	require.Equal(t, state, result.StateRoot)
	require.NoDirExists(t, state)
	require.NoError(t, devcontract.ValidateCustomProfileClaim(state, w.Manifest.WorkspaceID, m.options.Home))
}

func TestForeignProfileBindingCannotBeAcceptedByFilename(t *testing.T) {
	m, _ := fixtureManager(t)
	w, err := m.Create(context.Background(), CreateOptions{Slug: "foreign-binding"})
	require.NoError(t, err)
	path := filepath.Join(w.Root, ".local", "profile.json")
	require.NoError(t, os.WriteFile(path, []byte(`{"schemaVersion":1,"workspaceID":"4beee3e2-2450-421c-ad44-485a704c3a65","stateRoot":"/foreign/state"}`), 0600))
	_, err = m.Remove(context.Background(), "foreign-binding", RemoveOptions{})
	require.Error(t, err)
	require.FileExists(t, path)
	require.DirExists(t, filepath.Join(w.Root, "omniview"))
}

func TestCustomPurgeRejectsUnmarkedOrForeignDefaultProfileBeforeGitRemoval(t *testing.T) {
	for _, foreign := range []bool{false, true} {
		t.Run(map[bool]string{false: "unmarked", true: "foreign marker"}[foreign], func(t *testing.T) {
			m, _ := fixtureManager(t)
			ctx := context.Background()
			w, err := m.Create(ctx, CreateOptions{Slug: "foreign-default"})
			require.NoError(t, err)
			state := bindFixtureProfile(t, m, w)
			profile := filepath.Dir(w.StateRoot)
			require.NoError(t, os.MkdirAll(filepath.Join(profile, "runtime"), 0700))
			require.NoError(t, os.WriteFile(filepath.Join(profile, "runtime", "keep"), []byte("unproven"), 0600))
			marker := filepath.Join(profile, ".workspace-owner.json")
			require.NoError(t, os.Remove(marker))
			if foreign {
				require.NoError(t, atomicJSON(marker, profileOwner{SchemaVersion: 1, WorkspaceID: "60813fa5-179c-4146-b210-ab0fa6b79870"}))
			}
			_, err = m.Remove(ctx, "foreign-default", RemoveOptions{PurgeState: true})
			require.Error(t, err)
			require.FileExists(t, filepath.Join(profile, "runtime", "keep"))
			require.DirExists(t, filepath.Join(w.Root, "omniview"))
			require.NoDirExists(t, state)
		})
	}
}

func TestCustomPurgeAlsoLocksExistingDefaultState(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "locked-default"})
	require.NoError(t, err)
	bindFixtureProfile(t, m, w)
	require.NoError(t, os.MkdirAll(w.StateRoot, 0700))
	lock := flock.New(filepath.Join(w.StateRoot, ".lock"))
	require.NoError(t, lock.Lock())
	defer lock.Unlock()
	_, err = m.Remove(ctx, "locked-default", RemoveOptions{PurgeState: true})
	require.Error(t, err)
	require.DirExists(t, filepath.Join(w.Root, "omniview"))
}
