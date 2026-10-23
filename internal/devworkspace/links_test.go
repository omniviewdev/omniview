package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/stretchr/testify/require"
)

func TestLinkProtocolRejectsIndependentRootEvidence(t *testing.T) {
	for _, evidence := range []LinkProtocolEvidence{
		{Protocol: "link", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true},
		{Protocol: "workspace", Versions: []string{"10.34.7"}, AtomicDist: true, Peers: true, Runtime: true},
		{Protocol: "workspace", Versions: []string{"12.14.0", "10.6.2"}, AtomicDist: true, Peers: true, Runtime: true},
	} {
		require.Error(t, evidence.validate())
	}
	require.NoError(t, (LinkProtocolEvidence{Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true}).validate())
}

func TestLinkJournalRestoresOnlyUnchangedOwnedFiles(t *testing.T) {
	root := linkFixtureRoot(t)
	require.NoError(t, os.MkdirAll(filepath.Join(root, "host"), 0700))
	path := filepath.Join(root, "host", "go.mod")
	original := []byte("original\n")
	require.NoError(t, os.WriteFile(path, original, 0644))
	edit, err := snapshotLinkFile(root, path)
	require.NoError(t, err)
	edit.Applied = []byte("linked\n")
	edit.AppliedHash = linkHash(edit.Applied, true)
	j := linkJournal{SchemaVersion: 1, Root: root, WorkspaceID: "fixture", Files: []linkFile{edit}}
	require.NoError(t, writeLinkFile(root, edit, edit.Applied, true))
	require.NoError(t, restoreLinkFiles(root, &j))
	got, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, original, got)
	require.NoError(t, writeLinkFile(root, edit, edit.Applied, true))
	require.NoError(t, os.WriteFile(path, []byte("user change\n"), 0644))
	err = restoreLinkFiles(root, &j)
	require.ErrorContains(t, err, "changed")
	got, err = os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "user change\n", string(got))
}

func TestLinkJournalDoesNotFollowRedirectedFiles(t *testing.T) {
	root := linkFixtureRoot(t)
	outside := filepath.Join(t.TempDir(), "foreign")
	require.NoError(t, os.WriteFile(outside, []byte("foreign"), 0600))
	path := filepath.Join(root, "package.json")
	require.NoError(t, os.Symlink(outside, path))
	_, err := snapshotLinkFile(root, path)
	require.Error(t, err)
}

func TestLinkPlanIncludesRuntimeAndEverySelectedPlugin(t *testing.T) {
	root := filepath.Join(linkFixtureRoot(t), "feature with spaces")
	files := map[string]string{
		"host/package.json":                                  `{"name":"host","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"19.0.0","react-dom":"19.0.0"}}`,
		"host/pnpm-workspace.yaml":                           "packages:\n  - packages/*\n",
		"host/packages/omniviewdev-runtime/package.json":     `{"name":"@omniviewdev/runtime","version":"1.0.0"}`,
		"host/packages/omniviewdev-providers/package.json":   `{"name":"@omniviewdev/providers","version":"1.0.0"}`,
		"host/packages/omniviewdev-vite-plugin/package.json": `{"name":"@omniviewdev/vite-plugin","version":"1.0.0"}`,
		"host/go.mod":                      "module host\n\ngo 1.26.0\n",
		"one/go.mod":                       "module one\n\ngo 1.26.0\n",
		"two/go.mod":                       "module two\n\ngo 1.26.0\n",
		"ui/package.json":                  `{"name":"ui","private":true,"packageManager":"pnpm@12.14.0"}`,
		"ui/pnpm-workspace.yaml":           "packages:\n  - packages/*\n",
		"ui/packages/base-ui/package.json": `{"name":"@omniviewdev/base-ui","version":"1.0.0"}`,
		"ui/packages/ai-ui/package.json":   `{"name":"@omniviewdev/ai-ui","version":"1.0.0"}`,
		"ui/packages/editors/package.json": `{"name":"@omniviewdev/editors","version":"1.0.0"}`,
		"one/ui/package.json":              `{"name":"plugin-one","private":true,"packageManager":"pnpm@12.14.0"}`,
		"two/ui/package.json":              `{"name":"plugin-two","private":true,"packageManager":"pnpm@12.14.0"}`,
	}
	for path, content := range files {
		path = filepath.Join(root, path)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
		require.NoError(t, os.WriteFile(path, []byte(content), 0600))
	}
	require.NoError(t, os.MkdirAll(filepath.Join(root, "sdk"), 0700))
	ui, sdk := "ui", "sdk"
	w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{Repositories: []devcontract.Repository{{ID: "omniview", Directory: "host"}, {ID: "ui", Directory: "ui"}, {ID: "sdk", Directory: "sdk"}, {ID: "one", Directory: "one"}, {ID: "two", Directory: "two"}}, Plugins: []devcontract.Plugin{{ID: "one", RepositoryID: "one"}, {ID: "two", RepositoryID: "two"}}, Links: devcontract.Links{HostPackages: true, UIRepositoryID: &ui, SDKRepositoryID: &sdk}}}}
	w.Manifest.WorkspaceID = "11111111-1111-4111-8111-111111111111"
	registerCompositionFixture(t, &w)
	plan, err := makeLinkPlan(w)
	require.NoError(t, err)
	require.Len(t, plan.Roots, 4)
	require.Len(t, plan.GoRoots, 3)
	require.Equal(t, filepath.Join(root, "sdk"), plan.SDK)
	for _, r := range plan.Roots {
		require.Equal(t, filepath.Join(root, "ui/packages/base-ui"), r.Targets["@omniviewdev/base-ui"])
		require.NotContains(t, r.Targets, "react")
	}
	runtime := false
	for _, c := range plan.Consumers {
		if c.Path == filepath.Join(root, "host/packages/omniviewdev-runtime") {
			runtime = true
		}
	}
	require.True(t, runtime, "runtime must receive its own effective-resolution diagnostics")
}

