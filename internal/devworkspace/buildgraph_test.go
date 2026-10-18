package devworkspace

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsource"
)

func graphFixture(t *testing.T) *BuildGraph {
	t.Helper()
	root := filepath.Join(t.TempDir(), "workspaces", "feature")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	uiID, sdkID := "ui", "plugin-sdk"
	w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{WorkspaceID: "11111111-1111-4111-8111-111111111111", Repositories: []devcontract.Repository{{ID: "omniview", Directory: "host"}, {ID: "ui", Directory: "ui"}, {ID: "plugin-sdk", Directory: "sdk"}, {ID: "plugin", Directory: "plugin"}}, Plugins: []devcontract.Plugin{{ID: "plugin", RepositoryID: "plugin", Mode: "managed"}}, Links: devcontract.Links{HostPackages: true, UIRepositoryID: &uiID, SDKRepositoryID: &sdkID}}}}
	packages := map[string]string{"host": "omniview", "ui": "ui", "ui/packages/base-ui": "@omniviewdev/base-ui", "ui/packages/ai-ui": "@omniviewdev/ai-ui", "ui/packages/editors": "@omniviewdev/editors", "host/packages/omniviewdev-providers": "@omniviewdev/providers", "host/packages/omniviewdev-runtime": "@omniviewdev/runtime", "host/packages/omniviewdev-vite-plugin": "@omniviewdev/vite-plugin", "plugin/ui": "plugin-ui"}
	for rel, name := range packages {
		dir := filepath.Join(root, rel)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		version := "12.14.0"
		raw, _ := json.Marshal(map[string]any{"name": name, "version": "1.0.0", "private": true, "packageManager": "pnpm@" + version, "dependencies": map[string]string{"react": "19.0.0", "react-dom": "19.0.0"}, "scripts": map[string]string{"build": "builder", "typecheck": "checker"}})
		if err := os.WriteFile(filepath.Join(dir, "package.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, rel := range []string{"sdk", "host", "plugin"} {
		if err := os.MkdirAll(filepath.Join(root, rel), 0700); err != nil {
			t.Fatal(err)
		}
	}
	for _, rel := range []string{"host", "ui"} {
		writeGraphFixture(t, filepath.Join(root, rel, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n")
	}
	writeGraphFixture(t, filepath.Join(root, "host/packages/omniviewdev-runtime/src/bindings/index.ts"), "export const original = true;\n")
	writeGraphFixture(t, filepath.Join(root, "host/packages/omniviewdev-vite-plugin/shims/runtime.mjs"), "export const original = true;\n")
	writeGraphFixture(t, filepath.Join(root, "host/ui/providers/monaco/yaml.worker.bundle.js"), "self.original = true;\n")
	for _, rel := range []string{"host", "ui", "sdk", "plugin"} {
		dir := filepath.Join(root, rel)
		writeGraphFixture(t, filepath.Join(dir, ".gitignore"), "node_modules/\ndist/\n")
		fixtureGit(t, dir, "init")
		fixtureGit(t, dir, "add", ".")
		fixtureGit(t, dir, "commit", "-m", "fixture source")
	}
	cache := filepath.Join(filepath.Dir(filepath.Dir(root)), "profile-cache")
	if err := os.MkdirAll(cache, 0700); err != nil {
		t.Fatal(err)
	}
	registerCompositionFixture(t, &w)
	p, err := makeLinkPlan(w)
	if err != nil {
		t.Fatal(err)
	}
	j := linkJournal{SchemaVersion: 2, WorkspaceID: w.Manifest.WorkspaceID, Root: root, Phase: "applying", Manifest: w.Manifest, Plan: p, Evidence: LinkProtocolEvidence{Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true}}
	for _, file := range p.Composition.Files {
		e, err := snapshotLinkFile(root, file.Path)
		if err != nil {
			t.Fatal(err)
		}
		e.Applied, e.AppliedHash = file.Data, linkHash(file.Data, true)
		j.Files = append(j.Files, e)
	}
	if err := applyLinkFiles(&j); err != nil {
		t.Fatal(err)
	}
	j.Phase = "linked"
	if err := saveLinkJournal(&j); err != nil {
		t.Fatal(err)
	}
	writer, err := devoutputs.BeginCompositionInstall(context.Background(), w.ResolvedWorkspace, *p.Composition)
	if err != nil {
		t.Fatal(err)
	}
	if err = writer.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	g, err := compileBuildGraph(w, p, BuildOptions{Generation: "22222222-2222-4222-8222-222222222222", GoBuildCacheDirectory: cache, ExpectedSDKRevision: strings.Repeat("a", 40), VerifySDKSource: func(_ context.Context, directory, revision string) (devsource.Identity, error) {
		return devsource.Identity{Directory: directory, ReviewedRevision: revision, SourceDigest: strings.Repeat("c", 64)}, nil
	}, HostBuild: func(context.Context, HostBuildRequest) error { return nil }})
	if err != nil {
		t.Fatal(err)
	}
	g.run = func(_ context.Context, _ string, program string, _ ...string) ([]byte, error) {
		if program == "pnpm" {
			return []byte("{}"), nil
		}
		return nil, os.ErrInvalid
	}
	g.runProducer = func(_ context.Context, directory string, environment []string, _ string, args ...string) ([]byte, error) {
		if len(args) == 0 || args[len(args)-1] != "build" {
			return nil, nil
		}
		for _, entry := range environment {
			key, value, _ := strings.Cut(entry, "=")
			switch key {
			case "OMNIVIEW_BUILD_OUTPUT_DIRECTORY":
				name := "index.js"
				if directory == filepath.Join(root, "host") {
					name = "index.html"
				}
				writeGraphFixture(t, filepath.Join(value, name), "actual fixture compiler output\n")
			case "OMNIVIEW_SHIMS_OUTPUT_DIRECTORY":
				writeGraphFixture(t, filepath.Join(value, "runtime.mjs"), "export const fixture = true;\n")
			case "OMNIVIEW_YAML_WORKER_OUTPUT_FILE":
				writeGraphFixture(t, value, "self.fixture = true;\n")
			}
		}
		return nil, nil
	}
	return g
}

func TestBuildGraphOrdersRuntimeBeforeShimAndConsumers(t *testing.T) {
	g := graphFixture(t)
	position := map[string]int{}
	for i, n := range g.Nodes {
		position[n.ID] = i
	}
	for _, pair := range [][2]string{{"base-ui", "ai-ui"}, {"base-ui", "editors"}, {"bindings", "runtime"}, {"providers", "runtime"}, {"runtime", "vite-plugin"}, {"vite-plugin", "plugin-ui:plugin"}, {"plugin-ui:plugin", "host-frontend"}, {"host-frontend", "host-backend"}} {
		if position[pair[0]] >= position[pair[1]] {
			t.Fatalf("%s must precede %s: %+v", pair[0], pair[1], g.Nodes)
		}
	}
	for _, n := range g.Nodes {
		if n.ID == "base-ui" && n.PNPMVersion != "12.14.0" {
			t.Fatalf("UI pin flattened: %+v", n)
		}
		if n.ID == "runtime" && n.PNPMVersion != "12.14.0" {
			t.Fatalf("host pin flattened: %+v", n)
		}
	}
}

func TestBuildGraphAffectedClosureDoesNotBuildBackendForCSS(t *testing.T) {
	g := graphFixture(t)
	got, err := g.affected([]string{filepath.Join(g.workspace.Root, "ui/packages/base-ui/src/styles.css")})
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, n := range got {
		ids[n.ID] = true
	}
	for _, id := range []string{"base-ui", "ai-ui", "editors", "runtime", "vite-plugin", "plugin-ui:plugin", "host-frontend"} {
		if !ids[id] {
			t.Fatalf("missing dependent %s: %+v", id, ids)
		}
	}
	if ids["bindings"] || ids["host-backend"] {
		t.Fatalf("CSS invoked backend/bindings: %+v", ids)
	}
}

func TestBuildGraphManifestMutationRequiresExplicitRelink(t *testing.T) {
	g := graphFixture(t)
	_, err := g.affected([]string{filepath.Join(g.workspace.Root, "plugin/ui/package.json")})
	if err == nil {
		t.Fatal("manifest mutation silently reused old dependency graph")
	}
}

func TestVerifyBuildSDKRejectsWrongEffectiveSourceAndIncompleteIdentity(t *testing.T) {
	g := graphFixture(t)
	for _, tc := range []struct {
		name, dir, digest string
		want              bool
	}{{"selected live source", g.plan.SDK, strings.Repeat("c", 64), true}, {"missing content identity", g.plan.SDK, "", false}, {"wrong source", filepath.Dir(g.plan.SDK), strings.Repeat("c", 64), false}} {
		t.Run(tc.name, func(t *testing.T) {
			g.run = func(_ context.Context, dir, program string, args ...string) ([]byte, error) {
				return json.Marshal(map[string]any{"Path": linkedSDK, "Dir": tc.dir, "Replace": map[string]any{"Dir": tc.dir}})
			}
			g.options.VerifySDKSource = func(_ context.Context, directory, revision string) (devsource.Identity, error) {
				return devsource.Identity{Directory: directory, ReviewedRevision: revision, SourceDigest: tc.digest}, nil
			}
			_, err := g.verifySDK(context.Background(), filepath.Join(g.workspace.Root, "host"))
			if (err == nil) != tc.want {
				t.Fatalf("trust result=%v want success=%v", err, tc.want)
			}
		})
	}
}

func TestVerifyBuildSDKRejectsSourceMutationDuringBuild(t *testing.T) {
	g := graphFixture(t)
	g.run = func(_ context.Context, dir, program string, args ...string) ([]byte, error) {
		return json.Marshal(map[string]any{"Path": linkedSDK, "Dir": g.plan.SDK})
	}
	before, err := g.verifySDK(context.Background(), filepath.Join(g.workspace.Root, "host"))
	if err != nil {
		t.Fatal(err)
	}
	g.options.VerifySDKSource = func(_ context.Context, directory, revision string) (devsource.Identity, error) {
		return devsource.Identity{Directory: directory, ReviewedRevision: revision, SourceDigest: strings.Repeat("d", 64)}, nil
	}
	if err = g.verifyUnchangedSDK(context.Background(), filepath.Join(g.workspace.Root, "host"), before); err == nil {
		t.Fatal("source mutated during build but old identity remained trusted")
	}
}

func TestBuildGraphTypecheckFailureStopsBuild(t *testing.T) {
	g := graphFixture(t)
	calls := []string{}
	g.runProducer = func(_ context.Context, dir string, _ []string, program string, args ...string) ([]byte, error) {
		calls = append(calls, strings.Join(args, " "))
		return nil, os.ErrInvalid
	}
	var base BuildNode
	for _, n := range g.Nodes {
		if n.ID == "base-ui" {
			base = n
		}
	}
	if err := g.buildNode(context.Background(), base); err == nil {
		t.Fatal("failed typecheck reported success")
	}
	if len(calls) != 1 || !strings.Contains(calls[0], "run typecheck") {
		t.Fatalf("build continued after typecheck: %v", calls)
	}
}

func TestBuildGraphRequiresRealSDKSourceVerifier(t *testing.T) {
	g := graphFixture(t)
	opts := g.options
	opts.VerifySDKSource = nil
	if _, err := compileBuildGraph(g.workspace, g.plan, opts); err == nil {
		t.Fatal("constructor accepted a missing trusted source verifier")
	}
}

func TestBuildGraphRequiresOwnedGeneration(t *testing.T) {
	g := graphFixture(t)
	opts := g.options
	opts.Generation = ""
	if _, err := compileBuildGraph(g.workspace, g.plan, opts); err == nil {
		t.Fatal("constructor accepted a missing output-owning generation")
	}
}

func TestBuildGraphPrivateLockRejectsRedirectedLeaf(t *testing.T) {
	g := graphFixture(t)
	lockPath, err := GeneratedLockPath(g.workspace, "buildgraph")
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "foreign-lock")
	if err = os.WriteFile(outside, []byte("foreign bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(outside, lockPath); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	called := false
	if err = g.withBuildLock(context.Background(), func() error { called = true; return nil }); err == nil || called {
		t.Fatalf("redirected private lock acquired: called=%v err=%v", called, err)
	}
	bytes, err := os.ReadFile(outside)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "foreign bytes" {
		t.Fatal("private lock changed a foreign target")
	}
}

func writeGraphFixture(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestBuildGraphRequiresExplicitCompilerCacheOutsideSource(t *testing.T) {
	g := graphFixture(t)
	for _, cache := range []string{"", filepath.Join(g.workspace.Root, "host")} {
		options := g.options
		options.GoBuildCacheDirectory = cache
		if _, err := compileBuildGraph(g.workspace, g.plan, options); err == nil {
			t.Fatalf("constructor accepted source/unowned cache %q", cache)
		}
	}
}

func TestBuildGraphAuditsWarmPeerEditBeforeAnyBuild(t *testing.T) {
	g := graphFixture(t)
	manifest := filepath.Join(g.workspace.Root, "ui", "packages", "base-ui", "package.json")
	var pkg map[string]any
	raw, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatal(err)
	}
	pkg["peerDependencies"] = map[string]string{"react": "^18.0.0"}
	raw, err = json.Marshal(pkg)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifest, raw, 0600); err != nil {
		t.Fatal(err)
	}
	audited := false
	g.run = func(_ context.Context, dir, program string, args ...string) ([]byte, error) {
		if dir != g.workspace.Root || program != "pnpm" || strings.Join(args, " ") != "-r peers check --json --lockfile-only" {
			t.Fatalf("unexpected audit command %s %s %v", dir, program, args)
		}
		audited = true
		return nil, os.ErrInvalid
	}
	g.runProducer = func(context.Context, string, []string, string, ...string) ([]byte, error) {
		t.Fatal("stale composition reached a build producer")
		return nil, nil
	}
	if err := g.Bootstrap(context.Background()); err == nil || !audited {
		t.Fatalf("warm peer edit accepted or unaudited: audited=%v err=%v", audited, err)
	}
}
