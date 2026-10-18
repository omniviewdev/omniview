package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// These tests deliberately use a tiny real module archive and git apply, not
// source assertions or a fake downloader. The full beta29 build is a separate
// parent integration gate.
func fixture(t *testing.T) (string, manifest, []byte) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "checkout with spaces")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(root, "module.zip")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(f)
	contents := map[string]string{"LICENSE": "fixture license\n", "go.mod": "module example.test/framework\n\ngo 1.20\n", "storage.go": "package storage\n\nconst Selected = false\n"}
	var records strings.Builder
	for _, name := range []string{"LICENSE", "go.mod", "storage.go"} {
		full := "example.test/framework@v1.0.0/" + name
		w, err := z.Create(full)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write([]byte(contents[name])); err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&records, "%x  %s\n", sha256.Sum256([]byte(contents[name])), full)
	}
	if err = z.Close(); err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(records.String()))
	modRecords := fmt.Sprintf("%x  go.mod\n", sha256.Sum256([]byte(contents["go.mod"])))
	modSum := sha256.Sum256([]byte(modRecords))
	patch := []byte("--- a/storage.go\n+++ b/storage.go\n@@ -1,3 +1,3 @@\n package storage\n \n-const Selected = false\n+const Selected = true\n--- /dev/null\n+++ b/new.go\n@@ -0,0 +1,2 @@\n+package storage\n+const Added = true\n")
	m := manifest{Schema: 1, Module: "example.test/framework", Version: "v1.0.0", Sum: "h1:" + base64.StdEncoding.EncodeToString(sum[:]), GoModSum: "h1:" + base64.StdEncoding.EncodeToString(modSum[:]), PatchSHA256: digest(patch), Files: []fileChange{{Path: "storage.go", Before: digest([]byte(contents["storage.go"])), After: digest([]byte("package storage\n\nconst Selected = true\n"))}, {Path: "new.go", After: digest([]byte("package storage\nconst Added = true\n"))}}}
	return archive, m, patch
}

// Removing patch application or dropping new files breaks the observable result.
func TestMaterializeAppliesNewFilesAndIsIdempotentWithSpaces(t *testing.T) {
	archive, m, patch := fixture(t)
	base := filepath.Join(filepath.Dir(archive), "tool source")
	first, err := materialize(archive, base, m, patch)
	if err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{"storage.go": "package storage\n\nconst Selected = true\n", "new.go": "package storage\nconst Added = true\n", "LICENSE": "fixture license\n"} {
		got, err := os.ReadFile(filepath.Join(first, name))
		if err != nil || string(got) != want {
			t.Fatalf("%s = %q, %v", name, got, err)
		}
	}
	info, err := os.Stat(filepath.Join(first, ".nativepatch.json"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := materialize(archive, base, m, patch)
	if err != nil || first != second {
		t.Fatalf("repeat = %q, %v", second, err)
	}
	after, err := os.Stat(filepath.Join(second, ".nativepatch.json"))
	if err != nil || !after.ModTime().Equal(info.ModTime()) {
		t.Fatal("repeat rewrote completed source")
	}
}

// Trusting a marker alone would incorrectly accept these corrupt states.
func TestMaterializeRefusesTamperedCompletedSource(t *testing.T) {
	for _, state := range []string{"changed", "missing", "extra", "symlink", "missing marker"} {
		t.Run(state, func(t *testing.T) {
			archive, m, patch := fixture(t)
			base := filepath.Join(filepath.Dir(archive), "toolsrc")
			source, err := materialize(archive, base, m, patch)
			if err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(source, "storage.go")
			switch state {
			case "changed":
				err = os.WriteFile(file, []byte("tampered"), 0600)
			case "missing":
				err = os.Remove(file)
			case "extra":
				err = os.WriteFile(filepath.Join(source, "injected.go"), []byte("package storage"), 0600)
			case "symlink":
				if err = os.Remove(file); err == nil {
					err = os.Symlink(filepath.Join(source, "LICENSE"), file)
				}
			case "missing marker":
				err = os.Remove(filepath.Join(source, ".nativepatch.json"))
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = materialize(archive, base, m, patch); err == nil {
				t.Fatal("accepted corrupt source")
			}
		})
	}
}

// Skipping either patch digest or exact before-image validation admits these.
func TestMaterializeRefusesTamperedPatchAndMissingPreimage(t *testing.T) {
	archive, m, patch := fixture(t)
	base := filepath.Join(filepath.Dir(archive), "toolsrc")
	if _, err := materialize(archive, base, m, append(patch, '\n')); err == nil {
		t.Fatal("accepted tampered patch")
	}
	m.Files[0].Path = "missing.go"
	if _, err := materialize(archive, base, m, patch); err == nil {
		t.Fatal("accepted missing preimage")
	}
	entries, err := os.ReadDir(base)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "wails-") {
			t.Fatal("published incomplete output")
		}
	}
}

// Download metadata is not proof: changing archived bytes must fail locally.
func TestMaterializeRefusesWrongModuleChecksum(t *testing.T) {
	archive, m, patch := fixture(t)
	m.Sum = "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	if _, err := materialize(archive, filepath.Join(filepath.Dir(archive), "toolsrc"), m, patch); err == nil {
		t.Fatal("accepted wrong archive checksum")
	}
}