func TestSDKReplacementPreservesUserReplacement(t *testing.T) {
	root := linkFixtureRoot(t)
	sdk := filepath.Join(root, "sdk with spaces")
	require.NoError(t, os.MkdirAll(sdk, 0700))
	original := []byte("module fixture\n\ngo 1.26.0\n\nrequire github.com/omniviewdev/plugin-sdk v0.5.0\n")
	changed, err := linkSDK(context.Background(), root, original, sdk)
	require.NoError(t, err)
	require.Contains(t, string(changed), `"`+sdk+`"`)
	again, err := linkSDK(context.Background(), root, changed, sdk)
	require.NoError(t, err)
	require.Equal(t, changed, again)
	_, err = linkSDK(context.Background(), root, append(original, []byte("\nreplace github.com/omniviewdev/plugin-sdk => /user/sdk\n")...), sdk)
	require.ErrorContains(t, err, "replacement")
}

func TestLinkProtocolRequiresObservedGate(t *testing.T) {
	for _, e := range []LinkProtocolEvidence{{}, {Protocol: "file", Versions: []string{"10.34.7", "10.6.2"}, AtomicDist: true, Peers: true, Runtime: true}} {
		require.Error(t, e.validate())
	}
	e := LinkProtocolEvidence{Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true}
	require.NoError(t, e.validate())
	data, err := json.Marshal(e)
	require.NoError(t, err)
	require.True(t, strings.Contains(string(data), "atomicDist"))
}

func TestLinkRestoresAbsentFilesAndRejectsInterruptedInstallerChanges(t *testing.T) {
	root := linkFixtureRoot(t)
	path := filepath.Join(root, "pnpm-lock.yaml")
	e, err := snapshotLinkFile(root, path)
	require.NoError(t, err)
	require.False(t, e.OriginalExists)
	e.Applied = []byte("generated: true\n")
	e.AppliedHash = linkHash(e.Applied, true)
	require.NoError(t, writeLinkFile(root, e, e.Applied, true))
	j := linkJournal{Files: []linkFile{e}}
	require.NoError(t, restoreLinkFiles(root, &j))
	require.NoFileExists(t, path)
	require.NoError(t, writeLinkFile(root, e, []byte("installer crash or user edit\n"), true))
	j.Files[0].Pending = true
	require.ErrorContains(t, restoreLinkFiles(root, &j), "unverified")
}

