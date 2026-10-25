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

func TestLockSeedMarksNativeMetadataDocumentStream(t *testing.T) {
	w, roots := fixture(t)
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw := generated(t, p, "pnpm-lock.yaml")
	if !strings.HasPrefix(string(raw), "---\n") {
		t.Fatal("native pnpm requires an initial document marker to recognize the metadata/application lock stream")
	}
	docs, err := decodeDocuments(raw)
	if err != nil || len(docs) != 2 || !metadataDocument(docs[0]) || metadataDocument(docs[1]) {
		t.Fatalf("metadata/application lock document boundaries changed: %v", err)
	}
	main := docs[1]
	host := mapping(mapping(main["importers"])["omniview"])
	if mapping(mapping(host["dependencies"])["react"])["version"] != "19.2.4" {
		t.Fatal("native lock stream lost the selected host dependency pin")
	}
}

const scalarPatchLF = "diff --git a/value b/value\n--- a/value\n+++ b/value\n@@ -1 +1 @@\n-before\n+after\n"

func TestNativeScalarPatchLineEndingHash(t *testing.T) {
	lockedHash := hash([]byte(scalarPatchLF))
	for _, tc := range []struct {
		name, patch string
	}{
		{"LF", scalarPatchLF},
		{"CRLF", strings.ReplaceAll(scalarPatchLF, "\n", "\r\n")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, roots := fixture(t)
			const patchPath = "omniview/patches/exact.patch"
			put(t, w.Root, patchPath, tc.patch)
			put(t, w.Root, "omniview/pnpm-workspace.yaml", "packages: ['packages/*']\npatchedDependencies:\n  exact@1.2.3: patches/exact.patch\n")
			sources, discoverErr := discover(w, roots)
			if discoverErr != nil {
				t.Fatal(discoverErr)
			}
			reconciled, reconcileErr := reconcile(w, sources)
			if reconcileErr != nil {
				t.Fatal(reconcileErr)
			}
			originalFingerprint := reconciled.inputHashes[patchPath]
			dst := map[string]any{}
			src := map[string]any{"patchedDependencies": map[string]any{"exact@1.2.3": lockedHash}}
			mergeErr := mergeLockedPatches(w, dst, src, reconciled.settings, reconciled.inputHashes, filepath.Join(w.Root, "omniview/pnpm-lock.yaml"))
			if mergeErr != nil {
				t.Fatalf("declared %s patch with native LF hash refused: %v", tc.name, mergeErr)
			}
			if mapping(dst["patchedDependencies"])["exact@1.2.3"] != lockedHash {
				t.Fatal("composition changed the native scalar hash")
			}
			if originalFingerprint != hash([]byte(tc.patch)) || reconciled.inputHashes[patchPath] != originalFingerprint {
				t.Fatal("native line-ending normalization replaced raw source-byte authority")
			}
		})
	}
}

const scalarPatchPath = "omniview/patches/exact.patch"
const scalarPatchPolicy = "packages: ['packages/*']\nstrictPeerDependencies: true\npatchedDependencies:\n  exact@1.2.3: patches/exact.patch\n"

func scalarPatchFixture(t *testing.T, patch, lockedHash string) (devcontract.ResolvedWorkspace, []Root) {
	t.Helper()
	w, roots := fixture(t)
	put(t, w.Root, scalarPatchPath, patch)
	put(t, w.Root, "omniview/package.json", `{"name":"host","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"^19.0.0","react-dom":"^19.0.0","exact":"^1"}}`)
	put(t, w.Root, "omniview/pnpm-workspace.yaml", scalarPatchPolicy)
	raw, readErr := os.ReadFile(filepath.Join(w.Root, "omniview/pnpm-lock.yaml"))
	if readErr != nil {
		t.Fatal(readErr)
	}
	docs, decodeErr := decodeDocuments(raw)
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	main := docs[len(docs)-1]
	main["patchedDependencies"] = map[string]any{"exact@1.2.3": lockedHash}
	version := "1.2.3(patch_hash=" + lockedHash + ")"
	mapping(mapping(mapping(main["importers"])["."])["dependencies"])["exact"] = map[string]any{"specifier": "^1", "version": version}
	mapping(main["packages"])["exact@1.2.3"] = map[string]any{"resolution": map[string]any{"integrity": "sha512-selected"}}
	mapping(main["snapshots"])["exact@"+version] = map[string]any{}
	encoded, encodeErr := encodeDocuments(docs)
	if encodeErr != nil {
		t.Fatal(encodeErr)
	}
	put(t, w.Root, "omniview/pnpm-lock.yaml", string(encoded))
	return w, roots
}

