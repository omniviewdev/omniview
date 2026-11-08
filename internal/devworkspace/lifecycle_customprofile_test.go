package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

// attestedHost is the generated executable that every rename refusal starts from.
const attestedHost = "attested executable"

// observeSharedFixture records the mode and bytes of every listed file and the
// mode and entry names of every listed directory. Cases that share a fixture
// compare it with their pristine observation before they start, so an earlier
// case that failed to restore its mutation fails the next case instead of
// letting a refusal pass on stale state.
func observeSharedFixture(t *testing.T, files, directories []string) map[string]string {
	t.Helper()
	observed := make(map[string]string, len(files)+len(directories))
	for _, path := range files {
		info, err := os.Lstat(path)
		require.NoError(t, err)
		data, err := os.ReadFile(path)
		require.NoError(t, err)
		observed[path] = info.Mode().String() + "\n" + string(data)
	}
	for _, path := range directories {
		info, err := os.Lstat(path)
		require.NoError(t, err)
		entries, err := os.ReadDir(path)
		require.NoError(t, err)
		names := make([]string, len(entries))
		for i, entry := range entries {
			names[i] = entry.Name()
		}
		observed[path+"/"] = info.Mode().String() + "\n" + strings.Join(names, "\n")
	}
	return observed
}

// renameRefusalFixture is one attested workspace shared by cases that must each
// leave it as they found it. A case may change it only through restorations
// registered with t.Cleanup, and requirePristine runs before every case.
type renameRefusalFixture struct {
	manager    *Manager
	root       string
	workspace  Workspace
	output     string
	ledger     string
	pristine   map[string]string
	outputInfo os.FileInfo
}

func newRenameRefusalFixture(t *testing.T, repositories ...string) *renameRefusalFixture {
	t.Helper()
	m, root := fixtureManager(t, repositories...)
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "generated-refusal"})
	prepared, err := PrepareGeneratedTree(w, "bin", NewGeneration())
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(prepared.Directory, "host"), []byte(attestedHost), 0700))
	require.NoError(t, RecordGeneratedTree(prepared))
	f := &renameRefusalFixture{manager: m, root: root, workspace: w}
	f.output = filepath.Join(w.Root, ".local", "bin", "host")
	f.ledger = filepath.Join(root, ".omniview-dev", "generated", w.Manifest.WorkspaceID+".json")
	f.pristine = f.observe(t)
	f.outputInfo, err = os.Lstat(f.output)
	require.NoError(t, err)
	return f
}

// observe records the files and directory listings a refusal case may change.
// Git refs are checked by the cases that create branches.
func (f *renameRefusalFixture) observe(t *testing.T) map[string]string {
	t.Helper()
	w := f.workspace
	local := filepath.Join(w.Root, ".local")
	return observeSharedFixture(t,
		[]string{filepath.Join(w.Root, "workspace.json"), filepath.Join(local, "ownership.json"), f.ledger, f.output},
		[]string{w.Root, local, filepath.Dir(f.output), filepath.Join(w.Root, "omniview"), filepath.Join(f.root, "workspaces")})
}

// requirePristine fails unless every earlier case restored the fixture exactly:
// the same files and listings, the original output inode and modification time,
// and outputs that the real generated-ownership validator still accepts.
func (f *renameRefusalFixture) requirePristine(t *testing.T) {
	t.Helper()
	require.Equal(t, f.pristine, f.observe(t), "an earlier case did not restore the shared workspace")
	current, err := os.Lstat(f.output)
	require.NoError(t, err)
	require.True(t, os.SameFile(f.outputInfo, current), "an earlier case replaced the attested output inode")
	require.True(t, f.outputInfo.ModTime().Equal(current.ModTime()), "an earlier case changed the attested output time")
	require.NoError(t, ValidateGenerated(context.Background(), f.workspace), "an earlier case left the attested outputs invalid")
}