func TestLinkRestorePreflightsAllFilesBeforeChangingAny(t *testing.T) {
	root := linkFixtureRoot(t)
	var files []linkFile
	for _, name := range []string{"go.mod", "go.sum"} {
		path := filepath.Join(root, name)
		require.NoError(t, os.WriteFile(path, []byte("original"), 0600))
		e, err := snapshotLinkFile(root, path)
		require.NoError(t, err)
		e.Applied = []byte("applied")
		e.AppliedHash = linkHash(e.Applied, true)
		require.NoError(t, writeLinkFile(root, e, e.Applied, true))
		files = append(files, e)
	}
	require.NoError(t, os.WriteFile(filepath.Join(root, "go.sum"), []byte("user"), 0600))
	require.Error(t, restoreLinkFiles(root, &linkJournal{Files: files}))
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	require.NoError(t, err)
	require.Equal(t, "applied", string(data), "first file must not restore before a later conflict is discovered")
}

func TestSDKReplacementChecksConflictsAfterMatchingDefault(t *testing.T) {
	root := linkFixtureRoot(t)
	sdk := filepath.Join(root, "selected-sdk")
	require.NoError(t, os.MkdirAll(sdk, 0700))
	original := []byte("module fixture\n\ngo 1.26.0\n\nrequire github.com/omniviewdev/plugin-sdk v0.5.0\n\nreplace (\n github.com/omniviewdev/plugin-sdk => " + sdk + "\n github.com/omniviewdev/plugin-sdk v0.5.0 => /user/version-specific-sdk\n)\n")
	_, err := linkSDK(context.Background(), root, original, sdk)
	require.ErrorContains(t, err, "replacement")
}

func TestLinkInstallerPreservesEditorChangesAcrossProcessBoundary(t *testing.T) {
	for _, name := range []string{"package.json", "pnpm-workspace.yaml"} {
		t.Run(name, func(t *testing.T) {
			w, root := linkInstallerFixture(t)
			j := compositionJournalFixture(t, w)
			contents := map[string][]byte{}
			for _, file := range j.Files {
				contents[file.Path] = append([]byte(nil), file.Applied...)
			}
			edited := []byte("user edit made while pnpm was running")
			run := func(_ context.Context, _ string, _ string, _ ...string) ([]byte, error) {
				require.NoError(t, os.WriteFile(filepath.Join(root, name), edited, 0600))
				require.NoError(t, os.WriteFile(filepath.Join(root, "pnpm-lock.yaml"), []byte("installer output"), 0600))
				return nil, nil
			}
			err := installComposition(context.Background(), w.ResolvedWorkspace, j, run)
			require.ErrorContains(t, err, "changed")
			require.Error(t, restoreLinkFiles(w.Root, j))
			actual, err := os.ReadFile(filepath.Join(root, name))
			require.NoError(t, err)
			require.Equal(t, edited, actual, "unlink must not bless an editor's bytes as installer-owned")
			for _, file := range j.Files {
				if file.Path == name {
					require.Equal(t, contents[name], file.Applied)
				}
			}
		})
	}
}

func TestLinkPlanRejectsEscapedPackageAndFrontendDirectories(t *testing.T) {
	for _, nested := range []string{"packages/omniviewdev-runtime", "ui"} {
		t.Run(nested, func(t *testing.T) {
			root := linkFixtureRoot(t)
			host, plugin := filepath.Join(root, "host"), filepath.Join(root, "plugin")
			for _, path := range []string{host, plugin} {
				require.NoError(t, os.MkdirAll(path, 0700))
				require.NoError(t, os.WriteFile(filepath.Join(path, "package.json"), []byte(`{"name":"fixture","packageManager":"pnpm@12.14.0"}`), 0600))
			}
			foreign := t.TempDir()
			require.NoError(t, os.WriteFile(filepath.Join(foreign, "package.json"), []byte(`{"name":"foreign"}`), 0600))
			base := host
			if nested == "ui" {
				base = plugin
			}
			path := filepath.Join(base, nested)
			require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
			require.NoError(t, os.Symlink(foreign, path))
			w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{Repositories: []devcontract.Repository{{ID: "omniview", Directory: "host"}, {ID: "plugin", Directory: "plugin"}}, Plugins: []devcontract.Plugin{{ID: "plugin", RepositoryID: "plugin"}}}}}
			_, err := makeLinkPlan(w)
			require.ErrorContains(t, err, "symlink")
			content, err := os.ReadFile(filepath.Join(foreign, "package.json"))
			require.NoError(t, err)
			require.Equal(t, `{"name":"foreign"}`, string(content))
		})
	}
}

