package devworkspace

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/stretchr/testify/require"
	"golang.org/x/mod/sumdb/dirhash"
)

// linkSDK inherits only the selected SDK's versioned remote gRPC transport.
// Dependency replacements do not propagate into consumer module graphs.
func linkSDK(_ context.Context, dir string, original []byte, sdk string) ([]byte, error) {
	raw, err := os.ReadFile(filepath.Join(sdk, "go.mod"))
	if err != nil {
		return nil, err
	}
	transport, err := readSDKTransport(sdk, raw)
	if err != nil {
		return nil, err
	}
	return linkSDKTransport(dir, original, sdk, transport)
}

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
	require.NoError(t, os.WriteFile(filepath.Join(root, "sdk/go.mod"), []byte("module github.com/omniviewdev/plugin-sdk\n\ngo 1.26.0\n"), 0600))
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
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "go.mod"), []byte("module github.com/omniviewdev/plugin-sdk\n\ngo 1.26.0\n"), 0600))
	original := []byte("module fixture\n\ngo 1.26.0\n\nrequire github.com/omniviewdev/plugin-sdk v0.5.0\n\nreplace (\n github.com/omniviewdev/plugin-sdk => " + sdk + "\n github.com/omniviewdev/plugin-sdk v0.5.0 => /user/version-specific-sdk\n)\n")
	_, err := linkSDK(context.Background(), root, original, sdk)
	require.Error(t, err)
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
			edited := []byte("editor save during SDK planning")
			require.NoError(t, os.WriteFile(filepath.Join(root, editedName), edited, 0600))
			require.Error(t, applyLinkFiles(&j))
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

func TestDeselectedSourceDoesNotBlockUnlinkOrRemoval(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "deselected", Repositories: []string{"ui"}})
	require.NoError(t, err)
	ui := filepath.Join(w.Root, "ui")
	fixtureGit(t, ui, "commit", "--allow-empty", "-m", "retained feature work")
	tip := fixtureGit(t, ui, "rev-parse", "HEAD")
	branch := fixtureGit(t, ui, "branch", "--show-current")
	_, err = m.Edit(ctx, w.Manifest.Slug, EditOptions{RemoveRepositories: []string{"ui"}})
	require.NoError(t, err)
	require.NoDirExists(t, ui)

	report, err := m.Unlink(ctx, w.Manifest.Slug)
	require.NoError(t, err)
	require.Equal(t, "unlinked", report.Phase)
	_, err = m.RemoveWorkspace(ctx, w.Manifest.Slug, RemoveOptions{}, nil)
	require.NoError(t, err)
	require.NoDirExists(t, w.Root)
	require.Equal(t, tip, fixtureGit(t, filepath.Join(root, "ui", ".bare"), "rev-parse", branch))
}

func TestUnlinkStillRejectsMissingSelectedWorktree(t *testing.T) {
	m, _ := fixtureManager(t)
	ctx := context.Background()
	w, err := m.Create(ctx, CreateOptions{Slug: "missing-selected", Repositories: []string{"ui"}})
	require.NoError(t, err)
	ui := filepath.Join(w.Root, "ui")
	moved := filepath.Join(t.TempDir(), "moved-ui")
	require.NoError(t, os.Rename(ui, moved))

	_, err = m.Unlink(ctx, w.Manifest.Slug)
	var typed *devcontract.Error
	require.ErrorAs(t, err, &typed)
	require.Equal(t, "foreign_worktree", typed.Code)
	require.FileExists(t, filepath.Join(moved, "README"))
	require.FileExists(t, filepath.Join(w.Root, "omniview", "README"))
}