func TestProfileBindingSurvivesManagerRenameAndDefaultRuntimePaths(t *testing.T) {
	t.Parallel()
	for _, custom := range []bool{false, true} {
		t.Run(map[bool]string{false: "default", true: "custom"}[custom], func(t *testing.T) {
			t.Parallel()
			m, _ := fixtureManager(t, "omniview")
			ctx := context.Background()
			w := fixtureWorkspace(t, m, CreateOptions{Slug: "bound-profile"})
			var err error
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
	t.Parallel()
	for _, custom := range []bool{false, true} {
		t.Run(map[bool]string{false: "default", true: "custom"}[custom], func(t *testing.T) {
			t.Parallel()
			m, _ := fixtureManager(t, "ui")
			ctx := context.Background()
			w := fixtureWorkspace(t, m, CreateOptions{Slug: "generated-before", Repositories: []string{"ui"}})
			var err error
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
			saved, err := LoadLaunchOptions(after)
			require.NoError(t, err)
			require.Equal(t, LaunchOptions{Mode: "browser"}, saved)
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
	t.Parallel()
	// Cases share one attested workspace per source selection instead of
	// rebuilding it. They run in order, never in parallel, and each restores
	// exactly what it changed; requirePristine fails the next case if it did
	// not. native-identity records a second owned bundle that cannot be removed
	// on its own, so it stays last in the plain fixture.
	plain := newRenameRefusalFixture(t, "omniview")
	withUI := newRenameRefusalFixture(t, "ui")
	uiCommon := filepath.Join(withUI.root, "ui", ".bare")
	uiRefs := fixtureGit(t, uiCommon, "for-each-ref", "--format=%(refname) %(objectname)")
	conflictingBranch := func(t *testing.T, branch string) {
		t.Helper()
		require.Equal(t, uiRefs, fixtureGit(t, uiCommon, "for-each-ref", "--format=%(refname) %(objectname)"), "an earlier case left a branch in the shared source")
		fixtureGit(t, uiCommon, "branch", branch, "main")
		t.Cleanup(func() { fixtureGit(t, uiCommon, "branch", "-D", branch) })
	}
	for _, tc := range []struct {
		change  string
		fixture *renameRefusalFixture
	}{
		{"edited", plain}, {"foreign", plain}, {"symlink", plain}, {"dirty-source", plain}, {"occupied-target", plain},
		{"occupied-added-branch", withUI}, {"ancestor-added-branch", withUI}, {"descendant-added-branch", withUI},
		{"native-identity", plain},
	} {
		t.Run(tc.change, func(t *testing.T) {
			change, f := tc.change, tc.fixture
			f.requirePristine(t)
			m, root, w, output := f.manager, f.root, f.workspace, f.output
			ctx := context.Background()
			slug := "refused-target"
			options := EditOptions{Slug: &slug}
			switch change {
			case "edited":
				require.NoError(t, os.WriteFile(output, []byte("editor output"), 0700))
				t.Cleanup(func() {
					require.NoError(t, os.WriteFile(output, []byte(attestedHost), 0700))
					require.NoError(t, os.Chtimes(output, f.outputInfo.ModTime(), f.outputInfo.ModTime()))
				})
			case "foreign":
				foreign := filepath.Join(w.Root, ".local", "bin", "foreign")
				require.NoError(t, os.WriteFile(foreign, []byte("keep"), 0600))
				t.Cleanup(func() { require.NoError(t, os.Remove(foreign)) })
			case "symlink":
				scratch := t.TempDir()
				// Rename the attested file aside instead of deleting it, so
				// putting it back restores its original inode.
				attested := filepath.Join(scratch, "attested")
				require.NoError(t, os.Rename(output, attested))
				t.Cleanup(func() { require.NoError(t, os.Rename(attested, output)) })
				target := filepath.Join(scratch, "foreign")
				require.NoError(t, os.WriteFile(target, []byte("keep"), 0600))
				require.NoError(t, os.Symlink(target, output))
				t.Cleanup(func() { require.NoError(t, os.Remove(output)) })
			case "dirty-source":
				dirty := filepath.Join(w.Root, "omniview", "user-file")
				require.NoError(t, os.WriteFile(dirty, []byte("keep"), 0600))
				t.Cleanup(func() { require.NoError(t, os.Remove(dirty)) })
			case "occupied-target":
				occupied := filepath.Join(root, "workspaces", slug)
				require.NoError(t, os.Mkdir(occupied, 0700))
				t.Cleanup(func() { require.NoError(t, os.Remove(occupied)) })
			case "occupied-added-branch":
				options.AddRepositories = []string{"ui"}
				conflictingBranch(t, "feature/"+slug+"-"+w.Manifest.WorkspaceID[:8])
			case "ancestor-added-branch", "descendant-added-branch":
				options.AddRepositories = []string{"ui"}
				branch := "feature"
				if change == "descendant-added-branch" {
					branch = "feature/" + slug + "-" + w.Manifest.WorkspaceID[:8] + "/nested"
				}
				conflictingBranch(t, branch)
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
			ledgerPath := f.ledger
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
	t.Parallel()
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires non-root POSIX directory permissions to interrupt a real deletion")
	}
	// Both cases resume the same interrupted rename, so it is built and
	// interrupted once. refuse-foreign leaves it exactly as found, which every
	// case verifies first; resume completes the rename and therefore runs last.
	m, root := fixtureManager(t, "omniview")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "cleanup-before"})
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
	local := filepath.Join(w.Root, ".local")
	observe := func(t *testing.T) map[string]string {
		t.Helper()
		return observeSharedFixture(t,
			[]string{filepath.Join(w.Root, "workspace.json"), filepath.Join(local, "ownership.json"), ledgerPath, filepath.Join(bin, "host")},
			[]string{w.Root, local, bin, filepath.Join(root, "workspaces")})
	}
	interrupted := observe(t)
	for _, foreign := range []bool{true, false} {
		t.Run(map[bool]string{false: "resume", true: "refuse-foreign"}[foreign], func(t *testing.T) {
			require.Equal(t, interrupted, observe(t), "an earlier case did not leave the interrupted rename as it found it")
			if foreign {
				path := filepath.Join(bin, "foreign")
				require.NoError(t, os.WriteFile(path, []byte("preserve foreign"), 0600))
				t.Cleanup(func() { require.NoError(t, os.Remove(path)) })
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
	t.Parallel()
	m, _ := fixtureManager(t, "omniview")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "custom-purge"})
	var err error
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
	t.Parallel()
	m, _ := fixtureManager(t, "omniview")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "custom-retire"})
	var err error
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
	t.Parallel()
	m, _ := fixtureManager(t, "omniview")
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "foreign-binding"})
	var err error
	path := filepath.Join(w.Root, ".local", "profile.json")
	require.NoError(t, os.WriteFile(path, []byte(`{"schemaVersion":1,"workspaceID":"4beee3e2-2450-421c-ad44-485a704c3a65","stateRoot":"/foreign/state"}`), 0600))
	_, err = m.Remove(context.Background(), "foreign-binding", RemoveOptions{})
	require.Error(t, err)
	require.FileExists(t, path)
	require.DirExists(t, filepath.Join(w.Root, "omniview"))
}

func TestCustomPurgeRejectsUnmarkedOrForeignDefaultProfileBeforeGitRemoval(t *testing.T) {
	t.Parallel()
	// Both cases refuse before any mutation, so they share one workspace. Each
	// sets the valid owner marker aside instead of deleting it and puts that same
	// file back, and every case first compares the whole fixture with its
	// pristine observation.
	m, _ := fixtureManager(t, "omniview")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "foreign-default"})
	state := bindFixtureProfile(t, m, w)
	profile := filepath.Dir(w.StateRoot)
	require.NoError(t, os.MkdirAll(filepath.Join(profile, "runtime"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(profile, "runtime", "keep"), []byte("unproven"), 0600))
	marker := filepath.Join(profile, ".workspace-owner.json")
	local := filepath.Join(w.Root, ".local")
	observe := func(t *testing.T) map[string]string {
		t.Helper()
		return observeSharedFixture(t,
			[]string{marker, filepath.Join(profile, "runtime", "keep"), filepath.Join(w.Root, "workspace.json"), filepath.Join(local, "ownership.json"), filepath.Join(local, "profile.json")},
			[]string{profile, filepath.Join(profile, "runtime"), w.Root, local})
	}
	pristine := observe(t)
	for _, foreign := range []bool{false, true} {
		t.Run(map[bool]string{false: "unmarked", true: "foreign marker"}[foreign], func(t *testing.T) {
			require.Equal(t, pristine, observe(t), "an earlier case did not restore the shared profile")
			stash := filepath.Join(t.TempDir(), "owner")
			require.NoError(t, os.Rename(marker, stash))
			t.Cleanup(func() { require.NoError(t, os.Rename(stash, marker)) })
			if foreign {
				require.NoError(t, atomicJSON(marker, profileOwner{SchemaVersion: 1, WorkspaceID: "60813fa5-179c-4146-b210-ab0fa6b79870"}))
				t.Cleanup(func() { require.NoError(t, os.Remove(marker)) })
			}
			_, err := m.Remove(ctx, "foreign-default", RemoveOptions{PurgeState: true})
			require.Error(t, err)
			require.FileExists(t, filepath.Join(profile, "runtime", "keep"))
			require.DirExists(t, filepath.Join(w.Root, "omniview"))
			require.NoDirExists(t, state)
		})
	}
}

func TestCustomPurgeAlsoLocksExistingDefaultState(t *testing.T) {
	t.Parallel()
	m, _ := fixtureManager(t, "omniview")
	ctx := context.Background()
	w := fixtureWorkspace(t, m, CreateOptions{Slug: "locked-default"})
	var err error
	bindFixtureProfile(t, m, w)
	require.NoError(t, os.MkdirAll(w.StateRoot, 0700))
	lock := flock.New(filepath.Join(w.StateRoot, ".lock"))
	require.NoError(t, lock.Lock())
	defer lock.Unlock()
	_, err = m.Remove(ctx, "locked-default", RemoveOptions{PurgeState: true})
	require.Error(t, err)
	require.DirExists(t, filepath.Join(w.Root, "omniview"))
}