// Relocating go.mod must not reinterpret current SDK relative replacements.
func TestHostModfilePreservesLocalSDKAndDoesNotChangeInput(t *testing.T) {
	root := filepath.Join(t.TempDir(), "host with spaces")
	if err := os.MkdirAll(filepath.Join(root, "sdk"), 0700); err != nil {
		t.Fatal(err)
	}
	input := []byte("module example.test/host\n\ngo 1.20\n\nrequire example.test/framework v1.0.0\nreplace github.com/omniviewdev/plugin-sdk => ./sdk\n")
	if err := os.WriteFile(filepath.Join(root, "go.mod"), input, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "go.sum"), []byte("retained checksum fixture\n"), 0600); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, ".local", "toolsrc", "framework source")
	output, err := hostModfile(root, filepath.Join(root, "go.mod"), source, "abc", "example.test/framework", "", filepath.Join(root, ".local", "toolsrc"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := runGo(root, "mod", "edit", "-json", "-modfile="+output)
	if err != nil {
		t.Fatal(err)
	}
	var parsed moduleJSON
	if err := decodeJSON(data, &parsed); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, replace := range parsed.Replace {
		got[replace.Old.Path] = replace.New.Path
	}
	if got["github.com/omniviewdev/plugin-sdk"] != filepath.Join(root, "sdk") {
		t.Fatalf("SDK replacement = %q", got)
	}
	if got["example.test/framework"] != source {
		t.Fatalf("framework replacement = %q", got)
	}
	original, _ := os.ReadFile(filepath.Join(root, "go.mod"))
	if string(original) != string(input) {
		t.Fatal("modified source go.mod")
	}
	sum, err := os.ReadFile(strings.TrimSuffix(output, ".mod") + ".sum")
	if err != nil || string(sum) != "retained checksum fixture\n" {
		t.Fatalf("sum = %q, %v", sum, err)
	}
}

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// A caller may explicitly reuse the generated effective modfile. This must
// preserve its SDK replacement and newly learned sums, not recursively drift.
func TestHostModfileCanUseItsOwnOutput(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/host\n\ngo 1.20\nreplace github.com/omniviewdev/plugin-sdk => ../sdk\n"), 0600); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, ".local", "toolsrc", "framework")
	first, err := hostModfile(root, filepath.Join(root, "go.mod"), source, "abc", "example.test/framework", "", filepath.Join(root, ".local", "toolsrc"))
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(first)
	if err != nil {
		t.Fatal(err)
	}
	sumPath := strings.TrimSuffix(first, ".mod") + ".sum"
	if err := os.WriteFile(sumPath, []byte("learned checksum\n"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(first)
	if err != nil {
		t.Fatal(err)
	}
	second, err := hostModfile(root, first, source, "abc", "example.test/framework", "", filepath.Join(root, ".local", "toolsrc"))
	if err != nil || first != second {
		t.Fatalf("repeat = %q, %v", second, err)
	}
	after, err := os.ReadFile(second)
	if err != nil || string(after) != string(before) {
		t.Fatalf("modfile drift: %q, %v", after, err)
	}
	afterInfo, err := os.Stat(second)
	if err != nil || !afterInfo.ModTime().Equal(info.ModTime()) {
		t.Fatal("rewrote identical effective modfile")
	}
	sum, err := os.ReadFile(sumPath)
	if err != nil || string(sum) != "learned checksum\n" {
		t.Fatalf("lost effective sums: %q, %v", sum, err)
	}
}

// A parent binding invocation can have host-only GOFLAGS. Bootstrap subprocesses
// must not inherit that selection, and preparing one must not mutate the parent.
func TestRunGoScopesHostModuleEnvironment(t *testing.T) {
	root := t.TempDir()
	t.Setenv("GOWORK", filepath.Join(root, "missing.work"))
	t.Setenv("GOFLAGS", "-modfile=/missing-host.mod")
	t.Setenv("GO_MODFILE", "/selected-host.mod")
	output, err := runGo(root, "env", "GOWORK", "GOFLAGS")
	if err != nil {
		t.Fatal(err)
	}
	if string(output) != "off\n\n" {
		t.Fatalf("subprocess inherited host selection: %q", output)
	}
	if os.Getenv("GOFLAGS") != "-modfile=/missing-host.mod" || os.Getenv("GO_MODFILE") != "/selected-host.mod" {
		t.Fatal("bootstrap changed parent process environment")
	}
}

// --no-index alone still discovers an enclosing checkout and skips patch paths
// outside its current repository-relative subtree. Exercise the actual layout,
// including a caller that already exported explicit Git repository selection.
func TestMaterializeInsideGitCheckoutIgnoresRepositoryDiscovery(t *testing.T) {
	for _, inherited := range []bool{false, true} {
		t.Run(fmt.Sprintf("inheritedGit=%t", inherited), func(t *testing.T) {
			archive, m, patch := fixture(t)
			root := filepath.Dir(archive)
			cmd := exec.Command("git", "init", "--quiet", root)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("git init: %v\n%s", err, output)
			}
			if inherited {
				t.Setenv("GIT_DIR", filepath.Join(root, ".git"))
				t.Setenv("GIT_WORK_TREE", root)
				t.Setenv("GIT_PREFIX", ".local/toolsrc/")
			}
			source, err := materialize(archive, filepath.Join(root, ".local", "toolsrc"), m, patch)
			if err != nil {
				t.Fatal(err)
			}
			for name, want := range map[string]string{"storage.go": "package storage\n\nconst Selected = true\n", "new.go": "package storage\nconst Added = true\n"} {
				got, err := os.ReadFile(filepath.Join(source, name))
				if err != nil || string(got) != want {
					t.Fatalf("%s = %q, %v", name, got, err)
				}
				if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
					t.Fatalf("patch escaped into checkout: %s, %v", name, err)
				}
			}
		})
	}
}

// An explicit companion source replaces only SDK selection, including an old
// version-specific replacement, while retaining all independent replacements.
func TestExplicitSDKSourceOverridesSelectionAndPreservesOtherModules(t *testing.T) {
	root := t.TempDir()
	sdk := filepath.Join(root, "companion sdk")
	if err := os.Mkdir(sdk, 0700); err != nil {
		t.Fatal(err)
	}
	sdkMod := []byte("module github.com/omniviewdev/plugin-sdk\n\ngo 1.20\n")
	if err := os.WriteFile(filepath.Join(sdk, "go.mod"), sdkMod, 0600); err != nil {
		t.Fatal(err)
	}
	selected, err := resolveSDKSource(sdk)
	if err != nil {
		t.Fatal(err)
	}
	wantSDK, err := filepath.EvalSymlinks(sdk)
	if err != nil {
		t.Fatal(err)
	}
	if selected != wantSDK {
		t.Fatalf("selected SDK = %q, want %q", selected, wantSDK)
	}
	input := []byte("module example.test/host\n\ngo 1.20\nrequire github.com/omniviewdev/plugin-sdk v0.5.0\nreplace github.com/omniviewdev/plugin-sdk v0.5.0 => ./old-sdk\nreplace github.com/omniviewdev/plugin-sdk => ./fallback-sdk\nreplace example.test/other => ./other\n")
	if err := os.WriteFile(filepath.Join(root, "go.mod"), input, 0600); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, ".local", "toolsrc", "framework")
	output, err := hostModfile(root, filepath.Join(root, "go.mod"), source, "abc", "example.test/framework", selected, filepath.Join(root, ".local", "toolsrc"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := runGo(root, "mod", "edit", "-json", "-modfile="+output)
	if err != nil {
		t.Fatal(err)
	}
	var parsed moduleJSON
	if err := decodeJSON(data, &parsed); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	sdkCount := 0
	for _, replace := range parsed.Replace {
		got[replace.Old.Path] = replace.New.Path
		if replace.Old.Path == "github.com/omniviewdev/plugin-sdk" {
			sdkCount++
			if replace.Old.Version != "" {
				t.Fatal("stale version-specific SDK replacement survived")
			}
		}
	}
	if sdkCount != 1 || got["github.com/omniviewdev/plugin-sdk"] != wantSDK {
		t.Fatalf("SDK selection = %v (count %d)", got, sdkCount)
	}
	if got["example.test/other"] != filepath.Join(root, "other") || got["example.test/framework"] != source {
		t.Fatalf("independent replacements changed: %v", got)
	}
	original, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil || string(original) != string(input) {
		t.Fatal("modified host source go.mod")
	}
	original, err = os.ReadFile(filepath.Join(sdk, "go.mod"))
	if err != nil || string(original) != string(sdkMod) {
		t.Fatal("modified SDK source go.mod")
	}
	generated, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	again, err := hostModfile(root, output, source, "abc", "example.test/framework", "", filepath.Join(root, ".local", "toolsrc"))
	if err != nil {
		t.Fatal(err)
	}
	preserved, err := os.ReadFile(again)
	if err != nil || string(preserved) != string(generated) {
		t.Fatalf("effective modfile changed when reusing SDK selection: %v\nbefore:\n%s\nafter:\n%s", err, generated, preserved)
	}
}

// Selecting a directory is not enough: its actual module must be the SDK.
func TestSDKSourceRejectsInvalidCompanionModules(t *testing.T) {
	if got, err := resolveSDKSource(""); err != nil || got != "" {
		t.Fatalf("absent optional selection = %q, %v", got, err)
	}
	if _, err := resolveSDKSource("relative/sdk"); err == nil {
		t.Fatal("accepted relative SDK source")
	}
	for _, state := range []string{"missing", "file", "no go.mod", "wrong module", "malformed go.mod"} {
		t.Run(state, func(t *testing.T) {
			sdk := filepath.Join(t.TempDir(), "sdk")
			switch state {
			case "file":
				if err := os.WriteFile(sdk, []byte("not a directory"), 0600); err != nil {
					t.Fatal(err)
				}
			case "no go.mod", "wrong module", "malformed go.mod":
				if err := os.Mkdir(sdk, 0700); err != nil {
					t.Fatal(err)
				}
				if state != "no go.mod" {
					data := "module example.test/not-sdk\n\ngo 1.20\n"
					if state == "malformed go.mod" {
						data = "module\n"
					}
					if err := os.WriteFile(filepath.Join(sdk, "go.mod"), []byte(data), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			if _, err := resolveSDKSource(sdk); err == nil {
				t.Fatalf("accepted %s SDK source", state)
			}
		})
	}
}

// Explicit output is a caller-prepared capability, not permission to adopt an
// arbitrary host tree. Every generated artifact must stay inside that boundary.
func TestExplicitOutputContainsSourceModfileAndOwnershipMarker(t *testing.T) {
	archive, m, patch := fixture(t)
	host := filepath.Dir(archive)
	if err := os.WriteFile(filepath.Join(host, "go.mod"), []byte("module example.test/host\n\ngo 1.20\n"), 0600); err != nil {
		t.Fatal(err)
	}
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	explicit := filepath.Join(parent, "private output with spaces")
	if err := os.Mkdir(explicit, 0700); err != nil {
		t.Fatal(err)
	}
	base, err := outputDirectory(host, explicit, m)
	if err != nil || base != explicit {
		t.Fatalf("output = %q, %v", base, err)
	}
	source, err := materialize(archive, base, m, patch)
	if err != nil {
		t.Fatal(err)
	}
	modfile, err := hostModfile(host, filepath.Join(host, "go.mod"), source, m.PatchSHA256, m.Module, "", base)
	if err != nil {
		t.Fatal(err)
	}
	if err := recordOutput(base, m); err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(modfile) != explicit || filepath.Dir(source) != explicit {
		t.Fatal("generated output escaped explicit directory")
	}
	if _, err := os.Stat(filepath.Join(host, ".local")); !os.IsNotExist(err) {
		t.Fatalf("created host output: %v", err)
	}
	if _, err := outputDirectory(host, explicit, m); err != nil {
		t.Fatalf("refused completed own output: %v", err)
	}
	info, err := os.Stat(filepath.Join(base, ".nativepatch-output.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := recordOutput(base, m); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(filepath.Join(base, ".nativepatch-output.json"))
	if err != nil || !after.ModTime().Equal(info.ModTime()) {
		t.Fatal("rewrote unchanged output marker")
	}
	if err := os.WriteFile(filepath.Join(base, "unowned"), []byte("sentinel"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := outputDirectory(host, explicit, m); err == nil {
		t.Fatal("adopted unrelated output file")
	}
	data, err := os.ReadFile(filepath.Join(base, "unowned"))
	if err != nil || string(data) != "sentinel" {
		t.Fatal("modified unowned file")
	}
}

func TestExplicitOutputRefusesAliasesPublicSpecialAndUnownedDirectories(t *testing.T) {
	_, m, _ := fixture(t)
	if got, err := outputDirectory("/host", "", m); err != nil || got != filepath.Join("/host", ".local", "toolsrc") {
		t.Fatalf("default changed: %q, %v", got, err)
	}
	if _, err := outputDirectory("/host", "relative", m); err == nil {
		t.Fatal("accepted relative output")
	}
	for _, state := range []string{"missing", "file", "symlink", "public", "unowned", "marker only", "noncanonical"} {
		t.Run(state, func(t *testing.T) {
			parent, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			output := filepath.Join(parent, "output")
			switch state {
			case "missing":
			case "file":
				if err := os.WriteFile(output, nil, 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				target := filepath.Join(parent, "real")
				if err := os.Mkdir(target, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, output); err != nil {
					t.Fatal(err)
				}
			default:
				if err := os.Mkdir(output, 0700); err != nil {
					t.Fatal(err)
				}
				switch state {
				case "public":
					if err := os.Chmod(output, 0755); err != nil {
						t.Fatal(err)
					}
				case "unowned":
					if err := os.WriteFile(filepath.Join(output, "sentinel"), nil, 0600); err != nil {
						t.Fatal(err)
					}
				case "marker only":
					if err := recordOutput(output, m); err != nil {
						t.Fatal(err)
					}
				case "noncanonical":
					output += string(filepath.Separator) + "."
				}
			}
			if _, err := outputDirectory("/host", output, m); err == nil {
				t.Fatalf("accepted %s output", state)
			}
		})
	}
}