func TestFailedLinkInstallerDoesNotAcquireUnknownLockfileBytes(t *testing.T) {
	w, root := linkInstallerFixture(t)
	path := filepath.Join(root, "pnpm-lock.yaml")
	j := compositionJournalFixture(t, w)
	original := append([]byte(nil), j.Files[2].Applied...)
	run := func(_ context.Context, _ string, _ string, _ ...string) ([]byte, error) {
		require.NoError(t, os.WriteFile(path, []byte("unknown partial output"), 0600))
		return nil, devcontract.Fail(5, "fixture_failure", "fixture process failed")
	}
	require.Error(t, installComposition(context.Background(), w.ResolvedWorkspace, j, run))
	require.True(t, j.Files[2].Pending)
	require.Equal(t, original, j.Files[2].Applied)
	require.ErrorContains(t, restoreLinkFiles(w.Root, j), "unverified")
	actual, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "unknown partial output", string(actual))
}

func TestLinkPlanRejectsSelectedUIPackageSymlink(t *testing.T) {
	root := linkFixtureRoot(t)
	host, ui, foreign := filepath.Join(root, "host"), filepath.Join(root, "ui"), t.TempDir()
	require.NoError(t, os.MkdirAll(host, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(host, "package.json"), []byte(`{"name":"host","packageManager":"pnpm@12.14.0"}`), 0600))
	require.NoError(t, os.MkdirAll(filepath.Join(ui, "packages"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(foreign, "package.json"), []byte(`{"name":"@omniviewdev/base-ui"}`), 0600))
	require.NoError(t, os.Symlink(foreign, filepath.Join(ui, "packages/base-ui")))
	id := "ui"
	w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{Repositories: []devcontract.Repository{{ID: "omniview", Directory: "host"}, {ID: "ui", Directory: "ui"}}, Links: devcontract.Links{UIRepositoryID: &id}}}}
	_, err := makeLinkPlan(w)
	require.ErrorContains(t, err, "symlink")
}

func TestLinkApplyPreflightsEditsMadeDuringSDKPlanning(t *testing.T) {
	for _, editedName := range []string{"pnpm-workspace.yaml", "go.mod"} {
		t.Run(editedName, func(t *testing.T) {
			root := linkFixtureRoot(t)
			j := linkJournal{Root: root, Phase: "applying"}
			for _, name := range []string{"pnpm-workspace.yaml", "go.mod"} {
				path := filepath.Join(root, name)
				require.NoError(t, os.WriteFile(path, []byte("original "+name), 0600))
				e, err := snapshotLinkFile(root, path)
				require.NoError(t, err)
				e.Applied = []byte("prepared " + name)
				e.AppliedHash = linkHash(e.Applied, true)
				j.Files = append(j.Files, e)
			}
			// Model the editor save while the SDK's external go mod edit commands run,
			// after snapshots but before any prepared configuration may be applied.
			edited := []byte("editor save during SDK planning")
			require.NoError(t, os.WriteFile(filepath.Join(root, editedName), edited, 0600))
			require.ErrorContains(t, applyLinkFiles(&j), "changed")
			for _, name := range []string{"pnpm-workspace.yaml", "go.mod"} {
				actual, err := os.ReadFile(filepath.Join(root, name))
				require.NoError(t, err)
				expected := []byte("original " + name)
				if name == editedName {
					expected = edited
				}
				require.Equal(t, expected, actual, "no configuration may be applied when any original hash changed")
			}
		})
	}
}

