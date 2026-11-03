package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/scripts/internal/hostmodtest"
	"golang.org/x/mod/sumdb/dirhash"
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

func transportProxyModule(t *testing.T, module, version, source string) string {
	t.Helper()
	proxy, err := url.Parse(os.Getenv("GOPROXY"))
	if err != nil {
		t.Fatal(err)
	}
	proxyPath := filepath.FromSlash(proxy.Path)
	if runtime.GOOS == "windows" {
		proxyPath = strings.TrimPrefix(proxyPath, string(filepath.Separator))
	}
	mod := "module " + module + "\n\ngo 1.20\n"
	_, modSum := hostmodtest.Module(t, proxyPath, module, version, mod)
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for _, file := range []struct{ name, body string }{{"go.mod", mod}, {"transport.go", source}} {
		entry, err := writer.Create(module + "@" + version + "/" + file.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(file.body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(proxyPath, filepath.FromSlash(module), "@v", version+".zip")
	put(t, archivePath, archive.String())
	sum, err := dirhash.HashZip(archivePath, dirhash.Hash1)
	if err != nil {
		t.Fatal(err)
	}
	return module + " " + version + " " + sum + "\n" + module + " " + version + "/go.mod " + modSum + "\n"
}

func TestPrepareSDKTransportGraphAndSymbols(t *testing.T) {
	for _, selection := range []string{"explicit", "implicit", "matching dormant host", "versioned SDK", "two SDK targets", "matching host sums", "host metadata only", "old SDK", "stock"} {
		t.Run(selection, func(t *testing.T) {
			root, output := fixture(t)
			fork := "example.com/reviewed-grpc"
			stockSums := transportProxyModule(t, grpcModule, "v1.0.0", "package grpc\nconst StockTransport = 1\n")
			forkSums := transportProxyModule(t, fork, "v1.1.0", "package grpc\nconst ReviewedTransport = 2\n")
			sdk := filepath.Join(root, "sdk")
			sdkMod := "module " + sdkModule + "\n\ngo 1.20\nrequire " + grpcModule + " v1.0.0\n"
			symbol := "ReviewedTransport"
			old := grpcModule
			if selection == "versioned SDK" {
				old += " v1.0.0"
			}
			if selection == "old SDK" {
				symbol = "StockTransport"
			} else {
				sdkMod += "replace " + old + " => " + fork + " v1.1.0\n"
			}
			sdkSums := forkSums
			if selection == "two SDK targets" {
				otherFork := "example.com/dormant-grpc"
				sdkMod += "replace " + grpcModule + " v1.9.0 => " + otherFork + " v1.2.0\n"
				sdkSums += transportProxyModule(t, otherFork, "v1.2.0", "package grpc\n")
			}
			put(t, filepath.Join(sdk, "go.mod"), sdkMod)
			if selection == "old SDK" {
				sdkSums = stockSums
			}
			expectedTransportSums := sdkSums
			if selection == "stock" {
				expectedTransportSums = stockSums
			}
			// An unrelated SDK sum must not become consumer checksum authority.
			sdkSums += "example.com/unrelated v1.0.0 h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n"
			put(t, filepath.Join(sdk, "go.sum"), sdkSums)
			put(t, filepath.Join(sdk, "sdk.go"), "package sdk\nimport \"google.golang.org/grpc\"\nconst Transport = grpc."+symbol+"\n")
			input := filepath.Join(root, "go.mod")
			body := "module github.com/omniviewdev/omniview\n\ngo 1.20\n" + stockRequirement
			consumer := "package consumer\nimport \"" + sdkModule + "\"\nvar _ = sdk.Transport\n"
			selected := sdk
			if selection == "stock" {
				selected = ""
				body += "require " + grpcModule + " v1.0.0\n"
				consumer = "package consumer\nimport \"google.golang.org/grpc\"\nvar _ = grpc.StockTransport\n"
			} else {
				body += "require " + sdkModule + " v0.5.0\n"
				body += "require " + grpcModule + " v1.0.0 // indirect\n"
				if selection == "implicit" {
					body += "replace " + sdkModule + " => ./sdk\n"
					selected = ""
				}
				if selection == "matching dormant host" {
					body += "replace " + grpcModule + " v1.9.0 => " + fork + " v1.1.0\n"
				}
			}
			put(t, input, body)
			put(t, filepath.Join(root, "consumer.go"), consumer)
			hostSums, err := os.ReadFile(filepath.Join(root, "go.sum"))
			if err != nil {
				t.Fatal(err)
			}
			switch selection {
			case "old SDK", "stock":
				hostSums = append(hostSums, []byte(stockSums)...)
			case "matching host sums":
				hostSums = append(hostSums, []byte(forkSums)...)
			case "host metadata only":
				hostSums = append(hostSums, []byte(strings.SplitAfterN(forkSums, "\n", 2)[1])...)
			}
			put(t, filepath.Join(root, "go.sum"), string(hostSums))
			modfile, err := prepare(root, input, selected, output)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := runGo(root, "list", "-mod=readonly", "-modfile="+modfile, "-m", "-json", grpcModule)
			if err != nil {
				t.Fatal(err)
			}
			var graph struct {
				Path, Version string
				Replace       *moduleVersion
			}
			if err := decodeJSON(raw, &graph); err != nil {
				t.Fatal(err)
			}
			if graph.Path != grpcModule || graph.Version != "v1.0.0" {
				t.Fatalf("unexpected transport graph: %s", raw)
			}
			if selection == "old SDK" || selection == "stock" {
				if graph.Replace != nil {
					t.Fatalf("stock transport replaced: %s", raw)
				}
			} else if graph.Replace == nil || *graph.Replace != (moduleVersion{Path: fork, Version: "v1.1.0"}) {
				t.Fatalf("reviewed transport absent: %s", raw)
			}
			if _, err := runGo(root, "test", "-mod=readonly", "-modfile="+modfile, "."); err != nil {
				t.Fatal(err)
			}
			if raw, err := os.ReadFile(input); err != nil || string(raw) != body {
				t.Fatalf("host source changed: %v", err)
			}
			if raw, err := os.ReadFile(filepath.Join(sdk, "go.mod")); err != nil || string(raw) != sdkMod {
				t.Fatalf("SDK source changed: %v", err)
			}
			if raw, err := os.ReadFile(filepath.Join(root, "go.sum")); err != nil || !bytes.Equal(raw, hostSums) {
				t.Fatalf("host source sums changed: %v", err)
			}
			if raw, err := os.ReadFile(filepath.Join(sdk, "go.sum")); err != nil || string(raw) != sdkSums {
				t.Fatalf("SDK source sums changed: %v", err)
			}
			privateSums, err := os.ReadFile(filepath.Join(output, "host.sum"))
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(privateSums, []byte("example.com/unrelated")) {
				t.Fatal("unrelated SDK checksums leaked into consumer")
			}
			for _, entry := range strings.Split(strings.TrimSpace(expectedTransportSums), "\n") {
				if !bytes.Contains(privateSums, []byte(entry+"\n")) {
					t.Fatalf("private consumer lacks transport checksum %s", entry)
				}
			}
		})
	}
}

func TestPrepareRejectsSDKTransportConflictWithoutPublishing(t *testing.T) {
	for _, selection := range []string{"host general", "host dormant", "host local", "host broad versus SDK specific", "host dormant versus SDK specific", "SDK relative", "SDK absolute", "SDK versioned local"} {
		t.Run(selection, func(t *testing.T) {
			root, output := fixture(t)
			transportProxyModule(t, grpcModule, "v1.0.0", "package grpc\n")
			fork := "example.com/reviewed-grpc"
			forkSums := transportProxyModule(t, fork, "v1.1.0", "package grpc\n")
			sdk := filepath.Join(root, "sdk")
			sdkMod := "module " + sdkModule + "\n\ngo 1.20\nrequire " + grpcModule + " v1.0.0\n"
			valid := "replace " + grpcModule + " => " + fork + " v1.1.0\n"
			put(t, filepath.Join(sdk, "go.mod"), sdkMod+valid)
			put(t, filepath.Join(sdk, "go.sum"), forkSums)
			input := filepath.Join(root, "go.mod")
			body := "module github.com/omniviewdev/omniview\n\ngo 1.20\n" + stockRequirement + "require " + sdkModule + " v0.5.0\n"
			put(t, input, body)
			if _, err := prepare(root, input, sdk, output); err != nil {
				t.Fatal(err)
			}
			before := map[string][]byte{}
			for _, name := range []string{"host.mod", "host.sum", ".hostmod-output.json"} {
				raw, err := os.ReadFile(filepath.Join(output, name))
				if err != nil {
					t.Fatal(err)
				}
				before[name] = raw
			}
			sdkBody := sdkMod + valid
			switch selection {
			case "host general":
				body += "replace " + grpcModule + " => example.com/foreign v1.2.0\n"
			case "host dormant":
				body += valid + "replace " + grpcModule + " v1.9.0 => example.com/foreign v1.2.0\n"
			case "host local":
				body += "replace " + grpcModule + " => ./grpc\n"
			case "host broad versus SDK specific":
				body += valid
				sdkBody += "replace " + grpcModule + " v1.9.0 => example.com/foreign v1.2.0\n"
			case "host dormant versus SDK specific":
				body += "replace " + grpcModule + " v1.9.0 => " + fork + " v1.1.0\n"
				sdkBody += "replace " + grpcModule + " v1.9.0 => example.com/foreign v1.2.0\n"
			case "SDK relative":
				sdkBody = sdkMod + "replace " + grpcModule + " => ../grpc\n"
			case "SDK absolute":
				sdkBody = sdkMod + "replace " + grpcModule + " => " + filepath.ToSlash(filepath.Join(root, "grpc")) + "\n"
			case "SDK versioned local":
				sdkBody = sdkMod + "replace " + grpcModule + " v1.0.0 => ./grpc\n"
			}
			put(t, input, body)
			put(t, filepath.Join(sdk, "go.mod"), sdkBody)
			_, err := prepare(root, input, sdk, output)
			if err == nil {
				t.Fatal("unsafe transport accepted")
			}
			for name, want := range before {
				got, err := os.ReadFile(filepath.Join(output, name))
				if err != nil || !bytes.Equal(got, want) {
					t.Fatalf("refusal changed prior %s: %v", name, err)
				}
			}
			for path, want := range map[string]string{input: body, filepath.Join(sdk, "go.mod"): sdkBody} {
				got, err := os.ReadFile(path)
				if err != nil || string(got) != want {
					t.Fatalf("refusal changed input %s: %v", path, err)
				}
			}
		})
	}
}

func TestPrepareRejectsTransportChecksumInputsWithoutPublishing(t *testing.T) {
	for _, selection := range []string{
		"missing SDK sum file", "missing SDK content", "missing SDK go.mod", "wrong SDK version",
		"SDK malformed fields", "SDK malformed base64", "SDK wrong digest size", "SDK wrong algorithm",
		"SDK conflicting content", "SDK conflicting go.mod",
		"host malformed fields", "host malformed base64", "host wrong digest size", "host wrong algorithm",
		"host conflicting content", "host conflicting go.mod", "host conflicting duplicate",
	} {
		t.Run(selection, func(t *testing.T) {
			root, output := fixture(t)
			fork := "example.com/reviewed-grpc"
			transportProxyModule(t, grpcModule, "v1.0.0", "package grpc\n")
			forkSums := transportProxyModule(t, fork, "v1.1.0", "package grpc\nconst ReviewedTransport = 2\n")
			sdk := filepath.Join(root, "sdk")
			sdkMod := "module " + sdkModule + "\n\ngo 1.20\nrequire " + grpcModule + " v1.0.0\nreplace " + grpcModule + " => " + fork + " v1.1.0\n"
			sdkSumPath := filepath.Join(sdk, "go.sum")
			put(t, filepath.Join(sdk, "go.mod"), sdkMod)
			put(t, sdkSumPath, forkSums)
			put(t, filepath.Join(sdk, "sdk.go"), "package sdk\nimport \"google.golang.org/grpc\"\nconst Transport = grpc.ReviewedTransport\n")
			input := filepath.Join(root, "go.mod")
			body := "module github.com/omniviewdev/omniview\n\ngo 1.20\n" + stockRequirement + "require " + sdkModule + " v0.5.0\nrequire " + grpcModule + " v1.0.0 // indirect\n"
			put(t, input, body)
			put(t, filepath.Join(root, "consumer.go"), "package consumer\nimport \""+sdkModule+"\"\nvar _ = sdk.Transport\n")
			if _, err := prepare(root, input, sdk, output); err != nil {
				t.Fatal(err)
			}
			before := map[string][]byte{}
			for _, name := range []string{"host.mod", "host.sum", ".hostmod-output.json"} {
				raw, err := os.ReadFile(filepath.Join(output, name))
				if err != nil {
					t.Fatal(err)
				}
				before[name] = raw
			}
			hostSumPath := filepath.Join(root, "go.sum")
			hostSums, err := os.ReadFile(hostSumPath)
			if err != nil {
				t.Fatal(err)
			}
			entries := strings.Split(strings.TrimSpace(forkSums), "\n")
			contentFields := strings.Fields(entries[0])
			modFields := strings.Fields(entries[1])
			otherSum := "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
			sdkSums := forkSums
			hostExtra := ""
			switch selection {
			case "missing SDK sum file":
				if err := os.Remove(sdkSumPath); err != nil {
					t.Fatal(err)
				}
			case "missing SDK content":
				sdkSums = entries[1] + "\n"
			case "missing SDK go.mod":
				sdkSums = entries[0] + "\n"
			case "wrong SDK version":
				sdkSums = strings.ReplaceAll(forkSums, "v1.1.0", "v1.2.0")
			case "SDK malformed fields":
				sdkSums += fork + " v1.1.0\n"
			case "SDK malformed base64":
				sdkSums = strings.Replace(forkSums, contentFields[2], "h1:not-base64", 1)
			case "SDK wrong digest size":
				sdkSums = strings.Replace(forkSums, contentFields[2], "h1:YQ==", 1)
			case "SDK wrong algorithm":
				sdkSums = strings.Replace(forkSums, contentFields[2], "h2:"+strings.TrimPrefix(contentFields[2], "h1:"), 1)
			case "SDK conflicting content":
				sdkSums += fork + " v1.1.0 " + otherSum + "\n"
			case "SDK conflicting go.mod":
				sdkSums += fork + " v1.1.0/go.mod " + otherSum + "\n"
			case "host malformed fields":
				hostExtra = fork + " v1.1.0 " + contentFields[2] + " extra\n"
			case "host malformed base64":
				hostExtra = fork + " v1.1.0 h1:not-base64\n"
			case "host wrong digest size":
				hostExtra = fork + " v1.1.0 h1:YQ==\n"
			case "host wrong algorithm":
				hostExtra = fork + " v1.1.0 h2:" + strings.TrimPrefix(contentFields[2], "h1:") + "\n"
			case "host conflicting content":
				hostExtra = fork + " v1.1.0 " + otherSum + "\n"
			case "host conflicting go.mod":
				hostExtra = fork + " " + modFields[1] + " " + otherSum + "\n"
			case "host conflicting duplicate":
				hostExtra = forkSums + fork + " v1.1.0 " + otherSum + "\n"
			}
			if selection != "missing SDK sum file" {
				put(t, sdkSumPath, sdkSums)
			}
			hostSums = append(hostSums, []byte(hostExtra)...)
			put(t, hostSumPath, string(hostSums))
			if _, err := prepare(root, input, sdk, output); err == nil {
				t.Fatal("unsafe transport checksum inputs accepted")
			}
			for name, want := range before {
				got, err := os.ReadFile(filepath.Join(output, name))
				if err != nil || !bytes.Equal(got, want) {
					t.Fatalf("refusal changed prior %s: %v", name, err)
				}
			}
			for path, want := range map[string]string{
				input: body, hostSumPath: string(hostSums), filepath.Join(sdk, "go.mod"): sdkMod,
			} {
				got, err := os.ReadFile(path)
				if err != nil || string(got) != want {
					t.Fatalf("refusal changed input %s: %v", path, err)
				}
			}
			got, err := os.ReadFile(sdkSumPath)
			if selection == "missing SDK sum file" {
				if !os.IsNotExist(err) {
					t.Fatalf("refusal restored absent SDK sum: %v", err)
				}
			} else if err != nil || string(got) != sdkSums {
				t.Fatalf("refusal changed SDK sums: %v", err)
			}
			modfile := filepath.Join(output, "host.mod")
			if _, err := runGo(root, "test", "-mod=readonly", "-modfile="+modfile, "."); err != nil {
				t.Fatalf("prior private module stopped compiling after refusal: %v", err)
			}
		})
	}
}
