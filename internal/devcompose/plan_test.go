package devcompose

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"gopkg.in/yaml.v3"
)

func put(t *testing.T, root, path, data string) {
	t.Helper()
	p := filepath.Join(root, path)
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
}
func fixture(t *testing.T) (devcontract.ResolvedWorkspace, []Root) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w := devcontract.ResolvedWorkspace{Root: root, ManifestPath: filepath.Join(root, "workspace.json"), StateRoot: filepath.Join(root, ".state"), Manifest: devcontract.WorkspaceManifest{SchemaVersion: 1, WorkspaceID: "11111111-1111-4111-8111-111111111111", Slug: "test", DisplayName: "Test", Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}}}
	for _, id := range []string{"omniview", "plugin-a", "plugin-b"} {
		w.Manifest.Repositories = append(w.Manifest.Repositories, devcontract.Repository{ID: id, Directory: id, BaseRef: "main", BaseCommit: strings.Repeat("a", 40), Branch: "test"})
	}
	for _, id := range []string{"plugin-a", "plugin-b"} {
		w.Manifest.Plugins = append(w.Manifest.Plugins, devcontract.Plugin{ID: id, RepositoryID: id, Mode: "managed"})
	}
	raw, _ := json.Marshal(w.Manifest)
	put(t, root, "workspace.json", string(raw))
	put(t, root, "omniview/package.json", `{"name":"host","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"^19.0.0","react-dom":"^19.0.0"}}`)
	put(t, root, "omniview/pnpm-workspace.yaml", "packages: ['packages/*']\nstrictPeerDependencies: true\nminimumReleaseAge: 1440\n")
	put(t, root, "omniview/pnpm-lock.yaml", "---\nlockfileVersion: '9.0'\nimporters:\n  .:\n    packageManagerDependencies:\n      pnpm: {specifier: 12.14.0, version: 12.14.0}\npackages: {}\nsnapshots: {}\n---\nlockfileVersion: '9.0'\nsettings: {autoInstallPeers: true, excludeLinksFromLockfile: false}\nimporters:\n  .:\n    dependencies:\n      react: {specifier: ^19.0.0, version: 19.2.4}\n      react-dom: {specifier: ^19.0.0, version: '19.2.4(react@19.2.4)'}\npackages:\n  react@19.2.4: {resolution: {integrity: sha512-react}}\n  react-dom@19.2.4: {resolution: {integrity: sha512-dom}}\nsnapshots:\n  react@19.2.4: {}\n  react-dom@19.2.4(react@19.2.4): {dependencies: {react: 19.2.4}}\n")
	for _, id := range []string{"plugin-a", "plugin-b"} {
		put(t, root, id+"/ui/package.json", `{"name":"plugin-ui","private":true,"dependencies":{"react":"^19"}}`)
		put(t, root, id+"/ui/pnpm-workspace.yaml", "packages: ['widgets/*']\nstrictPeerDependencies: true\n")
	}
	return w, []Root{{Path: filepath.Join(root, "omniview"), Version: Version}, {Path: filepath.Join(root, "plugin-a/ui"), Version: Version}, {Path: filepath.Join(root, "plugin-b/ui"), Version: Version}}
}
func generated(t *testing.T, p Plan, name string) []byte {
	t.Helper()
	for _, f := range p.Files {
		if f.Path == filepath.Join(p.Root, name) {
			return f.Data
		}
	}
	t.Fatalf("missing %s", name)
	return nil
}
func TestNewDiscoversMultiplePrivatePluginsAndNestedWorkspacesWithoutWrites(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "plugin-a/ui/widgets/a/package.json", `{"name":"widget","private":true}`)
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Packages) != 4 {
		t.Fatalf("packages: %+v", p.Packages)
	}
	for _, name := range []string{"package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"} {
		if _, err := os.Lstat(filepath.Join(w.Root, name)); !os.IsNotExist(err) {
			t.Fatalf("planner wrote %s", name)
		}
	}
	var policy map[string]any
	if err := yaml.Unmarshal(generated(t, p, "pnpm-workspace.yaml"), &policy); err != nil {
		t.Fatal(err)
	}
	if policy["strictPeerDependencies"] != true || policy["ignoreScripts"] != true {
		t.Fatalf("unsafe policy: %+v", policy)
	}
	overrides := policy["overrides"].(map[string]any)
	if overrides["react"] != "19.2.4" || overrides["react-dom"] != "19.2.4" {
		t.Fatalf("providers: %+v", overrides)
	}
	put(t, w.Root, "plugin-b/ui/widgets/new/package.json", `{"name":"new","private":true}`)
	if err := CheckInputs(p); err == nil {
		t.Fatal("new manifest did not stale composition")
	}
}
func TestNewRejectsPolicyConflictWithoutLeakingValuesOrMutation(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "plugin-a/ui/pnpm-workspace.yaml", "strictPeerDependencies: false\nregistry: https://secret:password@example.test\n")
	_, err := New(w, roots, nil)
	if err == nil {
		t.Fatal("accepted incompatible policy")
	}
	if strings.Contains(err.Error(), "password") {
		t.Fatal("credential leaked")
	}
	if _, err := os.Stat(filepath.Join(w.Root, "package.json")); !os.IsNotExist(err) {
		t.Fatal("mutated aggregate")
	}
}
func TestLockSeedRewritesImportersAndPreservesRegistryIntegrity(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "plugin-a/ui/pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      exact: {specifier: ^1, version: 1.2.3}\npackages:\n  exact@1.2.3: {resolution: {integrity: sha512-do-not-float}}\nsnapshots:\n  exact@1.2.3: {}\n")
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	docs, err := decodeDocuments(generated(t, p, "pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 2 {
		t.Fatalf("metadata document lost: %d", len(docs))
	}
	main := docs[1]
	imp := mapping(main["importers"])
	if mapping(mapping(imp["plugin-a/ui"])["dependencies"])["exact"] == nil {
		t.Fatal("source importer lost")
	}
	rec := mapping(mapping(main["packages"])["exact@1.2.3"])
	if mapping(rec["resolution"])["integrity"] != "sha512-do-not-float" {
		t.Fatal("integrity lost")
	}
}
func TestNewRejectsForeignAndRedirectedSources(t *testing.T) {
	w, roots := fixture(t)
	roots[0].Path = t.TempDir()
	if _, err := New(w, roots, nil); err == nil {
		t.Fatal("foreign source accepted")
	}
	w, roots = fixture(t)
	outside := t.TempDir()
	if err := os.RemoveAll(filepath.Join(w.Root, "plugin-a/ui")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(w.Root, "plugin-a/ui")); err != nil {
		t.Fatal(err)
	}
	if _, err := New(w, roots, nil); err == nil {
		t.Fatal("redirected source accepted")
	}
}
func TestInstalledRequiresLinkedAuthorityAndFreshInputs(t *testing.T) {
	w, roots := fixture(t)
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	files := []map[string]any{}
	for _, f := range p.Files {
		put(t, w.Root, filepath.Base(f.Path), string(f.Data))
		sum := sha256.Sum256(f.Data)
		files = append(files, map[string]any{"Path": filepath.Base(f.Path), "AppliedHash": hex.EncodeToString(sum[:])})
	}
	journal := map[string]any{"SchemaVersion": 2, "WorkspaceID": w.Manifest.WorkspaceID, "Root": w.Root, "Phase": "linked", "Manifest": w.Manifest, "Evidence": map[string]any{"Protocol": "workspace", "Versions": []string{Version}, "AtomicDist": true, "Peers": true, "Runtime": true}, "Plan": map[string]any{"Composition": p}, "Files": files}
	save := func() { raw, _ := json.Marshal(journal); put(t, w.Root, ".local/links.json", string(raw)) }
	save()
	if _, err := Installed(w, filepath.Join(w.Root, "plugin-a/ui")); err != nil {
		t.Fatal(err)
	}
	if _, err := Installed(w, t.TempDir()); err == nil {
		t.Fatal("foreign consumer accepted")
	}
	journal["Phase"] = "applying"
	save()
	if _, err := Installed(w, roots[0].Path); err == nil {
		t.Fatal("applying journal accepted")
	}
	journal["Phase"] = "linked"
	save()
	put(t, w.Root, "plugin-a/ui/package.json", `{"name":"plugin-ui","private":true,"peerDependencies":{"react":"^18"}}`)
	if _, err := Installed(w, roots[0].Path); err == nil {
		t.Fatal("stale peer accepted")
	}
}