func TestLockSeedNative12ScalarPatchRequiresOwnedSource(t *testing.T) {
	nativeHash := hash([]byte(scalarPatchLF))
	crlfPatch := strings.ReplaceAll(scalarPatchLF, "\n", "\r\n")
	removeDeclaration := func(t *testing.T, w devcontract.ResolvedWorkspace) {
		put(t, w.Root, "omniview/pnpm-workspace.yaml", "packages: ['packages/*']\nstrictPeerDependencies: true\n")
	}
	declareForeignPatch := func(t *testing.T, w devcontract.ResolvedWorkspace) {
		put(t, w.Root, "plugin-a/patches/exact.patch", scalarPatchLF)
		put(t, w.Root, "plugin-a/ui/pnpm-workspace.yaml", "packages: ['widgets/*']\npatchedDependencies:\n  exact@1.2.3: ../patches/exact.patch\n")
	}
	for _, tc := range []struct {
		name, patch, lockedHash string
		prepare                 func(*testing.T, devcontract.ResolvedWorkspace)
		wantErr                 bool
	}{
		{name: "accepted-LF"},
		{name: "accepted-CRLF", patch: crlfPatch},
		{name: "undeclared", prepare: removeDeclaration, wantErr: true},
		{name: "missing", prepare: func(t *testing.T, w devcontract.ResolvedWorkspace) {
			if removeErr := os.Remove(filepath.Join(w.Root, scalarPatchPath)); removeErr != nil {
				t.Fatal(removeErr)
			}
		}, wantErr: true},
		{name: "escaping", prepare: func(t *testing.T, w devcontract.ResolvedWorkspace) {
			put(t, w.Root, "outside.patch", scalarPatchLF)
			put(t, w.Root, "omniview/pnpm-workspace.yaml", strings.ReplaceAll(scalarPatchPolicy, "patches/exact.patch", "../outside.patch"))
		}, wantErr: true},
		{name: "redirected", prepare: func(t *testing.T, w devcontract.ResolvedWorkspace) {
			put(t, w.Root, "outside.patch", scalarPatchLF)
			if removeErr := os.Remove(filepath.Join(w.Root, scalarPatchPath)); removeErr != nil {
				t.Fatal(removeErr)
			}
			if linkErr := os.Symlink(filepath.Join(w.Root, "outside.patch"), filepath.Join(w.Root, scalarPatchPath)); linkErr != nil {
				t.Fatal(linkErr)
			}
		}, wantErr: true},
		{name: "changed", prepare: func(t *testing.T, w devcontract.ResolvedWorkspace) {
			put(t, w.Root, scalarPatchPath, scalarPatchLF+"# changed after native lock generation\n")
		}, wantErr: true},
		{name: "malformed-hash", lockedHash: "not-a-native-sha256", wantErr: true},
		{name: "wrong-hash", lockedHash: strings.Repeat("0", 64), wantErr: true},
		{name: "raw-CRLF-hash", patch: crlfPatch, lockedHash: hash([]byte(crlfPatch)), wantErr: true},
		{name: "foreign-declaration", prepare: func(t *testing.T, w devcontract.ResolvedWorkspace) {
			removeDeclaration(t, w)
			declareForeignPatch(t, w)
		}, wantErr: true},
		{name: "conflicting-policy", prepare: declareForeignPatch, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			patch := scalarPatchLF
			if tc.patch != "" {
				patch = tc.patch
			}
			lockedHash := nativeHash
			if tc.lockedHash != "" {
				lockedHash = tc.lockedHash
			}
			w, roots := scalarPatchFixture(t, patch, lockedHash)
			if tc.prepare != nil {
				tc.prepare(t, w)
			}
			lockPath := filepath.Join(w.Root, "omniview/pnpm-lock.yaml")
			before, beforeErr := os.ReadFile(lockPath)
			if beforeErr != nil {
				t.Fatal(beforeErr)
			}
			p, planErr := New(w, roots, nil)
			if tc.wantErr {
				if planErr == nil {
					t.Fatal("native scalar lock established authority over an invalid source patch")
				}
				return
			}
			if planErr != nil {
				t.Fatal(planErr)
			}
			if p.SourceHashes[scalarPatchPath] != hash([]byte(patch)) {
				t.Fatal("native scalar replaced the raw source-byte fingerprint")
			}
			generatedDocs, lockErr := decodeDocuments(generated(t, p, "pnpm-lock.yaml"))
			if lockErr != nil {
				t.Fatal(lockErr)
			}
			main := generatedDocs[len(generatedDocs)-1]
			if mapping(main["patchedDependencies"])["exact@1.2.3"] != nativeHash {
				t.Fatal("composition changed the native scalar hash")
			}
			version := "1.2.3(patch_hash=" + nativeHash + ")"
			host := mapping(mapping(main["importers"])["omniview"])
			if mapping(mapping(host["dependencies"])["exact"])["version"] != version || mapping(main["snapshots"])["exact@"+version] == nil {
				t.Fatal("composition moved the selected patched importer or snapshot")
			}
			policyDocs, policyErr := decodeDocuments(generated(t, p, "pnpm-workspace.yaml"))
			if policyErr != nil {
				t.Fatal(policyErr)
			}
			if mapping(policyDocs[0]["patchedDependencies"])["exact@1.2.3"] != scalarPatchPath {
				t.Fatal("source policy lost its independently owned patch path")
			}
			after, afterErr := os.ReadFile(lockPath)
			if afterErr != nil || string(after) != string(before) {
				t.Fatalf("composition modified the native source lock: %v", afterErr)
			}
			if inputsErr := CheckInputs(p); inputsErr != nil {
				t.Fatal(inputsErr)
			}
			put(t, w.Root, scalarPatchPath, patch+"# changed after planning\n")
			if inputsErr := CheckInputs(p); inputsErr == nil {
				t.Fatal("changed patch bytes did not stale the source-owned plan")
			}
			if _, newPlanErr := New(w, roots, nil); newPlanErr == nil {
				t.Fatal("new planning accepted a stale native patch hash")
			}
		})
	}
}