func TestSDKTransportOverlayOwnershipAndFreshness(t *testing.T) {
	root := linkFixtureRoot(t)
	sdk := filepath.Join(root, "sdk")
	require.NoError(t, os.MkdirAll(sdk, 0700))
	manifest := []byte("module github.com/omniviewdev/plugin-sdk\n\ngo 1.26.0\n\nreplace google.golang.org/grpc => github.com/omniviewdev/grpc-go v1.79.3-0.20261103012409-4c6f1d1c4e10\n")
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "go.mod"), manifest, 0600))
	sums := []byte("github.com/omniviewdev/grpc-go v1.79.3-0.20261103012409-4c6f1d1c4e10 h1:2rx00CjQ8G9XKctUvJ198ESozea5DXfZC5SfnPwFp8s=\ngithub.com/omniviewdev/grpc-go v1.79.3-0.20261103012409-4c6f1d1c4e10/go.mod h1:KmT0Kjez+0dde/v2j9vzwoAScgEPx/Bw1CYChhHLrHQ=\n")
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "go.sum"), sums, 0600))
	p := linkPlan{SDK: sdk, SDKModuleHash: linkHash(manifest, true)}
	var err error
	p.SDKTransport, err = readSDKTransport(sdk, manifest)
	require.NoError(t, err)
	p.SDKSumHash = linkHash(sums, true)
	p.SDKTransportSums, err = transportChecksums(sums, p.SDKTransport.New)
	require.NoError(t, err)
	require.NoError(t, checkSDKInput(p))
	j := linkJournal{Root: root, Plan: p, Phase: "applying"}
	for _, consumer := range []string{"host", "plugin"} {
		dir := filepath.Join(root, consumer)
		require.NoError(t, os.MkdirAll(dir, 0700))
		original := []byte("module example.com/" + consumer + "\n\ngo 1.26.0\n\nrequire google.golang.org/grpc v1.79.3\n")
		require.NoError(t, os.WriteFile(filepath.Join(dir, "go.mod"), original, 0600))
		e, err := snapshotLinkFile(root, filepath.Join(dir, "go.mod"))
		require.NoError(t, err)
		e.Applied, err = linkSDK(context.Background(), dir, original, sdk)
		require.NoError(t, err)
		e.AppliedHash = linkHash(e.Applied, true)
		j.Files = append(j.Files, e)
		sum, err := snapshotLinkFile(root, filepath.Join(dir, "go.sum"))
		require.NoError(t, err)
		sum.Applied, err = linkTransportChecksums(sum.Original, p.SDKTransportSums)
		require.NoError(t, err)
		sum.AppliedHash = linkHash(sum.Applied, true)
		j.Files = append(j.Files, sum)
	}
	changedSums := append(append([]byte(nil), sums...), []byte("\n")...)
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "go.sum"), changedSums, 0600))
	require.Error(t, checkSDKInput(p))
	require.Error(t, applyLinkFiles(&j))
	changed := append(append([]byte(nil), manifest...), []byte("\n// SDK edit\n")...)
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "go.mod"), changed, 0600))
	require.Error(t, checkSDKInput(p))
	require.Error(t, applyLinkFiles(&j))
	for _, e := range j.Files {
		got, err := os.ReadFile(filepath.Join(root, e.Path))
		if e.OriginalExists {
			require.NoError(t, err)
			require.Equal(t, e.Original, got)
		} else {
			require.True(t, os.IsNotExist(err))
		}
		require.NoError(t, os.WriteFile(filepath.Join(root, e.Path), e.Applied, 0600))
	}
	require.NoError(t, restoreLinkFiles(root, &j))
	for _, e := range j.Files {
		got, err := os.ReadFile(filepath.Join(root, e.Path))
		if e.OriginalExists {
			require.NoError(t, err)
			require.Equal(t, e.Original, got)
		} else {
			require.True(t, os.IsNotExist(err))
		}
	}
	got, err := os.ReadFile(filepath.Join(sdk, "go.mod"))
	require.NoError(t, err)
	require.Equal(t, changed, got)
	got, err = os.ReadFile(filepath.Join(sdk, "go.sum"))
	require.NoError(t, err)
	require.Equal(t, changedSums, got)
}

func TestSDKTransportRejectsConflictingAndUnsupportedReplacements(t *testing.T) {
	root := linkFixtureRoot(t)
	sdk := filepath.Join(root, "sdk")
	require.NoError(t, os.MkdirAll(sdk, 0700))
	base := "module github.com/omniviewdev/plugin-sdk\n\ngo 1.26.0\n\n"
	remote := "github.com/omniviewdev/grpc-go v1.79.3"
	for _, target := range []string{"../grpc", "github.com/omniviewdev/grpc-go"} {
		require.NoError(t, os.WriteFile(filepath.Join(sdk, "go.mod"), []byte(base+"replace google.golang.org/grpc => "+target+"\n"), 0600))
		_, err := linkSDK(context.Background(), root, []byte("module fixture\n"), sdk)
		require.Error(t, err)
	}
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "go.mod"), []byte(base+"replace google.golang.org/grpc => "+remote+"\n"), 0600))
	for _, version := range []string{"", " v1.70.0"} {
		matching := ""
		if version != "" {
			matching = " google.golang.org/grpc => " + remote + "\n"
		}
		original := []byte("module fixture\n\nreplace (\n" + matching + " google.golang.org/grpc" + version + " => example.com/user/grpc v1.70.0\n)\n")
		_, err := linkSDK(context.Background(), root, original, sdk)
		require.Error(t, err)
	}
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "go.mod"), []byte(base+"replace google.golang.org/grpc v1.79.3 => "+remote+"\n"), 0600))
	for _, version := range []string{"", " v1.70.0"} {
		original := []byte("module fixture\n\nreplace google.golang.org/grpc" + version + " => " + remote + "\n")
		_, err := linkSDK(context.Background(), root, original, sdk)
		require.Error(t, err)
	}
}

