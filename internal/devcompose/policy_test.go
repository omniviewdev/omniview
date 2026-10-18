package devcompose

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestCompatibleCatalogsAndPatchPathsRetainTheirRepositoryMeaning(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "plugin-a/patches/exact.patch", "diff --git a/a b/a\n")
	put(t, w.Root, "plugin-a/ui/pnpm-workspace.yaml", "packages: ['widgets/*']\ncatalog:\n  exact: ^1\npatchedDependencies:\n  exact@1.2.3: ../patches/exact.patch\n")
	put(t, w.Root, "plugin-a/ui/pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters: {.: {}}\ncatalogs:\n  default:\n    exact: {specifier: ^1, version: 1.2.3}\npatchedDependencies:\n  exact@1.2.3: {hash: keep-patch-hash, path: ../patches/exact.patch}\npackages:\n  exact@1.2.3:\n    resolution: {integrity: sha512-preserved}\n    deprecated: 'Deprecated; see https://example.test/support for support.'\nsnapshots:\n  exact@1.2.3: {}\n")
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = CheckInputs(p); err != nil {
		t.Fatal(err)
	}
	var policy map[string]any
	if err = yaml.Unmarshal(generated(t, p, "pnpm-workspace.yaml"), &policy); err != nil {
		t.Fatal(err)
	}
	if mapping(policy["patchedDependencies"])["exact@1.2.3"] != "plugin-a/patches/exact.patch" {
		t.Fatal("patch resolved against aggregate instead of source config")
	}
	docs, err := decodeDocuments(generated(t, p, "pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	main := docs[len(docs)-1]
	locked := mapping(mapping(mapping(main["catalogs"])["default"])["exact"])
	if locked["version"] != "1.2.3" {
		t.Fatal("catalog selection lost")
	}
	patch := mapping(mapping(main["patchedDependencies"])["exact@1.2.3"])
	if patch["hash"] != "keep-patch-hash" || patch["path"] != "plugin-a/patches/exact.patch" {
		t.Fatal("locked patch provenance lost")
	}
	put(t, w.Root, "plugin-a/patches/exact.patch", "edited")
	if err = CheckInputs(p); err == nil {
		t.Fatal("patch edit accepted")
	}
}
func TestCredentialsHooksUnknownPoliciesAndDeniedBuildsFailClosed(t *testing.T) {
	for _, tc := range []struct{ name, path, data string }{
		{"credential", "plugin-a/ui/.npmrc", "//registry.example.test/:_authToken=never-print-this\n"},
		{"hook", "plugin-a/ui/.pnpmfile.cjs", "module.exports = {}"},
		{"unknown", "plugin-a/ui/pnpm-workspace.yaml", "futureUnsafePolicy: true\n"},
		{"peer suppression", "plugin-a/ui/pnpm-workspace.yaml", "peerDependencyRules: {allowAny: ['react']}\n"},
		{"build denial", "plugin-a/ui/pnpm-workspace.yaml", "allowBuilds: {esbuild: true}\nneverBuiltDependencies: [esbuild]\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, roots := fixture(t)
			put(t, w.Root, tc.path, tc.data)
			_, err := New(w, roots, nil)
			if err == nil {
				t.Fatal("unsafe source policy accepted")
			}
			if strings.Contains(err.Error(), "never-print-this") {
				t.Fatal("credential disclosed")
			}
		})
	}
}
func TestExportedTargetsUseSelectedWorkspacePackagesNotExternalLinks(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "omniview/packages/runtime/package.json", `{"name":"@test/runtime","version":"1.2.3"}`)
	p, err := New(w, roots, map[string]string{"@test/runtime": filepath.Join(w.Root, "omniview/packages/runtime")})
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err = json.Unmarshal(generated(t, p, "package.json"), &manifest); err != nil {
		t.Fatal(err)
	}
	if mapping(manifest["dependencies"])["@test/runtime"] != "workspace:*" {
		t.Fatal("target not mapped through native workspace")
	}
	put(t, w.Root, "plugin-b/ui/widgets/copy/package.json", `{"name":"@test/runtime","version":"1.2.3","private":true}`)
	if _, err = New(w, roots, p.Targets); err == nil {
		t.Fatal("ambiguous exported target accepted")
	}
}
func TestConflictingRegistryRecordsRefuseWithoutChangingSelection(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "plugin-a/ui/pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters: {.: {}}\npackages:\n  react@19.2.4: {resolution: {integrity: sha512-conflicting}}\nsnapshots: {}\n")
	if _, err := New(w, roots, nil); err == nil {
		t.Fatal("conflicting integrity accepted")
	}
}
func TestFirstResolutionDoesNotInventFrozenRegistryVersions(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "omniview/package.json", `{"name":"host","private":true,"packageManager":"pnpm@12.14.0"}`)
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err = json.Unmarshal(generated(t, p, "package.json"), &manifest); err != nil {
		t.Fatal(err)
	}
	if mapping(manifest["dependencies"])["react"] != nil {
		t.Fatal("invented provider outside host manifest")
	}
}

