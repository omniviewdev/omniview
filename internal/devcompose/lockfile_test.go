package devcompose

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestLockSeedReconcilesEffectivePeersAndEnrichesMetadataWithoutMovingPins(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "omniview/pnpm-workspace.yaml", "packages: ['packages/*']\nstrictPeerDependencies: true\noverrides: {'@types/react': ^19.0.0}\n")
	lock := func(peers, extra string) string {
		return "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      exact: {specifier: ^1, version: 1.2.3}\npackages:\n  exact@1.2.3:\n    resolution: {integrity: sha512-selected}\n    peerDependencies: {'@types/react': '" + peers + "', react: '>=18'}\n    os: [linux]\n" + extra + "snapshots:\n  exact@1.2.3:\n    dependencies: {child: 2.3.4}\n  child@2.3.4: {}\n"
	}
	before := map[string]string{
		"plugin-a/ui/pnpm-lock.yaml": lock("^19.0.0", ""),
		"plugin-b/ui/pnpm-lock.yaml": lock(">=18", "    libc: [glibc]\n    deprecated: 'Use the supported release'\n"),
	}
	for path, contents := range before {
		put(t, w.Root, path, contents)
	}
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	docs, err := decodeDocuments(generated(t, p, "pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	main := docs[len(docs)-1]
	record := mapping(mapping(main["packages"])["exact@1.2.3"])
	if mapping(record["resolution"])["integrity"] != "sha512-selected" || !reflect.DeepEqual(record["libc"], []any{"glibc"}) || record["deprecated"] != "Use the supported release" {
		t.Fatalf("selected identity or platform metadata lost: %+v", record)
	}
	if !reflect.DeepEqual(mapping(record["peerDependencies"]), map[string]any{"@types/react": "^19.0.0", "react": ">=18"}) {
		t.Fatalf("effective peer policy lost: %+v", record)
	}
	if mapping(mapping(mapping(main["snapshots"])["exact@1.2.3"])["dependencies"])["child"] != "2.3.4" {
		t.Fatal("transitive pin moved")
	}
	for _, path := range []string{"plugin-a/ui", "plugin-b/ui"} {
		if mapping(mapping(mapping(main["importers"])[path])["dependencies"])["exact"] == nil {
			t.Fatalf("selected importer lost: %s", path)
		}
	}
	for path, contents := range before {
		raw, err := os.ReadFile(filepath.Join(w.Root, path))
		if err != nil || string(raw) != contents {
			t.Fatalf("source lock changed: %s: %v", path, err)
		}
	}
	put(t, w.Root, "plugin-b/ui/pnpm-lock.yaml", before["plugin-b/ui/pnpm-lock.yaml"]+"# changed source\n")
	if err := CheckInputs(p); err == nil {
		t.Fatal("source lock change did not stale composition")
	}
}

func TestLockSeedRejectsUnexplainedMetadataConflicts(t *testing.T) {
	for _, tc := range []struct {
		name, left, right, policy string
	}{
		{"integrity", "resolution: {integrity: sha512-left}", "resolution: {integrity: sha512-right}", ""},
		{"resolution", "resolution: {integrity: sha512-same, tarball: 'https://registry.example/first.tgz'}", "resolution: {integrity: sha512-same, tarball: 'https://registry.example/second.tgz'}", ""},
		{"peer range", "resolution: {integrity: sha512-same}, peerDependencies: {react: ^18}", "resolution: {integrity: sha512-same}, peerDependencies: {react: ^19}", ""},
		{"peer optionality", "resolution: {integrity: sha512-same}, peerDependenciesMeta: {react: {optional: true}}", "resolution: {integrity: sha512-same}, peerDependenciesMeta: {react: {optional: false}}", ""},
		{"libc", "resolution: {integrity: sha512-same}, libc: [glibc]", "resolution: {integrity: sha512-same}, libc: [musl]", ""},
		{"engines", "resolution: {integrity: sha512-same}, engines: {node: '>=18'}", "resolution: {integrity: sha512-same}, engines: {node: '>=22'}", ""},
		{"scoped override", "resolution: {integrity: sha512-same}, peerDependencies: {'@types/react': ^18.0.0}", "resolution: {integrity: sha512-same}, peerDependencies: {'@types/react': ^19.0.0}", "overrides: {'@types/react': ^19.0.0, 'exact>@types/react': ^18.0.0}\n"},
		{"comparator-qualified override", "resolution: {integrity: sha512-same}, peerDependencies: {'@types/react': ^18.0.0}", "resolution: {integrity: sha512-same}, peerDependencies: {'@types/react': ^19.0.0}", "overrides: {'@types/react': ^19.0.0, '@types/react@>=18.0.0': ^18.0.0}\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, roots := fixture(t)
			put(t, w.Root, "plugin-a/ui/pnpm-workspace.yaml", tc.policy)
			for i, record := range []string{tc.left, tc.right} {
				path := []string{"plugin-a/ui/pnpm-lock.yaml", "plugin-b/ui/pnpm-lock.yaml"}[i]
				put(t, w.Root, path, "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages:\n  exact@1.2.3: {"+record+"}\nsnapshots: {}\n")
			}
			if _, err := New(w, roots, nil); err == nil {
				t.Fatal("accepted semantic or identity conflict")
			} else if strings.Contains(err.Error(), "sha512-") {
				t.Fatal("refusal exposed resolution values")
			}
		})
	}
}