func TestLinkEvidenceReturnsJournalValuesAndRejectsChangedState(t *testing.T) {
	ctx := context.Background()
	m, _ := fixtureManager(t)
	w, err := m.Create(ctx, CreateOptions{Slug: "link-evidence"})
	require.NoError(t, err)
	_, err = m.LinkEvidence(ctx, "link-evidence")
	require.Error(t, err, "an unlinked workspace must not acquire synthetic evidence")
	host := filepath.Join(w.Root, "omniview")
	path := filepath.Join(host, "package.json")
	original := []byte(`{"name":"fixture","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"19.0.0","react-dom":"19.0.0"}}`)
	require.NoError(t, os.WriteFile(path, original, 0600))
	for _, name := range []string{"runtime", "providers", "vite-plugin"} {
		target := filepath.Join(host, "packages", "omniviewdev-"+name, "package.json")
		require.NoError(t, os.MkdirAll(filepath.Dir(target), 0700))
		require.NoError(t, os.WriteFile(target, []byte(`{"name":"@omniviewdev/`+name+`","version":"1.0.0"}`), 0600))
	}
	require.NoError(t, os.WriteFile(filepath.Join(host, "pnpm-workspace.yaml"), []byte("packages:\n  - packages/*\n"), 0600))
	j := compositionJournalFixture(t, w)
	j.Phase = "linked"
	evidence := j.Evidence
	require.NoError(t, saveLinkJournal(j))
	actual, err := m.LinkEvidence(ctx, "link-evidence")
	require.NoError(t, err)
	require.Equal(t, evidence, actual)
	actual.Versions[0] = "caller mutation"
	again, err := m.LinkEvidence(ctx, "link-evidence")
	require.NoError(t, err)
	require.Equal(t, evidence, again)
	var edited map[string]any
	require.NoError(t, json.Unmarshal(original, &edited))
	edited["peerDependencies"] = map[string]string{"react": "^18.0.0"}
	edit, err := json.Marshal(edited)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, edit, 0600))
	actual, err = m.LinkEvidence(ctx, "link-evidence")
	require.NoError(t, err, "static protocol proof remains retrievable for stopped reconfiguration")
	require.Equal(t, evidence, actual)
	_, err = devcompose.Installed(w.ResolvedWorkspace, host)
	require.Error(t, err, "static proof must not authorize running stale installed inputs")
	generated := filepath.Join(w.Root, "package.json")
	require.NoError(t, os.WriteFile(generated, []byte("human aggregate edit"), 0600))
	_, err = m.LinkEvidence(ctx, "link-evidence")
	require.ErrorContains(t, err, "changed", "generated-byte ownership remains a CAS boundary")
	require.NoError(t, os.WriteFile(generated, j.Files[0].Applied, 0600))
	require.NoError(t, os.WriteFile(path, original, 0600))
	j.Manifest.DisplayName = "different selection"
	require.NoError(t, saveLinkJournal(j))
	_, err = m.LinkEvidence(ctx, "link-evidence")
	require.ErrorContains(t, err, "selection changed")
	j.Manifest = w.Manifest
	j.Phase = "applying"
	require.NoError(t, saveLinkJournal(j))
	_, err = m.LinkEvidence(ctx, "link-evidence")
	require.ErrorContains(t, err, "incomplete")
}

func TestCompositionInstallAuditsPeersBeforeAcquiringLockProvenance(t *testing.T) {
	w, _ := linkInstallerFixture(t)
	plan, err := makeLinkPlan(w)
	require.NoError(t, err)
	require.NotNil(t, plan.Composition)
	j := linkJournal{SchemaVersion: 2, Root: w.Root, WorkspaceID: w.Manifest.WorkspaceID, Manifest: w.Manifest, Plan: plan, Phase: "applying"}
	for _, generated := range plan.Composition.Files {
		e, err := snapshotLinkFile(w.Root, generated.Path)
		require.NoError(t, err)
		e.Applied, e.AppliedHash = generated.Data, linkHash(generated.Data, true)
		j.Files = append(j.Files, e)
	}
	require.NoError(t, applyLinkFiles(&j))
	var commands [][]string
	run := func(_ context.Context, dir, program string, args ...string) ([]byte, error) {
		require.Equal(t, w.Root, dir)
		require.Equal(t, "pnpm", program)
		commands = append(commands, append([]string(nil), args...))
		if args[0] == "install" {
			require.NoError(t, os.WriteFile(filepath.Join(w.Root, "pnpm-lock.yaml"), []byte("partial generated lock"), 0600))
			return nil, nil
		}
		return nil, devcontract.Fail(5, "peer_failure", "incompatible selected peer")
	}
	require.ErrorContains(t, installComposition(context.Background(), w.ResolvedWorkspace, &j, run), "peer")
	require.Equal(t, [][]string{{"install", "--ignore-scripts", "--strict-peer-dependencies", "--no-frozen-lockfile"}, {"-r", "peers", "check", "--json", "--lockfile-only"}}, commands)
	require.ErrorContains(t, restoreLinkFiles(w.Root, &j), "unverified")
}

func linkFixtureRoot(t *testing.T) string {
	t.Helper()
	root, err := devcontract.CanonicalPath(t.TempDir())
	require.NoError(t, err)
	return root
}

