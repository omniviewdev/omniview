package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
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

func TestStoppedSlugRenameRetiresAttestedOutputsAndPreservesState(t *testing.T) {
	for _, custom := range []bool{false, true} {
		t.Run(map[bool]string{false: "default", true: "custom"}[custom], func(t *testing.T) {
			m, _ := fixtureManager(t)
			ctx := context.Background()
			w, err := m.Create(ctx, CreateOptions{Slug: "generated-before", Repositories: []string{"ui"}})
			require.NoError(t, err)
			state := w.StateRoot
			if custom {
				state = bindFixtureProfile(t, m, w)
				w, err = m.Inspect(ctx, w.Manifest.WorkspaceID)
				require.NoError(t, err)
			}
			require.NoError(t, os.MkdirAll(state, 0700))
			require.NoError(t, os.WriteFile(filepath.Join(state, "counter"), []byte("48"), 0600))
			prepared, err := PrepareGeneratedTree(w, "bin/browser", NewGeneration())
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(filepath.Join(prepared.Directory, "host"), []byte("attested executable"), 0700))
			require.NoError(t, RecordGeneratedTree(prepared))
			native, err := PrepareGeneratedTree(w, "bin/native", NewGeneration())
			require.NoError(t, err)
			app := filepath.Join(native.Directory, "Omniview.dev.app", "Contents")
			require.NoError(t, os.MkdirAll(filepath.Join(app, "MacOS"), 0755))
			info := `<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.omniview.workspace.` + w.Manifest.WorkspaceID + `</string><key>CFBundleExecutable</key><string>Omniview</string></dict></plist>`
			require.NoError(t, os.WriteFile(filepath.Join(app, "Info.plist"), []byte(info), 0644))
			require.NoError(t, os.WriteFile(filepath.Join(app, "MacOS", "Omniview"), []byte("original native executable"), 0755))
			require.NoError(t, RecordGeneratedTree(native))
			require.NoError(t, saveLaunchJSON(launchPath(w, "native-profile.json"), nativeProfileUse{WorkspaceID: w.Manifest.WorkspaceID, Generation: NewGeneration(), Binary: filepath.Join("bin", "native", "Omniview.dev.app", "Contents", "MacOS", "Omniview")}))
			require.NoError(t, saveLaunchJSON(launchPath(w, "launch.json"), LaunchOptions{Mode: "browser"}))
			slug := "generated-after"
			after, err := m.Edit(ctx, w.Manifest.WorkspaceID, EditOptions{Slug: &slug})
			require.NoError(t, err)
			require.Equal(t, w.Manifest.WorkspaceID, after.Manifest.WorkspaceID)
			require.Equal(t, state, after.StateRoot)
			counter, err := os.ReadFile(filepath.Join(after.StateRoot, "counter"))
			require.NoError(t, err)
			require.Equal(t, "48", string(counter))
			require.NoDirExists(t, w.Root)
			require.NoDirExists(t, filepath.Join(after.Root, ".local", "bin"))
			require.NoFileExists(t, launchPath(after, "launch.json"))
			for _, repo := range after.Manifest.Repositories {
				require.Equal(t, repo.Branch, fixtureGit(t, filepath.Join(after.Root, repo.Directory), "branch", "--show-current"))
			}
			require.NoError(t, ValidateGenerated(ctx, after))
			binary, err := prepareNativeSnapshot(after)
			require.NoError(t, err)
			require.NotEmpty(t, binary, "rename must retain the original bundle's future native cleanup capability")
			nativeBytes, err := os.ReadFile(binary)
			require.NoError(t, err)
			require.Equal(t, "original native executable", string(nativeBytes))
			next, err := PrepareGeneratedTree(after, "bin/browser", NewGeneration())
			require.NoError(t, err, "renamed UUID must accept a fresh producer at its new source root")
			require.NoError(t, os.WriteFile(filepath.Join(next.Directory, "host"), []byte("rebuilt executable"), 0700))
			require.NoError(t, RecordGeneratedTree(next))
		})
	}
}

