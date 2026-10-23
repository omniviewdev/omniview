package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/scripts/internal/hostmodtest"
)

func canonicalTempDir(t *testing.T) string {
	t.Helper()
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return directory
}

func privateArtifact(t *testing.T, path, content string) {
	t.Helper()
	if _, err := devsession.EnsurePrivateDirectory(filepath.Dir(path)); err != nil {
		t.Fatal(err)
	}
	if err := devsession.WritePrivateFile(path, []byte(content)); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(path, 0500); err != nil {
			t.Fatal(err)
		}
	}
}
func cacheFixture(t *testing.T) string {
	t.Helper()
	root := filepath.Join(canonicalTempDir(t), "private cache with spaces")
	if err := createCacheNamespace(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestCacheNamespaceNeverAdoptsUnknownOrRedirectedDirectory(t *testing.T) {
	for _, kind := range []string{"unknown", "symlink", "public"} {
		t.Run(kind, func(t *testing.T) {
			if runtime.GOOS == "windows" && kind != "unknown" {
				t.Skip("Unix symlink/mode fixture")
			}
			root := filepath.Join(canonicalTempDir(t), "cache")
			if kind == "public" {
				if err := createCacheNamespace(context.Background(), root); err != nil {
					t.Fatal(err)
				}
				if err := os.Chmod(root, 0755); err != nil {
					t.Fatal(err)
				}
			} else {
				target := root
				if kind == "symlink" {
					target = filepath.Join(canonicalTempDir(t), "foreign")
				}
				sourceFile(t, filepath.Join(target, "preserve"), "foreign bytes")
				if kind == "symlink" {
					if err := os.Symlink(target, root); err != nil {
						t.Fatal(err)
					}
				}
			}
			if err := createCacheNamespace(context.Background(), root); err == nil {
				t.Fatal("foreign/public cache was adopted")
			}
			if kind != "public" {
				if raw, err := os.ReadFile(filepath.Join(root, "preserve")); err != nil || string(raw) != "foreign bytes" {
					t.Fatalf("foreign bytes changed: %v", err)
				}
			}
			if kind == "public" {
				if info, err := os.Stat(root); err != nil || info.Mode().Perm() != 0755 {
					t.Fatalf("public mode was repaired: %v", err)
				}
			}
		})
	}
}

func TestReadOnlyDirectoryValidationRejectsAliasWithoutRepair(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix mode/symlink fixture")
	}
	parent := canonicalTempDir(t)
	directory := filepath.Join(parent, "private")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := devsession.ValidatePrivateDirectory(directory); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(parent, "alias")
	if err := os.Symlink(directory, alias); err != nil {
		t.Fatal(err)
	}
	if err := devsession.ValidatePrivateDirectory(alias); err == nil {
		t.Fatal("alias accepted")
	}
	if err := os.Chmod(directory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := devsession.ValidatePrivateDirectory(directory); err == nil {
		t.Fatal("public directory accepted")
	}
	if info, err := os.Stat(directory); err != nil || info.Mode().Perm() != 0755 {
		t.Fatalf("directory was repaired: %v", err)
	}
}

func TestInputCacheRejectsExistingUnownedBytes(t *testing.T) {
	cache := cacheFixture(t)
	key := strings.Repeat("a", 64)
	target := filepath.Join(cache, key)
	sourceFile(t, filepath.Join(target, "preserve"), "unowned input bytes")
	selected := selectedInputs{root: canonicalTempDir(t), sourceModfile: "source.mod", module: []byte(testHostModule)}
	if _, _, err := claimInputs(cache, key, selected); err == nil {
		t.Fatal("unknown input cache adopted")
	}
	if raw, err := os.ReadFile(filepath.Join(target, "preserve")); err != nil || string(raw) != "unowned input bytes" {
		t.Fatalf("unknown input changed: %v", err)
	}
}

func TestPublishedCLIContentIdentityNeverOverwritesExistingArtifact(t *testing.T) {
	root := filepath.Join(cacheFixture(t), "artifacts")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	stage := filepath.Join(canonicalTempDir(t), "staged tool")
	privateArtifact(t, stage, "first immutable artifact")
	first, err := publishArtifact(root, stage, "selected-input")
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(first)
	if err != nil {
		t.Fatal(err)
	}
	same := filepath.Join(canonicalTempDir(t), "same staged tool")
	privateArtifact(t, same, "first immutable artifact")
	reused, err := publishArtifact(root, same, "selected-input")
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(first)
	if err != nil {
		t.Fatal(err)
	}
	if first != reused || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("existing immutable executable was replaced")
	}
	different := filepath.Join(canonicalTempDir(t), "different staged tool")
	privateArtifact(t, different, "second immutable artifact")
	second, err := publishArtifact(root, different, "selected-input")
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("changed contents reused an old executable path")
	}
	if raw, err := os.ReadFile(first); err != nil || string(raw) != "first immutable artifact" {
		t.Fatalf("retained executable changed: %v", err)
	}
}