func linkInstallerFixture(t *testing.T) (Workspace, string) {
	t.Helper()
	collection := linkFixtureRoot(t)
	root := filepath.Join(collection, "workspaces", "feature")
	host := filepath.Join(root, "host")
	require.NoError(t, os.MkdirAll(host, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(host, "package.json"), []byte(`{"name":"fixture","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"19.0.0","react-dom":"19.0.0"}}`), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(host, ".gitignore"), []byte("node_modules/\n"), 0600))
	fixtureGit(t, host, "init")
	fixtureGit(t, host, "add", ".")
	fixtureGit(t, host, "commit", "-m", "fixture source")
	w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{
		WorkspaceID:  "11111111-1111-4111-8111-111111111111",
		Repositories: []devcontract.Repository{{ID: "omniview", Directory: "host"}},
	}}}
	registerCompositionFixture(t, &w)
	return w, root
}

func compositionJournalFixture(t *testing.T, w Workspace) *linkJournal {
	t.Helper()
	plan, err := makeLinkPlan(w)
	require.NoError(t, err)
	j := &linkJournal{SchemaVersion: 2, WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: "applying", Manifest: w.Manifest, Plan: plan, Evidence: LinkProtocolEvidence{Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true}}
	for _, file := range plan.Composition.Files {
		e, err := snapshotLinkFile(w.Root, file.Path)
		require.NoError(t, err)
		e.Applied, e.AppliedHash = file.Data, linkHash(file.Data, true)
		j.Files = append(j.Files, e)
	}
	require.NoError(t, applyLinkFiles(j))
	return j
}

func registerCompositionFixture(t *testing.T, w *Workspace) {
	t.Helper()
	w.Manifest.SchemaVersion = 1
	w.Manifest.Slug, w.Manifest.DisplayName = "fixture", "Fixture"
	w.Manifest.Profile.Kind = "development"
	w.Manifest.Ports.Policy = "sticky"
	for i := range w.Manifest.Repositories {
		w.Manifest.Repositories[i].BaseRef = "main"
		w.Manifest.Repositories[i].BaseCommit = strings.Repeat("a", 40)
		w.Manifest.Repositories[i].Branch = "fixture"
	}
	for i := range w.Manifest.Plugins {
		w.Manifest.Plugins[i].Mode = "managed"
	}
	w.ManifestPath = filepath.Join(w.Root, "workspace.json")
	w.StateRoot = filepath.Join(w.Root, ".state")
	require.NoError(t, w.Manifest.Validate())
	require.NoError(t, atomicJSON(w.ManifestPath, w.Manifest))
}

func TestCompositionInstallNeverFinishesUncertainProducer(t *testing.T) {
	w, _ := linkInstallerFixture(t)
	j := compositionJournalFixture(t, w)
	run := func(context.Context, string, string, ...string) ([]byte, error) {
		return nil, errors.Join(errOwnedCommandUncertain, context.Canceled)
	}
	require.ErrorIs(t, installComposition(context.Background(), w.ResolvedWorkspace, j, run), errOwnedCommandUncertain)
	require.Error(t, devoutputs.Restore(context.Background(), w.ResolvedWorkspace), "unknown descendants retain live output intent")
	require.True(t, j.Files[2].Pending)
}

func TestCompositionInstallDoesNotAdoptSourceEditAtTerminalBoundary(t *testing.T) {
	w, _ := linkInstallerFixture(t)
	j := compositionJournalFixture(t, w)
	path := filepath.Join(w.Root, "host", "package.json")
	edit := []byte(`{"name":"edited","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"19.0.0","react-dom":"19.0.0"}}`)
	run := func(_ context.Context, _ string, _ string, args ...string) ([]byte, error) {
		if args[0] == "install" {
			require.NoError(t, os.WriteFile(path, edit, 0600))
			require.NoError(t, os.WriteFile(filepath.Join(w.Root, "pnpm-lock.yaml"), []byte("unattested new lock"), 0600))
		}
		return nil, nil
	}
	require.ErrorContains(t, installComposition(context.Background(), w.ResolvedWorkspace, j, run), "changed")
	require.True(t, j.Files[2].Pending)
	actual, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, edit, actual)
	require.ErrorContains(t, restoreLinkFiles(w.Root, j), "unverified")
}
