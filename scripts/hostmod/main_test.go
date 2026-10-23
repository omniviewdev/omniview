package main

import (
	"bytes"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/scripts/internal/hostmodtest"
)

const stockRequirement = "require " + hostmodtest.WailsModule + " " + hostmodtest.WailsVersion + "\n"

func fixture(t *testing.T) (string, string) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "private output")
	if err := os.Mkdir(output, 0700); err != nil {
		t.Fatal(err)
	}
	hostmodtest.Root(t, root)
	return root, output
}
func put(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}
func TestPreparePreservesSelectedSDKAndRebasesOtherReplacements(t *testing.T) {
	root, output := fixture(t)
	sdk := filepath.Join(root, "sdk")
	put(t, filepath.Join(sdk, "go.mod"), "module "+sdkModule+"\n\ngo 1.20\n")
	input := filepath.Join(root, "inputs", "alternate.mod")
	original := "module github.com/omniviewdev/omniview\n\ngo 1.20\n" + stockRequirement + "require " + sdkModule + " v0.5.0\nreplace " + sdkModule + " v0.5.0 => ./sdk\nreplace example.com/local => ./local\nreplace example.com/remote => example.com/alternate v1.2.3\n"
	put(t, input, original)
	expectedSum, err := os.ReadFile(filepath.Join(root, "go.sum"))
	if err != nil {
		t.Fatal(err)
	}
	put(t, strings.TrimSuffix(input, ".mod")+".sum", string(expectedSum))
	modfile, err := prepare(root, input, sdk, output)
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(modfile) || filepath.Dir(modfile) != output {
		t.Fatalf("escaped private output: %s", modfile)
	}
	raw, err := runGo(root, "mod", "edit", "-json", "-modfile="+modfile)
	if err != nil {
		t.Fatal(err)
	}
	var parsed moduleJSON
	if err := decodeJSON(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	found := map[string]moduleVersion{}
	for _, r := range parsed.Replace {
		found[r.Old.Path] = r.New
	}
	if found[sdkModule].Path != sdk || found[sdkModule].Version != "" {
		t.Fatalf("SDK changed: %#v", found[sdkModule])
	}
	if found["example.com/local"].Path != filepath.Join(root, "local") {
		t.Fatalf("relative replacement not rebased: %#v", found)
	}
	if found["example.com/remote"] != (moduleVersion{Path: "example.com/alternate", Version: "v1.2.3"}) {
		t.Fatalf("remote replacement changed: %#v", found)
	}
	if raw, _ := os.ReadFile(input); string(raw) != original {
		t.Fatal("source input mutated")
	}
	if raw, _ := os.ReadFile(strings.TrimSuffix(modfile, ".mod") + ".sum"); !bytes.Equal(raw, expectedSum) {
		t.Fatal("input sum lost")
	}
}
func TestPrepareRefusesFrameworkReplacementAndConflictingSDK(t *testing.T) {
	for _, replacement := range []string{
		"replace github.com/wailsapp/wails/v3 => ./framework\n",
		"replace github.com/wailsapp/wails/v3 v3.0.0-beta.29 => example.com/fork v1.0.0\n",
		"replace " + sdkModule + " => ./other-sdk\n",
		"replace " + sdkModule + " v0.5.0 => example.com/sdk v0.5.0\n",
	} {
		t.Run(replacement, func(t *testing.T) {
			root, output := fixture(t)
			sdk := filepath.Join(root, "sdk")
			put(t, filepath.Join(sdk, "go.mod"), "module "+sdkModule+"\n")
			put(t, filepath.Join(root, "other-sdk", "go.mod"), "module "+sdkModule+"\n")
			input := filepath.Join(root, "go.mod")
			put(t, input, "module github.com/omniviewdev/omniview\n"+stockRequirement+"require "+sdkModule+" v0.5.0\n"+replacement)
			if _, err := prepare(root, input, sdk, output); err == nil {
				t.Fatal("conflicting dependency selection accepted")
			}
			entries, err := os.ReadDir(output)
			if err != nil || len(entries) != 0 {
				t.Fatalf("refusal changed output: %v %v", entries, err)
			}
		})
	}
}
func TestPrepareVerifiesImplicitSDKModuleIdentity(t *testing.T) {
	root, output := fixture(t)
	put(t, filepath.Join(root, "sdk", "go.mod"), "module example.com/not-sdk\n")
	input := filepath.Join(root, "go.mod")
	put(t, input, "module github.com/omniviewdev/omniview\n"+stockRequirement+"require "+sdkModule+" v0.5.0\nreplace "+sdkModule+" => ./sdk\n")
	if _, err := prepare(root, input, "", output); err == nil {
		t.Fatal("incorrect selected SDK identity accepted")
	}
}
func TestPrepareRefusesUnknownRedirectedAndPublicOutputWithoutRepair(t *testing.T) {
	for _, kind := range []string{"unknown", "symlink", "public", "output symlink", "output public"} {
		t.Run(kind, func(t *testing.T) {
			if runtime.GOOS == "windows" && kind != "unknown" {
				t.Skip("Unix permissions and symlinks")
			}
			root, output := fixture(t)
			input := filepath.Join(root, "go.mod")
			put(t, input, "module github.com/omniviewdev/omniview\n\ngo 1.20\n"+stockRequirement)
			if kind == "unknown" {
				put(t, filepath.Join(output, "preserve"), "foreign bytes")
			} else if kind == "symlink" {
				alias := filepath.Join(root, "alias")
				if err := os.Symlink(output, alias); err != nil {
					t.Fatal(err)
				}
				output = alias
			} else if kind == "public" {
				if err := os.Chmod(output, 0755); err != nil {
					t.Fatal(err)
				}
			} else {
				modfile, err := prepare(root, input, "", output)
				if err != nil {
					t.Fatal(err)
				}
				if kind == "output symlink" {
					if err := os.Remove(modfile); err != nil {
						t.Fatal(err)
					}
					if err := os.Symlink(input, modfile); err != nil {
						t.Fatal(err)
					}
				} else if err := os.Chmod(modfile, 0644); err != nil {
					t.Fatal(err)
				}
			}
			before, _ := os.ReadFile(input)
			if _, err := prepare(root, input, "", output); err == nil {
				t.Fatal("unsafe output adopted")
			}
			after, _ := os.ReadFile(input)
			if !bytes.Equal(before, after) {
				t.Fatal("source changed through rejected output")
			}
			if kind == "unknown" {
				if raw, _ := os.ReadFile(filepath.Join(output, "preserve")); string(raw) != "foreign bytes" {
					t.Fatal("unknown output overwritten")
				}
			}
		})
	}
}

func TestPrepareRejectsAlternateAndMVSSelectedUnapprovedWails(t *testing.T) {
	for _, kind := range []string{"alternate pin", "transitive bump", "checksum"} {
		t.Run(kind, func(t *testing.T) {
			root, output := fixture(t)
			input := filepath.Join(root, "selected.mod")
			body := "module github.com/omniviewdev/omniview\n\ngo 1.20\n" + stockRequirement
			if kind == "alternate pin" {
				body = strings.Replace(body, hostmodtest.WailsVersion, "v3.0.0-beta.29", 1)
			} else if kind == "transitive bump" {
				proxy, err := url.Parse(os.Getenv("GOPROXY"))
				if err != nil {
					t.Fatal(err)
				}
				proxyPath := filepath.FromSlash(proxy.Path)
				if runtime.GOOS == "windows" {
					proxyPath = strings.TrimPrefix(proxyPath, string(filepath.Separator))
				}
				hostmodtest.Module(t, proxyPath, wailsModule, "v3.0.0-beta.35", "module "+wailsModule+"\n\ngo 1.20\n")
				put(t, filepath.Join(root, "booster", "go.mod"), "module example.com/booster\n\ngo 1.20\nrequire "+wailsModule+" v3.0.0-beta.35\n")
				body += "require example.com/booster v1.0.0\nreplace example.com/booster => ./booster\n"
			} else {
				sum, err := os.ReadFile(filepath.Join(root, "go.sum"))
				if err != nil {
					t.Fatal(err)
				}
				fields := strings.Fields(strings.SplitN(string(sum), "\n", 2)[0])
				put(t, filepath.Join(root, "go.sum"), strings.Replace(string(sum), fields[2], "h1:"+strings.Repeat("A", 43)+"=", 1))
			}
			put(t, input, body)
			original, _ := os.ReadFile(input)
			_, failure := prepare(root, input, "", output)
			expected := "approved Wails version"
			if kind == "transitive bump" {
				expected = "effective Wails graph"
			}
			if kind == "checksum" {
				expected = "checksum mismatch"
			}
			if failure == nil || !strings.Contains(strings.ToLower(failure.Error()), strings.ToLower(expected)) {
				t.Fatalf("expected %q refusal, got %v", expected, failure)
			}
			if raw, _ := os.ReadFile(input); !bytes.Equal(raw, original) {
				t.Fatal("refusal modified input")
			}
			entries, err := os.ReadDir(output)
			if err != nil || len(entries) != 0 {
				t.Fatalf("refusal published output: %v %v", entries, err)
			}
		})
	}
}

func TestPrepareNormalizesSDKAcrossTransitiveVersionSelection(t *testing.T) {
	for _, mapping := range []string{"same source", "foreign source", "remote source"} {
		t.Run(mapping, func(t *testing.T) {
			root, output := fixture(t)
			sdk := filepath.Join(root, "sdk")
			put(t, filepath.Join(sdk, "go.mod"), "module "+sdkModule+"\n\ngo 1.20\n")
			put(t, filepath.Join(root, "foreign", "go.mod"), "module "+sdkModule+"\n\ngo 1.20\n")
			put(t, filepath.Join(root, "booster", "go.mod"), "module example.com/booster\n\ngo 1.20\nrequire "+sdkModule+" v0.6.0\n")
			target := "./sdk"
			if mapping == "foreign source" {
				target = "./foreign"
			}
			if mapping == "remote source" {
				target = "example.com/foreign v0.6.0"
			}
			input := filepath.Join(root, "selected.mod")
			put(t, input, "module github.com/omniviewdev/omniview\n\ngo 1.20\n"+stockRequirement+"require (\n"+sdkModule+" v0.5.0\nexample.com/booster v1.0.0\n)\nreplace example.com/booster => ./booster\nreplace "+sdkModule+" => ./sdk\nreplace "+sdkModule+" v0.6.0 => "+target+"\n")
			prepared, err := prepare(root, input, sdk, output)
			if mapping != "same source" {
				if err == nil || !strings.Contains(err.Error(), "SDK replacement conflicts") {
					t.Fatalf("contradictory versioned selection accepted: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := parseModule(root, prepared)
			if err != nil {
				t.Fatal(err)
			}
			count := 0
			for _, replacement := range parsed.Replace {
				if replacement.Old.Path == sdkModule {
					count++
					if replacement.Old.Version != "" || replacement.New.Path != sdk {
						t.Fatalf("SDK override not normalized: %#v", replacement)
					}
				}
			}
			if count != 1 {
				t.Fatalf("SDK replacement count: %d", count)
			}
			raw, err := runGo(root, "list", "-mod=mod", "-modfile="+prepared, "-m", "-json", "all")
			if err != nil {
				t.Fatal(err)
			}
			type selectedModule struct {
				Path, Version string
				Replace       *struct{ Dir string }
			}
			var selected selectedModule
			decoder := json.NewDecoder(bytes.NewReader(raw))
			for decoder.More() {
				var module selectedModule
				if err := decoder.Decode(&module); err != nil {
					t.Fatal(err)
				}
				if module.Path == sdkModule {
					selected = module
				}
			}
			if selected.Version != "v0.6.0" || selected.Replace == nil || selected.Replace.Dir != sdk {
				t.Fatalf("actual MVS SDK selection changed source: %s", raw)
			}
		})
	}
}