func TestStoppedSlugRenameRefusesChangedOrForeignOutputsUnchanged(t *testing.T) {
	for _, change := range []string{"edited", "foreign", "symlink", "dirty-source", "occupied-target", "occupied-added-branch", "ancestor-added-branch", "descendant-added-branch", "native-identity"} {
		t.Run(change, func(t *testing.T) {
			m, root := fixtureManager(t)
			ctx := context.Background()
			w, err := m.Create(ctx, CreateOptions{Slug: "generated-refusal"})
			require.NoError(t, err)
			prepared, err := PrepareGeneratedTree(w, "bin", NewGeneration())
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(filepath.Join(prepared.Directory, "host"), []byte("attested executable"), 0700))
			require.NoError(t, RecordGeneratedTree(prepared))
			output := filepath.Join(w.Root, ".local", "bin", "host")
			slug := "refused-target"
			options := EditOptions{Slug: &slug}
			switch change {
			case "edited":
				require.NoError(t, os.WriteFile(output, []byte("editor output"), 0700))
			case "foreign":
				require.NoError(t, os.WriteFile(filepath.Join(w.Root, ".local", "bin", "foreign"), []byte("keep"), 0600))
			case "symlink":
				target := filepath.Join(t.TempDir(), "foreign")
				require.NoError(t, os.WriteFile(target, []byte("keep"), 0600))
				require.NoError(t, os.Remove(output))
				require.NoError(t, os.Symlink(target, output))
			case "dirty-source":
				require.NoError(t, os.WriteFile(filepath.Join(w.Root, "omniview", "user-file"), []byte("keep"), 0600))
			case "occupied-target":
				require.NoError(t, os.Mkdir(filepath.Join(root, "workspaces", slug), 0700))
			case "occupied-added-branch":
				options.AddRepositories = []string{"ui"}
				fixtureGit(t, filepath.Join(root, "ui", ".bare"), "branch", "feature/"+slug+"-"+w.Manifest.WorkspaceID[:8], "main")
			case "ancestor-added-branch", "descendant-added-branch":
				options.AddRepositories = []string{"ui"}
				branch := "feature"
				if change == "descendant-added-branch" {
					branch = "feature/" + slug + "-" + w.Manifest.WorkspaceID[:8] + "/nested"
				}
				fixtureGit(t, filepath.Join(root, "ui", ".bare"), "branch", branch, "main")
			case "native-identity":
				native, err := PrepareGeneratedTree(w, "bin/native", NewGeneration())
				require.NoError(t, err)
				app := filepath.Join(native.Directory, "Omniview.dev.app", "Contents")
				require.NoError(t, os.MkdirAll(filepath.Join(app, "MacOS"), 0755))
				require.NoError(t, os.WriteFile(filepath.Join(app, "Info.plist"), []byte(`<plist><dict><key>CFBundleIdentifier</key><string>foreign.namespace</string></dict></plist>`), 0644))
				require.NoError(t, os.WriteFile(filepath.Join(app, "MacOS", "Omniview"), []byte("foreign namespace executable"), 0755))
				require.NoError(t, RecordGeneratedTree(native))
				require.NoError(t, saveLaunchJSON(launchPath(w, "native-profile.json"), nativeProfileUse{WorkspaceID: w.Manifest.WorkspaceID, Generation: NewGeneration(), Binary: filepath.Join("bin", "native", "Omniview.dev.app", "Contents", "MacOS", "Omniview")}))
			}
			manifest, err := os.ReadFile(filepath.Join(w.Root, "workspace.json"))
			require.NoError(t, err)
			journal, err := os.ReadFile(filepath.Join(w.Root, ".local", "ownership.json"))
			require.NoError(t, err)
			ledgerPath := filepath.Join(root, ".omniview-dev", "generated", w.Manifest.WorkspaceID+".json")
			ledger, err := os.ReadFile(ledgerPath)
			require.NoError(t, err)
			info, err := os.Lstat(output)
			require.NoError(t, err)
			content, err := os.ReadFile(output)
			require.NoError(t, err)
			_, err = m.Edit(ctx, w.Manifest.WorkspaceID, options)
			require.Error(t, err)
			for path, expected := range map[string][]byte{filepath.Join(w.Root, "workspace.json"): manifest, filepath.Join(w.Root, ".local", "ownership.json"): journal, ledgerPath: ledger, output: content} {
				actual, err := os.ReadFile(path)
				require.NoError(t, err)
				require.Equal(t, expected, actual, path)
			}
			after, err := os.Lstat(output)
			require.NoError(t, err)
			require.True(t, os.SameFile(info, after), "refusal must retain the original output inode")
		})
	}
}