func TestLockSeedConvergesHostThenUIThenStableSources(t *testing.T) {
	for _, ui := range []struct{ id, directory string }{{"ui", "ui"}, {"design-system", "zzz-design"}} {
		t.Run(ui.id, func(t *testing.T) {
			w, roots := fixture(t)
			w.Manifest.Repositories = append(w.Manifest.Repositories, devcontract.Repository{ID: ui.id, Directory: ui.directory, BaseRef: "main", BaseCommit: strings.Repeat("a", 40), Branch: "test"})
			w.Manifest.Links.UIRepositoryID = &ui.id
			raw, _ := json.Marshal(w.Manifest)
			put(t, w.Root, "workspace.json", string(raw))
			put(t, w.Root, ui.directory+"/package.json", `{"name":"ui-root","private":true}`)
			put(t, w.Root, ui.directory+"/pnpm-workspace.yaml", "packages: []\nstrictPeerDependencies: true\n")
			roots = append(roots, Root{Path: filepath.Join(w.Root, ui.directory), Version: Version})
			hostRaw, err := os.ReadFile(filepath.Join(w.Root, "omniview/pnpm-lock.yaml"))
			if err != nil {
				t.Fatal(err)
			}
			docs, err := decodeDocuments(hostRaw)
			if err != nil {
				t.Fatal(err)
			}
			host := docs[len(docs)-1]
			mapping(host["packages"])["exact@1.2.3"] = map[string]any{"resolution": map[string]any{"integrity": "sha512-exact"}}
			mapping(host["snapshots"])["exact@1.2.3"] = map[string]any{"dependencies": map[string]any{"child": "1.0.1"}, "optional": true}
			mapping(host["packages"])["child@1.0.1"] = map[string]any{"resolution": map[string]any{"integrity": "sha512-child-1.0.1"}}
			mapping(host["snapshots"])["child@1.0.1"] = map[string]any{}
			raw, err = encodeDocuments(docs)
			if err != nil {
				t.Fatal(err)
			}
			before := map[string]string{"omniview/pnpm-lock.yaml": string(raw)}
			// Deliberately prefer older host/UI pins: convergence is not an update.
			for _, item := range []struct{ path, exact, secondary string }{
				{"plugin-b/ui/pnpm-lock.yaml", "1.0.4", "2.0.4"},
				{"plugin-a/ui/pnpm-lock.yaml", "1.0.3", "2.0.3"},
				{ui.directory + "/pnpm-lock.yaml", "1.0.2", "2.0.2"},
			} {
				before[item.path] = "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages:\n" +
					"  exact@1.2.3: {resolution: {integrity: sha512-exact}}\n" +
					"  secondary@1.0.0: {resolution: {integrity: sha512-secondary}}\n" +
					"  child@" + item.exact + ": {resolution: {integrity: sha512-child-" + item.exact + "}}\n" +
					"  child@" + item.secondary + ": {resolution: {integrity: sha512-child-" + item.secondary + "}}\n" +
					"  extra@3.0.0: {resolution: {integrity: sha512-extra}}\n" +
					"snapshots:\n  child@" + item.exact + ": {}\n  child@" + item.secondary + ": {}\n  extra@3.0.0: {}\n" +
					"  exact@1.2.3:\n    dependencies: {child: " + item.exact + ", extra: 3.0.0}\n    transitivePeerDependencies: [supports-color]\n" +
					"  secondary@1.0.0:\n    dependencies: {child: " + item.secondary + "}\n"
			}
			for path, contents := range before {
				put(t, w.Root, path, contents)
			}
			p, err := New(w, roots, nil)
			if err != nil {
				t.Fatal(err)
			}
			docs, err = decodeDocuments(generated(t, p, "pnpm-lock.yaml"))
			if err != nil {
				t.Fatal(err)
			}
			snapshots := mapping(docs[len(docs)-1]["snapshots"])
			exact := mapping(snapshots["exact@1.2.3"])
			if mapping(exact["dependencies"])["child"] != "1.0.1" || mapping(exact["dependencies"])["extra"] != "3.0.0" || exact["optional"] == true {
				t.Fatalf("host pin, compatible edge, or required classification lost: %+v", exact)
			}
			if mapping(mapping(snapshots["secondary@1.0.0"])["dependencies"])["child"] != "2.0.2" {
				t.Fatal("UI did not own the collision absent from host")
			}
			if !reflect.DeepEqual(exact["transitivePeerDependencies"], []any{"supports-color"}) {
				t.Fatal("transitive peer requirements lost")
			}
			packages := mapping(docs[len(docs)-1]["packages"])
			for _, version := range []string{"1.0.2", "1.0.3", "1.0.4"} {
				if mapping(mapping(packages["child@"+version])["resolution"])["integrity"] != "sha512-child-"+version {
					t.Fatalf("nonpreferred locked identity removed: %s", version)
				}
			}
			want := []LockConvergence{
				{Section: "snapshots", PackageKey: "exact@1.2.3", PreferredSource: "omniview/pnpm-lock.yaml", OtherSource: ui.directory + "/pnpm-lock.yaml", ChangedFields: []string{"dependencies", "optional", "transitivePeerDependencies"}},
				{Section: "snapshots", PackageKey: "exact@1.2.3", PreferredSource: "omniview/pnpm-lock.yaml", OtherSource: "plugin-a/ui/pnpm-lock.yaml", ChangedFields: []string{"dependencies"}},
				{Section: "snapshots", PackageKey: "secondary@1.0.0", PreferredSource: ui.directory + "/pnpm-lock.yaml", OtherSource: "plugin-a/ui/pnpm-lock.yaml", ChangedFields: []string{"dependencies"}},
				{Section: "snapshots", PackageKey: "exact@1.2.3", PreferredSource: "omniview/pnpm-lock.yaml", OtherSource: "plugin-b/ui/pnpm-lock.yaml", ChangedFields: []string{"dependencies"}},
				{Section: "snapshots", PackageKey: "secondary@1.0.0", PreferredSource: ui.directory + "/pnpm-lock.yaml", OtherSource: "plugin-b/ui/pnpm-lock.yaml", ChangedFields: []string{"dependencies"}},
			}
			if !reflect.DeepEqual(p.Convergence, want) {
				t.Fatalf("seed choices not reported deterministically: %+v", p.Convergence)
			}
			for path, contents := range before {
				raw, err := os.ReadFile(filepath.Join(w.Root, path))
				if err != nil || string(raw) != contents {
					t.Fatalf("source lock changed: %s: %v", path, err)
				}
			}
		})
	}
}