func TestAbsentSourceLockDoesNotInventExactProviderRecords(t *testing.T) {
	w, roots := fixture(t)
	if err := os.Remove(filepath.Join(w.Root, "omniview/pnpm-lock.yaml")); err != nil {
		t.Fatal(err)
	}
	put(t, w.Root, "omniview/package.json", `{"name":"host","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"19.2.4"}}`)
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	docs, err := decodeDocuments(generated(t, p, "pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	main := docs[len(docs)-1]
	if mapping(mapping(mapping(main["importers"])["."])["dependencies"])["react"] != nil {
		t.Fatal("fabricated frozen React record without source lock")
	}
	if len(mapping(main["packages"])) != 0 {
		t.Fatal("fabricated registry resolution")
	}
}

func TestCredentialBearingLockImporterIsNeverCopiedIntoAggregate(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "plugin-a/ui/pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      private: {specifier: 'https://user:never-copy-me@registry.example.test/private.tgz', version: 'https://user:never-copy-me@registry.example.test/private.tgz'}\npackages: {}\nsnapshots: {}\n")
	_, err := New(w, roots, nil)
	if err == nil {
		t.Fatal("credential-bearing source lock copied")
	}
	if strings.Contains(err.Error(), "never-copy-me") {
		t.Fatal("lock credential disclosed")
	}
}

func TestHostProviderRequiresActualLockedRegistryIntegrity(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "omniview/pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      react: {specifier: ^19, version: 19.2.4}\npackages:\n  react@19.2.4: {}\nsnapshots: {}\n")
	if _, err := New(w, roots, nil); err == nil {
		t.Fatal("provider version without locked integrity accepted")
	}
}

func TestNestedMixedPackageManagerPinRefusesBeforeAnyAggregateWrite(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "plugin-b/ui/widgets/legacy/package.json", `{"name":"legacy","private":true,"packageManager":"pnpm@10.34.7"}`)
	if _, err := New(w, roots, nil); err == nil {
		t.Fatal("nested legacy package manager accepted")
	}
	if _, err := os.Stat(filepath.Join(w.Root, "package.json")); !os.IsNotExist(err) {
		t.Fatal("mixed-manager refusal mutated aggregate")
	}
}

func TestEquivalentJSONAndYAMLReleaseAgePoliciesCompose(t *testing.T) {
	w, roots := fixture(t)
	put(t, w.Root, "plugin-a/ui/package.json", `{"name":"plugin-ui","private":true,"pnpm":{"minimumReleaseAge":0}}`)
	if _, err := New(w, roots, nil); err != nil {
		t.Fatal(err)
	}
}

func TestBuildApprovalsComposeAsPermissionIntersection(t *testing.T) {
	for _, tc := range []struct{ name, host, plugin string }{
		{"plugin denial", "true", "false"},
		{"host denial", "false", "true"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, roots := fixture(t)
			put(t, w.Root, "omniview/pnpm-workspace.yaml", "packages: ['packages/*']\nallowBuilds: {esbuild: "+tc.host+"}\n")
			put(t, w.Root, "plugin-a/ui/pnpm-workspace.yaml", "packages: ['widgets/*']\nallowBuilds: {esbuild: "+tc.plugin+"}\n")
			p, err := New(w, roots, nil)
			if err != nil {
				t.Fatal(err)
			}
			var policy map[string]any
			if err = yaml.Unmarshal(generated(t, p, "pnpm-workspace.yaml"), &policy); err != nil {
				t.Fatal(err)
			}
			if mapping(policy["allowBuilds"])["esbuild"] != false {
				t.Fatal("one source's approval overrode another source's build denial")
			}
		})
	}
}