func TestNestedConfigCannotReincludeAnExcludedSourceTree(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "omniview/pnpm-workspace.yaml", "packages: ['packages/**', '!packages/foreign/**']\n")
	put(t, w.Root, "omniview/packages/foreign/package.json", `{"name":"foreign","packageManager":"pnpm@10.34.7"}`)
	put(t, w.Root, "omniview/packages/foreign/pnpm-workspace.yaml", "packages: ['children/*']\n")
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, pkg := range p.Packages {
		if pkg.Name == "foreign" {
			t.Fatal("nested config bypassed explicit parent exclusion")
		}
	}
}

func TestConfiguredWorkspaceMemberSymlinkRefusesInsteadOfDisappearing(t *testing.T) {
	w, roots := fixture(t)
	external := t.TempDir()
	put(t, external, "package.json", `{"name":"redirected","private":true}`)
	if err := os.MkdirAll(filepath.Join(w.Root, "omniview/packages"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, filepath.Join(w.Root, "omniview/packages/redirected")); err != nil {
		t.Fatal(err)
	}
	if _, err := New(w, roots, nil); err == nil {
		t.Fatal("configured redirected member silently disappeared")
	}
}

func TestUnmanagedFeatureRootPolicyCannotBypassReconciledSettings(t *testing.T) {
	w, roots := fixture(t)
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	put(t, w.Root, ".npmrc", "strict-peer-dependencies=false\n")
	if err = CheckInputs(p); err == nil {
		t.Fatal("unmanaged feature-root config did not stale composition")
	}
	if _, err = New(w, roots, nil); err == nil {
		t.Fatal("unmanaged feature-root policy silently applied")
	}
}

func TestPlanningInputRejectsMutationBetweenPolicyReads(t *testing.T) {
	for _, change := range []string{"edit", "remove", "create"} {
		t.Run(change, func(t *testing.T) {
			w, _ := fixture(t)
			path := filepath.Join(w.Root, "omniview/pnpm-workspace.yaml")
			if change == "create" {
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			}
			sources := sourceSet{hashes: map[string]string{}}
			raw, err := readInput(w, &sources, path)
			if err != nil {
				t.Fatal(err)
			}
			if change != "create" {
				docs, err := decodeDocuments(raw)
				if err != nil || docs[0]["strictPeerDependencies"] != true {
					t.Fatalf("initial policy could not be planned: %v", err)
				}
			}
			if change == "remove" {
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			} else {
				put(t, w.Root, "omniview/pnpm-workspace.yaml", "packages: ['packages/*']\nstrictPeerDependencies: true\noverrides: {exact: 2.0.0}\n")
			}
			if _, err := readInput(w, &sources, path); err == nil {
				t.Fatal("changed source accepted between planning reads; old policy can acquire a new fingerprint")
			}
		})
	}
}

func TestManifestLocalDependenciesRequireSelectedCompositionBeforeResolution(t *testing.T) {
	for _, locked := range []bool{false, true} {
		for _, section := range []string{"dependencies", "devDependencies", "optionalDependencies"} {
			for _, specifier := range []string{
				"link:../../unselected",
				"file:../../unselected",
				"workspace:../../unselected",
				"link:widgets/selected",
				"workspace:./widgets/selected",
				"workspace:*",
			} {
				t.Run(section+"/"+specifier+"/locked="+map[bool]string{false: "false", true: "true"}[locked], func(t *testing.T) {
					w, roots := fixture(t)
					put(t, w.Root, "unselected/package.json", `{"name":"outside","private":true}`)
					put(t, w.Root, "plugin-a/ui/widgets/selected/package.json", `{"name":"different-name","private":true}`)
					manifest, err := json.Marshal(map[string]any{"name": "plugin-ui", "private": true, section: map[string]string{"outside": specifier}})
					if err != nil {
						t.Fatal(err)
					}
					put(t, w.Root, "plugin-a/ui/package.json", string(manifest))
					if locked {
						// The new local dependency is deliberately absent from this old lock.
						put(t, w.Root, "plugin-a/ui/pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages: {}\nsnapshots: {}\n")
					}
					if _, err := New(w, roots, nil); err == nil {
						t.Fatal("unselected or misnamed manifest-local dependency accepted for native resolution")
					}
				})
			}
		}
	}
}

func TestManifestLocalDependenciesAcceptSelectedPackagesAndManagedMappings(t *testing.T) {
	for _, specifier := range []string{"link:widgets/selected", "workspace:./widgets/selected", "workspace:*"} {
		t.Run(specifier, func(t *testing.T) {
			w, roots := fixture(t)
			put(t, w.Root, "plugin-a/ui/widgets/selected/package.json", `{"name":"selected","version":"1.0.0","private":true}`)
			put(t, w.Root, "plugin-a/ui/package.json", `{"name":"plugin-ui","private":true,"dependencies":{"selected":"`+specifier+`"}}`)
			p, err := New(w, roots, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := CheckInputs(p); err != nil {
				t.Fatal(err)
			}
		})
	}
	w, roots := fixture(t)
	target := filepath.Join(w.Root, "omniview/packages/framework")
	put(t, w.Root, "omniview/packages/framework/package.json", `{"name":"@omniviewdev/runtime","version":"1.0.0","private":true}`)
	put(t, w.Root, "plugin-a/ui/package.json", `{"name":"plugin-ui","private":true,"dependencies":{"@omniviewdev/runtime":"file:../../../published-runtime"}}`)
	p, err := New(w, roots, map[string]string{"@omniviewdev/runtime": target})
	if err != nil {
		t.Fatal(err)
	}
	var policy map[string]any
	if err := yaml.Unmarshal(generated(t, p, "pnpm-workspace.yaml"), &policy); err != nil {
		t.Fatal(err)
	}
	if mapping(policy["overrides"])["@omniviewdev/runtime"] != "workspace:*" {
		t.Fatal("approved framework workspace mapping lost")
	}
}