func TestNativeScalarPatchRequiresRawSourceAuthority(t *testing.T) {
	nativeHash := hash([]byte(scalarPatchLF))
	for _, tc := range []struct {
		name   string
		change func(*testing.T, devcontract.ResolvedWorkspace, *reconciledPolicy)
	}{
		{"missing-fingerprint", func(_ *testing.T, _ devcontract.ResolvedWorkspace, policy *reconciledPolicy) {
			delete(policy.inputHashes, scalarPatchPath)
		}},
		{"line-ending-mutation-after-reconciliation", func(t *testing.T, w devcontract.ResolvedWorkspace, _ *reconciledPolicy) {
			put(t, w.Root, scalarPatchPath, scalarPatchLF)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, roots := scalarPatchFixture(t, strings.ReplaceAll(scalarPatchLF, "\n", "\r\n"), nativeHash)
			sources, discoverErr := discover(w, roots)
			if discoverErr != nil {
				t.Fatal(discoverErr)
			}
			reconciled, reconcileErr := reconcile(w, sources)
			if reconcileErr != nil {
				t.Fatal(reconcileErr)
			}
			tc.change(t, w, &reconciled)
			src := map[string]any{"patchedDependencies": map[string]any{"exact@1.2.3": nativeHash}}
			mergeErr := mergeLockedPatches(w, map[string]any{}, src, reconciled.settings, reconciled.inputHashes, filepath.Join(w.Root, "omniview/pnpm-lock.yaml"))
			if mergeErr == nil {
				t.Fatal("native scalar accepted missing or changed raw-byte source authority")
			}
		})
	}
}

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

