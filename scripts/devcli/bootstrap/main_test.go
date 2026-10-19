package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestBootstrapCompilesAgainstExplicitSDKBeforeLoadingDevcli(t *testing.T) {
	testBootstrapCompilation(t, false)
}

func TestBootstrapCompilesAgainstEnclosingSDKBeforeLoadingDevcli(t *testing.T) {
	testBootstrapCompilation(t, true)
}

func testBootstrapCompilation(t *testing.T, enclosing bool) {
	t.Helper()
	collection, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(collection, "host")
	sdk := filepath.Join(collection, "reviewed-sdk")
	write := func(path, value string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if enclosing {
		manifest := map[string]any{
			"schemaVersion": 1,
			"repositories":  []map[string]string{{"id": "omniview", "directory": "host"}, {"id": "selected-sdk", "directory": "reviewed-sdk"}},
			"links":         map[string]string{"sdkRepositoryID": "selected-sdk"},
		}
		data, err := json.Marshal(manifest)
		if err != nil {
			t.Fatal(err)
		}
		write(filepath.Join(collection, "workspace.json"), string(data))
	}
	write(filepath.Join(root, "go.mod"), "module fixture\n\ngo 1.25.0\n")
	originalModfile := filepath.Join(root, "selected.mod")
	write(originalModfile, "module fixture\n\ngo 1.25.0\n")
	write(filepath.Join(sdk, "go.mod"), "module github.com/omniviewdev/plugin-sdk\n\ngo 1.25.0\n")
	write(filepath.Join(sdk, "pkg/profilecontract/profile.go"), "package profilecontract\nconst Identity = \"selected-contract\"\n")
	// Real Go commands prove that the SDK package is unavailable until the
	// preparation command's modfile is selected. The fixture preparation writes
	// only within the supplied private output capability.
	write(filepath.Join(root, "scripts/nativepatch/main.go"), `package main
import ("flag"; "fmt"; "os"; "path/filepath")
func main() {
 root:=flag.String("root","",""); input:=flag.String("host-modfile","",""); sdk:=flag.String("sdk-source","",""); output:=flag.String("output-directory","",""); flag.Parse()
 if *input != filepath.Join(*root,"selected.mod") { panic("original module authority changed") }
 raw,err:=os.ReadFile(*input); if err!=nil { panic(err) }
 raw=append(raw,[]byte(fmt.Sprintf("require github.com/omniviewdev/plugin-sdk v0.0.0\nreplace github.com/omniviewdev/plugin-sdk => %q\n",*sdk))...)
 path:=filepath.Join(*output,"bootstrap.mod"); if err:=os.WriteFile(path,raw,0600); err!=nil { panic(err) }
 if err:=os.WriteFile(os.Getenv("BOOTSTRAP_RECEIPT"),[]byte(*output),0600); err!=nil { panic(err) }; fmt.Println(path)
}`)
	write(filepath.Join(root, "scripts/devcli/main.go"), `package main
import ("flag"; "fmt"; "os"; "path/filepath"; "github.com/omniviewdev/plugin-sdk/pkg/profilecontract")
func main() {
 root:=flag.String("root","",""); input:=flag.String("host-modfile","",""); sdk:=flag.String("sdk-source","",""); flag.Parse()
 if *input!=filepath.Join(*root,"selected.mod") || *sdk!=os.Getenv("EXPECTED_SDK") { panic("source selection authority changed") }; fmt.Println(profilecontract.Identity)
}`)
	receipt := filepath.Join(t.TempDir(), "preparation.txt")
	t.Setenv("BOOTSTRAP_RECEIPT", receipt)
	explicitSDK := sdk
	if enclosing {
		explicitSDK = ""
	}
	t.Setenv("EXPECTED_SDK", explicitSDK)
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	t.Setenv("GOWORK", "off")
	t.Setenv("GOFLAGS", "")
	var output, diagnostics bytes.Buffer
	err = bootstrap(context.Background(), bootstrapOptions{root: root, modfile: originalModfile, sdkSource: explicitSDK}, &output, &diagnostics)
	if err != nil || strings.TrimSpace(output.String()) != "selected-contract" {
		t.Fatalf("bootstrap did not use explicit SDK before compilation: %v\n%s\n%s", err, &output, &diagnostics)
	}
	temporary, err := os.ReadFile(receipt)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(string(temporary)); !os.IsNotExist(err) {
		t.Fatalf("owned preparation outlived bootstrap compilation: %v", err)
	}
	original, err := os.ReadFile(originalModfile)
	if err != nil || string(original) != "module fixture\n\ngo 1.25.0\n" {
		t.Fatalf("bootstrap changed original module input: %v", err)
	}
}

func TestBootstrapRejectsInvalidExplicitSDKBeforeCompilingDevcli(t *testing.T) {
	root, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("GOWORK", "off")
	t.Setenv("GOFLAGS", "")
	for _, sdk := range []string{"relative-sdk", t.TempDir()} {
		t.Run(sdk, func(t *testing.T) {
			var output, diagnostics bytes.Buffer
			err := bootstrap(context.Background(), bootstrapOptions{root: root, sdkSource: sdk}, &output, &diagnostics)
			if err == nil || output.Len() != 0 {
				t.Fatalf("invalid explicit SDK reached CLI compilation: %v, stdout=%s", err, &output)
			}
			if !strings.Contains(err.Error(), "prepare explicit SDK bootstrap module") {
				t.Fatalf("SDK refusal did not occur at native preparation ingress: %v\n%s", err, &diagnostics)
			}
		})
	}
}

func TestCompilationSDKSourceBoundaries(t *testing.T) {
	for _, kind := range []string{"enclosing link", "nested portable source", "explicit manifest", "environment wins ancestor ambiguity", "unsupported schema", "malformed manifest", "duplicate repository", "missing SDK link target", "escaping directory", "escaping symlink", "foreign host", "conflicting SDK", "relative environment", "missing environment", "ambiguous ancestors", "dangling manifest", "state without workspace"} {
		t.Run(kind, func(t *testing.T) {
			workspace, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			root, sdk := filepath.Join(workspace, "host"), filepath.Join(workspace, "not-a-guessed-sibling")
			for _, directory := range []string{root, sdk} {
				if err := os.Mkdir(directory, 0700); err != nil {
					t.Fatal(err)
				}
			}
			repositories := []map[string]string{{"id": "omniview", "directory": "host"}, {"id": "sdk-id", "directory": "not-a-guessed-sibling"}}
			manifest := map[string]any{"schemaVersion": 1, "repositories": repositories, "links": map[string]string{"sdkRepositoryID": "sdk-id"}}
			t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
			t.Setenv("OMNIVIEW_STATE_DIR", "")
			explicit := ""
			manifestPath := filepath.Join(workspace, "workspace.json")
			switch kind {
			case "nested portable source":
				sdk = filepath.Join(workspace, "libs", "selected-sdk")
				if err := os.MkdirAll(sdk, 0700); err != nil {
					t.Fatal(err)
				}
				repositories[1]["directory"] = "libs/selected-sdk"
			case "explicit manifest", "environment wins ancestor ambiguity":
				t.Setenv("OMNIVIEW_WORKSPACE_FILE", manifestPath)
				if kind == "environment wins ancestor ambiguity" {
					if err := os.WriteFile(filepath.Join(root, "workspace.json"), []byte("{}"), 0600); err != nil {
						t.Fatal(err)
					}
				}
			case "unsupported schema":
				manifest["schemaVersion"] = 2
			case "duplicate repository":
				manifest["repositories"] = append(repositories, repositories[1])
			case "missing SDK link target":
				manifest["links"] = map[string]string{"sdkRepositoryID": "unknown"}
			case "escaping directory":
				repositories[1]["directory"] = "../foreign"
			case "escaping symlink":
				if err := os.Remove(sdk); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(t.TempDir(), sdk); err != nil {
					t.Skipf("symlink unavailable: %v", err)
				}
			case "foreign host":
				repositories[0]["directory"] = "not-a-guessed-sibling"
			case "conflicting SDK":
				explicit = t.TempDir()
			case "relative environment":
				t.Setenv("OMNIVIEW_WORKSPACE_FILE", "workspace.json")
			case "missing environment":
				t.Setenv("OMNIVIEW_WORKSPACE_FILE", filepath.Join(workspace, "absent.json"))
			case "ambiguous ancestors":
				if err := os.WriteFile(filepath.Join(root, "workspace.json"), []byte("{}"), 0600); err != nil {
					t.Fatal(err)
				}
			case "state without workspace":
				t.Setenv("OMNIVIEW_STATE_DIR", filepath.Join(workspace, "state"))
			}
			data, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "malformed manifest" {
				data = []byte("{")
			}
			if kind == "dangling manifest" {
				if err := os.Symlink(filepath.Join(workspace, "absent.json"), manifestPath); err != nil {
					t.Skipf("symlink unavailable: %v", err)
				}
			} else if kind != "state without workspace" {
				if err := os.WriteFile(manifestPath, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			selected, err := compilationSDK(root, explicit)
			accepted := kind == "enclosing link" || kind == "nested portable source" || kind == "explicit manifest" || kind == "environment wins ancestor ambiguity"
			// Match devcontract.safeRelative exactly: its existing Windows
			// contract refuses nested slash-form directories after filepath.Clean.
			if kind == "nested portable source" && runtime.GOOS == "windows" {
				accepted = false
			}
			if (err == nil) != accepted || accepted && selected != sdk {
				t.Fatalf("selection=%q error=%v, expected acceptance=%v", selected, err, accepted)
			}
		})
	}
}