func TestSDKTransportChecksumsReadonlyConsumer(t *testing.T) {
	root := linkFixtureRoot(t)
	sdk := filepath.Join(root, "sdk")
	require.NoError(t, os.MkdirAll(sdk, 0700))
	const target = "example.com/sdk-grpc"
	const version = "v1.2.3"
	proxy := filepath.Join(root, "proxy")
	versionDir := filepath.Join(proxy, target, "@v")
	require.NoError(t, os.MkdirAll(versionDir, 0700))
	moduleBytes := []byte("module " + target + "\n\ngo 1.20\n")
	require.NoError(t, os.WriteFile(filepath.Join(versionDir, version+".mod"), moduleBytes, 0600))
	require.NoError(t, os.WriteFile(filepath.Join(versionDir, version+".info"), []byte(`{"Version":"v1.2.3","Time":"2020-01-01T00:00:00Z"}`), 0600))
	archivePath := filepath.Join(versionDir, version+".zip")
	archiveFile, err := os.Create(archivePath)
	require.NoError(t, err)
	writer := zip.NewWriter(archiveFile)
	for _, file := range []struct{ name, content string }{
		{"go.mod", string(moduleBytes)},
		{"grpc.go", "package grpc\nconst ForkOnlySymbol = 42\n"},
	} {
		entry, err := writer.Create(target + "@" + version + "/" + file.name)
		require.NoError(t, err)
		_, err = io.WriteString(entry, file.content)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	require.NoError(t, archiveFile.Close())
	contentHash, err := dirhash.HashZip(archivePath, dirhash.Hash1)
	require.NoError(t, err)
	moduleHash, err := dirhash.Hash1([]string{"go.mod"}, func(string) (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(moduleBytes)), nil
	})
	require.NoError(t, err)
	manifest := []byte("module github.com/omniviewdev/plugin-sdk\n\ngo 1.20\n\nreplace google.golang.org/grpc => " + target + " " + version + "\n")
	require.NoError(t, os.WriteFile(filepath.Join(sdk, "go.mod"), manifest, 0600))
	transport, err := readSDKTransport(sdk, manifest)
	require.NoError(t, err)
	authority := []byte(fmt.Sprintf("%s %s %s\n%s %s/go.mod %s\n", target, version, contentHash, target, version, moduleHash))
	sums, err := transportChecksums(authority, transport.New)
	require.NoError(t, err)
	for _, invalid := range [][]byte{nil, bytes.ReplaceAll(authority, []byte("h1:"), []byte("h2:")), append(append([]byte(nil), authority...), []byte(target+" "+version+" h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n")...), append(append([]byte(nil), authority...), []byte(target+"\n")...)} {
		_, err = transportChecksums(invalid, transport.New)
		require.Error(t, err)
	}
	conflicting := bytes.ReplaceAll(authority, []byte(contentHash), []byte("h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="))
	_, err = linkTransportChecksums(conflicting, sums)
	require.Error(t, err)
	_, err = linkTransportChecksums([]byte(target+"\n"), sums)
	require.Error(t, err)
	dir := filepath.Join(root, "consumer")
	require.NoError(t, os.MkdirAll(dir, 0700))
	mod, err := linkSDKTransport(dir, []byte("module example.com/consumer\n\ngo 1.20\n\nrequire google.golang.org/grpc v1.2.0\n"), sdk, transport)
	require.NoError(t, err)
	sum, err := linkTransportChecksums(nil, sums)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "go.mod"), mod, 0600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "go.sum"), sum, 0600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "consumer.go"), []byte("package consumer\nimport \"google.golang.org/grpc\"\nconst Value = grpc.ForkOnlySymbol\n"), 0600))
	proxyPath := filepath.ToSlash(proxy)
	if filepath.VolumeName(proxy) != "" {
		proxyPath = "/" + proxyPath
	}
	proxyURL := (&url.URL{Scheme: "file", Path: proxyPath}).String()
	run := func(args ...string) string {
		cmd := exec.Command("go", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=", "GOTOOLCHAIN=local", "GOPROXY="+proxyURL, "GOSUMDB=off", "GOPRIVATE=", "GONOPROXY=", "GONOSUMDB=", "GOMODCACHE="+filepath.Join(root, "module-cache"))
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, "%s", out)
		return string(out)
	}
	require.Equal(t, target+" "+version+"\n", run("list", "-mod=readonly", "-m", "-f", "{{.Replace.Path}} {{.Replace.Version}}", "google.golang.org/grpc"))
	run("build", "-mod=readonly", "-modcacherw", "./...")
	got, err := os.ReadFile(filepath.Join(dir, "go.sum"))
	require.NoError(t, err)
	require.Equal(t, sum, got, "readonly compilation must not supply missing checksums")
}