func TestSlugRenameResumesInterruptedGeneratedCleanup(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires non-root POSIX directory permissions to interrupt a real deletion")
	}
	for _, foreign := range []bool{false, true} {
		t.Run(map[bool]string{false: "resume", true: "refuse-foreign"}[foreign], func(t *testing.T) {
			m, root := fixtureManager(t)
			ctx := context.Background()
			w, err := m.Create(ctx, CreateOptions{Slug: "cleanup-before"})
			require.NoError(t, err)
			prepared, err := PrepareGeneratedTree(w, "bin", NewGeneration())
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(filepath.Join(prepared.Directory, "host"), []byte("attested executable"), 0700))
			require.NoError(t, RecordGeneratedTree(prepared))
			bin := filepath.Join(w.Root, ".local", "bin")
			require.NoError(t, os.Chmod(bin, 0500))
			t.Cleanup(func() { _ = os.Chmod(bin, 0700) })
			slug := "cleanup-after"
			_, err = m.Edit(ctx, w.Manifest.WorkspaceID, EditOptions{Slug: &slug})
			require.Error(t, err, "actual generated deletion must fail on a non-writable directory")
			require.NoError(t, os.Chmod(bin, 0700))
			j, err := loadJournal(w.Root)
			require.NoError(t, err)
			require.Equal(t, "edit", j.Phase, "cleanup must not begin without durable rename intent")
			require.Equal(t, filepath.Join(root, "workspaces", slug), j.RenameTo)
			ledgerPath := filepath.Join(root, ".omniview-dev", "generated", w.Manifest.WorkspaceID+".json")
			if foreign {
				path := filepath.Join(bin, "foreign")
				require.NoError(t, os.WriteFile(path, []byte("preserve foreign"), 0600))
				before, err := os.ReadFile(ledgerPath)
				require.NoError(t, err)
				info, err := os.Lstat(path)
				require.NoError(t, err)
				_, err = m.ResumeWorkspace(ctx, w.Manifest.WorkspaceID)
				require.Error(t, err)
				after, err := os.ReadFile(ledgerPath)
				require.NoError(t, err)
				require.Equal(t, before, after)
				current, err := os.Lstat(path)
				require.NoError(t, err)
				require.True(t, os.SameFile(info, current))
				data, err := os.ReadFile(path)
				require.NoError(t, err)
				require.Equal(t, "preserve foreign", string(data))
				return
			}
			after, err := m.ResumeWorkspace(ctx, w.Manifest.WorkspaceID)
			require.NoError(t, err)
			require.Equal(t, w.Manifest.WorkspaceID, after.Manifest.WorkspaceID)
			require.Equal(t, w.StateRoot, after.StateRoot)
			require.Equal(t, slug, after.Manifest.Slug)
			require.Equal(t, "complete", after.Phase)
			require.NoDirExists(t, w.Root)
			require.NoDirExists(t, filepath.Join(after.Root, ".local", "bin"))
			require.NoFileExists(t, ledgerPath)
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