func TestTamperedAndIncompletePublishedArtifactsAreRefusedPreservingBytes(t *testing.T) {
	for _, kind := range []string{"tampered", "incomplete", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			if runtime.GOOS == "windows" && kind == "symlink" {
				t.Skip("optional symlink privileges")
			}
			root := filepath.Join(cacheFixture(t), "artifacts")
			if err := os.Mkdir(root, 0700); err != nil {
				t.Fatal(err)
			}
			stage := filepath.Join(canonicalTempDir(t), "tool")
			privateArtifact(t, stage, "approved artifact")
			digest, err := hashPrivateFile(stage)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "incomplete" {
				target := filepath.Join(root, digest)
				sourceFile(t, filepath.Join(target, "preserve"), "unknown artifact bytes")
				if _, err := publishArtifact(root, stage, "input"); err == nil {
					t.Fatal("incomplete artifact adopted")
				}
				if raw, err := os.ReadFile(filepath.Join(target, "preserve")); err != nil || string(raw) != "unknown artifact bytes" {
					t.Fatalf("unknown artifact changed: %v", err)
				}
				return
			}
			published, err := publishArtifact(root, stage, "input")
			if err != nil {
				t.Fatal(err)
			}
			// A new compilation owns a different staging inode than the published link.
			if err := os.Remove(stage); err != nil {
				t.Fatal(err)
			}
			privateArtifact(t, stage, "approved artifact")
			if kind == "tampered" {
				if err := os.Chmod(published, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(published, []byte("human-modified artifact"), 0600); err != nil {
					t.Fatal(err)
				}
				if _, err := publishArtifact(root, stage, "input"); err == nil {
					t.Fatal("tampered artifact accepted")
				}
				if raw, err := os.ReadFile(published); err != nil || string(raw) != "human-modified artifact" {
					t.Fatalf("tampered artifact was overwritten: %v", err)
				}
			} else {
				foreign := filepath.Join(canonicalTempDir(t), "foreign tool")
				privateArtifact(t, foreign, "foreign executable bytes")
				if err := os.Remove(published); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(foreign, published); err != nil {
					t.Fatal(err)
				}
				if _, err := publishArtifact(root, stage, "input"); err == nil {
					t.Fatal("symlink artifact accepted")
				}
				if raw, err := os.ReadFile(foreign); err != nil || string(raw) != "foreign executable bytes" {
					t.Fatalf("foreign executable changed: %v", err)
				}
			}
		})
	}
}

func TestBuildModuleCloneCannotMutateHostTemplateSums(t *testing.T) {
	host := filepath.Join(canonicalTempDir(t), "host-module")
	module := filepath.Join(host, "host.mod")
	if _, err := devsession.EnsurePrivateDirectory(host); err != nil {
		t.Fatal(err)
	}
	if err := devsession.WritePrivateFile(module, []byte(testHostModule)); err != nil {
		t.Fatal(err)
	}
	if err := devsession.WritePrivateFile(filepath.Join(host, "host.sum"), []byte("immutable host sum\n")); err != nil {
		t.Fatal(err)
	}
	stage := canonicalTempDir(t)
	if _, err := devsession.EnsurePrivateDirectory(stage); err != nil {
		t.Fatal(err)
	}
	cloned, err := cloneBuildModule(module, stage)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(strings.TrimSuffix(cloned, ".mod")+".sum", []byte("build-owned updated sum\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cloned, []byte(testHostModule+"\n// build-owned change\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if raw, err := os.ReadFile(module); err != nil || string(raw) != testHostModule {
		t.Fatalf("host module template mutated: %v", err)
	}
	if raw, err := os.ReadFile(filepath.Join(host, "host.sum")); err != nil || string(raw) != "immutable host sum\n" {
		t.Fatalf("host sum template mutated: %v", err)
	}
}

func TestBuildStageCleanupNeverDeletesReplacementDirectory(t *testing.T) {
	parent := canonicalTempDir(t)
	stage := filepath.Join(parent, "build-stage")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	original, err := os.Lstat(stage)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(stage, stage+"-original"); err != nil {
		t.Fatal(err)
	}
	sourceFile(t, filepath.Join(stage, "preserve"), "foreign replacement bytes")
	if err := removeBuildStage(stage, original); err == nil {
		t.Fatal("replacement stage deleted")
	}
	if raw, err := os.ReadFile(filepath.Join(stage, "preserve")); err != nil || string(raw) != "foreign replacement bytes" {
		t.Fatalf("replacement bytes changed: %v", err)
	}
}

func TestCacheLocationsCannotOverlapSourcesOrProductionProfiles(t *testing.T) {
	host, _ := selectedWorkspace(t)
	selected, err := selectInputs(inputOptions{root: host})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Join(host, ".local", "cache"), filepath.Join(selected.sdkSource, "cache"), filepath.Join(os.Getenv("HOME"), ".omniview", "cache"), filepath.Join(selected.workspaceRoot, ".local", "cache")} {
		if _, err := validateCacheLocation(path, selected, true); err == nil {
			t.Fatalf("unsafe tool cache accepted: %s", path)
		}
		if _, err := os.Lstat(path); !os.IsNotExist(err) {
			t.Fatalf("validation created unsafe cache: %v", err)
		}
	}
	runtimeCache := filepath.Join(selected.profileRoot, "runtime", "go-build")
	if _, err := validateCacheLocation(runtimeCache, selected, false); err != nil {
		t.Fatalf("explicit managed runtime cache rejected: %v", err)
	}
	if _, err := validateCacheLocation(runtimeCache, selected, true); err == nil {
		t.Fatal("global immutable tool artifacts placed inside removable workspace profile")
	}
}