func TestLockConvergenceDoesNotExposeNonregistryKeys(t *testing.T) {
	p := Plan{}
	left := map[string]any{"dependencies": map[string]any{"child": "1.0.0"}}
	right := map[string]any{"dependencies": map[string]any{"child": "2.0.0"}}
	key := "pkg@https://private.example/package.tgz"
	dst := map[string]any{key: left}
	if err := mergeSeedRecords(dst, map[string]any{key: right}, "snapshots", "plugin/ui/pnpm-lock.yaml", map[string]string{key: "omniview/pnpm-lock.yaml"}, &p, nil); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(p.Convergence)
	if err != nil || len(p.Convergence) != 1 || !strings.HasPrefix(p.Convergence[0].PackageKey, "sha256:") || strings.Contains(string(raw), "private.example") {
		t.Fatalf("private package key exposed: %s: %v", raw, err)
	}
}

func TestSnapshotConvergencePreservesRequirednessAndRejectsOtherSemantics(t *testing.T) {
	for _, tc := range []struct {
		name         string
		left, right  map[string]any
		wantOptional bool
	}{
		{"preferred optional, other required", map[string]any{"optional": true}, map[string]any{}, false},
		{"preferred required, other optional", map[string]any{}, map[string]any{"optional": true}, false},
		{"both optional", map[string]any{"optional": true}, map[string]any{"optional": true}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			merged, err := mergeSnapshotRecord(tc.left, tc.right, "plugin/ui/pnpm-lock.yaml")
			if err != nil || (merged["optional"] == true) != tc.wantOptional {
				t.Fatalf("requiredness changed: %+v: %v", merged, err)
			}
		})
	}
	for _, field := range []string{"id", "patched", "unknown"} {
		t.Run(field, func(t *testing.T) {
			if _, err := mergeSnapshotRecord(map[string]any{field: "first"}, map[string]any{field: "second"}, "plugin/ui/pnpm-lock.yaml"); err == nil {
				t.Fatal("accepted conflicting non-graph snapshot metadata")
			}
		})
	}
}