func TestMemberLockIsInertUntilItDeclaresAWorkspaceBoundary(t *testing.T) {
	w, roots := fixture(t)
	member := "omniview/packages/consumer"
	put(t, w.Root, member+"/package.json", `{"name":"consumer","private":true,"dependencies":{"react":"^19.0.0"}}`)
	raw, err := os.ReadFile(filepath.Join(w.Root, "omniview/pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	docs, err := decodeDocuments(raw)
	if err != nil {
		t.Fatal(err)
	}
	mapping(docs[len(docs)-1]["importers"])["packages/consumer"] = map[string]any{
		"dependencies": map[string]any{"react": map[string]any{"specifier": "^19.0.0", "version": "19.2.4"}},
	}
	raw, err = encodeDocuments(docs)
	if err != nil {
		t.Fatal(err)
	}
	put(t, w.Root, "omniview/pnpm-lock.yaml", string(raw))
	before, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	put(t, w.Root, member+"/pnpm-lock.yaml", "lockfileVersion: [invalid inert member lock\n")
	after, err := New(w, roots, nil)
	if err != nil {
		t.Fatalf("member-local lock displaced its declared workspace authority: %v", err)
	}
	if err := CheckInputs(before); err != nil {
		t.Fatalf("inert member-local lock invalidated the installed source graph: %v", err)
	}
	docs, err = decodeDocuments(generated(t, after, "pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	importer := mapping(mapping(docs[len(docs)-1]["importers"])[relative(after.Root, filepath.Join(w.Root, member))])
	if mapping(mapping(importer["dependencies"])["react"])["version"] != "19.2.4" {
		t.Fatal("member lost its parent workspace's frozen React selection")
	}
	put(t, w.Root, member+"/pnpm-workspace.yaml", "packages: []\n")
	put(t, w.Root, member+"/pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages:\n  react@19.2.4: {resolution: {integrity: sha512-conflicting}}\nsnapshots: {}\n")
	if err := CheckInputs(after); err == nil {
		t.Fatal("new workspace boundary did not invalidate source authority")
	}
	if _, err := New(w, roots, nil); err == nil {
		t.Fatal("actual nested workspace lock lost its identity-conflict guard")
	}
}

func TestNestedWorkspaceWithoutLockDoesNotInheritEnclosingImporter(t *testing.T) {
	w, roots := fixture(t)
	member := "omniview/packages/consumer"
	put(t, w.Root, member+"/package.json", `{"name":"consumer","private":true,"dependencies":{"exact":"^1"}}`)
	put(t, w.Root, member+"/pnpm-workspace.yaml", "packages: ['children/*']\n")
	put(t, w.Root, member+"/children/child/package.json", `{"name":"child","private":true,"dependencies":{"exact":"^1"}}`)
	raw, err := os.ReadFile(filepath.Join(w.Root, "omniview/pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	docs, err := decodeDocuments(raw)
	if err != nil {
		t.Fatal(err)
	}
	main := docs[len(docs)-1]
	for _, key := range []string{"packages/consumer", "packages/consumer/children/child"} {
		mapping(main["importers"])[key] = map[string]any{
			"dependencies": map[string]any{"exact": map[string]any{"specifier": "^1", "version": "1.2.3"}},
		}
	}
	mapping(main["packages"])["exact@1.2.3"] = map[string]any{"resolution": map[string]any{"integrity": "sha512-enclosing"}}
	mapping(main["snapshots"])["exact@1.2.3"] = map[string]any{}
	raw, err = encodeDocuments(docs)
	if err != nil {
		t.Fatal(err)
	}
	put(t, w.Root, "omniview/pnpm-lock.yaml", string(raw))
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	docs, err = decodeDocuments(generated(t, p, "pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	importers := mapping(docs[len(docs)-1]["importers"])
	for _, key := range []string{member, member + "/children/child"} {
		if dependency := mapping(mapping(mapping(importers[key])["dependencies"])["exact"]); dependency["version"] != nil {
			t.Errorf("missing owner lock inherited enclosing pin for %s: %+v", key, dependency)
		}
	}
	if err := CheckInputs(p); err != nil {
		t.Fatal(err)
	}
	put(t, w.Root, member+"/pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages: {}\nsnapshots: {}\n")
	if err := CheckInputs(p); err == nil {
		t.Fatal("new authoritative lock did not invalidate first-resolution plan")
	}
}