func TestGoEnvironmentIsScopedAndCannotInheritWorkspaceModuleFlags(t *testing.T) {
	t.Setenv("GOWORK", "foreign.work")
	t.Setenv("GOFLAGS", "-modfile=foreign.mod -tags=mcp")
	t.Setenv("GO_MODFILE", "foreign.mod")
	environment := goEnvironment("/outside/go-cache", "/outside/build-temp")
	values := map[string]string{}
	for _, entry := range environment {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	if values["GOWORK"] != "off" || values["GOFLAGS"] != "" || values["GO_MODFILE"] != "" || values["GO111MODULE"] != "on" {
		t.Fatal("child Go environment retained foreign module selection")
	}
	if values["GOCACHE"] != "/outside/go-cache" || values["GOTMPDIR"] != "/outside/build-temp" {
		t.Fatal("owned Go cache/temp scope lost")
	}
	if os.Getenv("GOWORK") != "foreign.work" || os.Getenv("GOFLAGS") != "-modfile=foreign.mod -tags=mcp" || os.Getenv("GO_MODFILE") != "foreign.mod" {
		t.Fatal("parent environment was mutated")
	}
}

func TestHostInputKeyTracksHelperAndModuleInputs(t *testing.T) {
	cases := []struct {
		name   string
		file   string
		change func(*selectedInputs)
	}{
		{name: "bootstrap implementation", file: "main.go"},
		{name: "host module", change: func(selected *selectedInputs) {
			selected.module = append(selected.module, []byte("// changed host requirement\n")...)
		}},
		{name: "root Wails version authority", change: func(selected *selectedInputs) { selected.rootModule = []byte("changed root pin") }},
		{name: "root Wails checksum authority", change: func(selected *selectedInputs) { selected.rootSum = []byte("changed root checksum") }},
		{name: "SDK module", change: func(selected *selectedInputs) {
			selected.sdkModule = append(selected.sdkModule, []byte("// changed SDK requirement\n")...)
		}},
		{name: "sum existence", change: func(selected *selectedInputs) { selected.sumExists = true }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			root := canonicalTempDir(t)
			hostRoot := filepath.Join(root, "scripts", "hostmod")
			if err := os.MkdirAll(hostRoot, 0700); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"main.go"} {
				if err := os.WriteFile(filepath.Join(hostRoot, filepath.FromSlash(name)), []byte("original artifact bytes\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			selected := selectedInputs{root: root, sourceModfile: filepath.Join(root, "go.mod"), module: []byte("module " + hostModulePath + "\n"), sdkSource: filepath.Join(root, "sdk"), sdkModule: []byte("module " + sdkModulePath + "\n")}
			original, err := hostInputKey(selected)
			if err != nil {
				t.Fatal(err)
			}
			stable, err := hostInputKey(selected)
			if err != nil || stable != original {
				t.Fatalf("unchanged input key: %q %v", stable, err)
			}
			if test.file != "" {
				if err := os.WriteFile(filepath.Join(hostRoot, filepath.FromSlash(test.file)), []byte("changed artifact bytes\n"), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				test.change(&selected)
			}
			changed, err := hostInputKey(selected)
			if err != nil {
				t.Fatal(err)
			}
			if changed == original {
				t.Fatal("changed helper/module input reused the old cache key")
			}
		})
	}
}

func TestConcurrentFirstCacheNamespacePublication(t *testing.T) {
	root := filepath.Join(canonicalTempDir(t), "concurrent private namespace")
	const callers = 16
	start := make(chan struct{})
	results := make(chan error, callers)
	for range callers {
		go func() { <-start; results <- createCacheNamespace(context.Background(), root) }()
	}
	close(start)
	for range callers {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	var owner namespaceOwner
	if err := devsession.ReadPrivateJSON(filepath.Join(root, ".owner.json"), &owner); err != nil {
		t.Fatal(err)
	}
	if owner != (namespaceOwner{SchemaVersion: 1, Kind: cacheKind}) {
		t.Fatalf("namespace owner: %#v", owner)
	}
	if err := devsession.ValidatePrivateDirectory(root); err != nil {
		t.Fatal(err)
	}
}

func TestFreshInputClaimRollbackAllowsCleanPreparationRetry(t *testing.T) {
	root := cacheFixture(t)
	selected := selectedInputs{root: filepath.Join(canonicalTempDir(t), "host"), module: []byte("module " + hostModulePath + "\n")}
	key := digestBytes([]byte("recoverable input"))
	paths, fresh, err := claimInputs(root, key, selected)
	if err != nil || !fresh {
		t.Fatalf("fresh input claim: %v %v", fresh, err)
	}
	if err := writeNewBytes(filepath.Join(paths.host, "partial-preparation"), []byte("incomplete owned module preparation")); err != nil {
		t.Fatal(err)
	}
	if err := removeBuildStage(paths.directory, paths.initialDirectory); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(paths.directory); !os.IsNotExist(err) {
		t.Fatalf("failed fresh claim remains: %v", err)
	}
	retry, fresh, err := claimInputs(root, key, selected)
	if err != nil || !fresh {
		t.Fatalf("clean retry: %v %v", fresh, err)
	}
	if _, err := os.Lstat(filepath.Join(retry.host, "partial-preparation")); !os.IsNotExist(err) {
		t.Fatalf("partial module bytes survived rollback: %v", err)
	}
}

func TestCachedHostPreparationRefusesTamperedTemplatesBeforeHelperCanRewrite(t *testing.T) {
	for _, suffix := range []string{".mod", ".sum"} {
		t.Run(suffix, func(t *testing.T) {
			host := canonicalTempDir(t)
			hostmodtest.Root(t, host)
			module, err := os.ReadFile(filepath.Join(host, "go.mod"))
			if err != nil {
				t.Fatal(err)
			}
			sum, err := os.ReadFile(filepath.Join(host, "go.sum"))
			if err != nil {
				t.Fatal(err)
			}
			helper, err := os.ReadFile(filepath.Join("..", "hostmod", "main.go"))
			if err != nil {
				t.Fatal(err)
			}
			sourceFile(t, filepath.Join(host, "scripts", "hostmod", "main.go"), string(helper))
			selected := selectedInputs{root: host, sourceModfile: filepath.Join(host, "go.mod"), module: module, sum: sum, sumExists: true, rootModule: module, rootSum: sum, rootSumExists: true}
			key, err := hostInputKey(selected)
			if err != nil {
				t.Fatal(err)
			}
			paths, fresh, err := claimInputs(cacheFixture(t), key, selected)
			if err != nil || !fresh {
				t.Fatalf("claim inputs: %v %v", fresh, err)
			}
			environment := goEnvironment(os.Getenv("GOCACHE"), "")
			prepared, err := prepareHost(context.Background(), paths, fresh, selected, environment, os.Stderr)
			if err != nil {
				t.Fatal(err)
			}
			reused, err := prepareHost(context.Background(), paths, false, selected, environment, os.Stderr)
			if err != nil || reused != prepared {
				t.Fatalf("unchanged reuse: %#v %v", reused, err)
			}
			path := strings.TrimSuffix(prepared.Modfile, ".mod") + suffix
			if err := os.WriteFile(path, []byte("human-modified module bytes\n"), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := prepareHost(context.Background(), paths, false, selected, environment, os.Stderr); err == nil {
				t.Fatal("tampered template accepted")
			}
			if raw, _ := os.ReadFile(path); string(raw) != "human-modified module bytes\n" {
				t.Fatal("tampered bytes were silently repaired")
			}
		})
	}
}
