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

	"github.com/omniviewdev/omniview/scripts/internal/hostmodtest"
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
	requirement, _ := hostmodtest.Root(t, root)
	originalModfile := filepath.Join(root, "selected.mod")
	originalInput := "module github.com/omniviewdev/omniview\n\ngo 1.25.0\n" + requirement + "require github.com/omniviewdev/plugin-sdk v0.0.0\n"
	write(originalModfile, originalInput)
	write(filepath.Join(sdk, "go.mod"), "module github.com/omniviewdev/plugin-sdk\n\ngo 1.25.0\n")
	write(filepath.Join(sdk, "pkg/profilecontract/profile.go"), "package profilecontract\nconst Identity = \"selected-contract\"\n")
	// Exercise the real module preparer before compiling a consumer of an SDK
	// package unavailable from the host's original module graph.
	helper, err := os.ReadFile(filepath.Join("..", "..", "hostmod", "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(root, "scripts/hostmod/main.go"), string(helper))
	write(filepath.Join(root, "scripts/devcli/main.go"), `package main
import ("flag"; "fmt"; "os"; "path/filepath"; "github.com/omniviewdev/plugin-sdk/pkg/profilecontract")
func main() {
 root:=flag.String("root","",""); input:=flag.String("host-modfile","",""); sdk:=flag.String("sdk-source","",""); flag.Parse()
 if *input!=filepath.Join(*root,"selected.mod") || *sdk!=os.Getenv("EXPECTED_SDK") { panic("source selection authority changed") }; fmt.Println(profilecontract.Identity)
}`)
	explicitSDK := sdk
	if enclosing {
		explicitSDK = ""
	}
	t.Setenv("EXPECTED_SDK", explicitSDK)
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	t.Setenv("GOWORK", filepath.Join(collection, "foreign.work"))
	t.Setenv("GOFLAGS", "-modfile=foreign.mod -tags=foreign")
	var output, diagnostics bytes.Buffer
	err = bootstrap(context.Background(), bootstrapOptions{root: root, modfile: originalModfile, sdkSource: explicitSDK}, &output, &diagnostics)
	if err != nil || strings.TrimSpace(output.String()) != "selected-contract" {
		t.Fatalf("bootstrap did not use explicit SDK before compilation: %v\n%s\n%s", err, &output, &diagnostics)
	}
	original, err := os.ReadFile(originalModfile)
	if err != nil || string(original) != originalInput {
		t.Fatalf("bootstrap changed original module input: %v", err)
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

func TestBootstrapRefusesWailsReplacementBeforeLoadingDevcli(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	module := "module github.com/omniviewdev/omniview\n\ngo 1.25.0\nreplace github.com/wailsapp/wails/v3 => ./patched-framework\n"
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte(module), 0600); err != nil {
		t.Fatal(err)
	}
	helper, err := os.ReadFile(filepath.Join("..", "..", "hostmod", "main.go"))
	if err != nil {
		t.Fatal(err)
	}
	helperPath := filepath.Join(root, "scripts", "hostmod", "main.go")
	if err := os.MkdirAll(filepath.Dir(helperPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(helperPath, helper, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GOWORK", "off")
	t.Setenv("GOFLAGS", "")
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	var output, diagnostics bytes.Buffer
	err = bootstrap(context.Background(), bootstrapOptions{root: root}, &output, &diagnostics)
	if err == nil || !strings.Contains(diagnostics.String(), "Wails replacements are forbidden") {
		t.Fatalf("framework replacement reached CLI compilation: %v\n%s", err, &diagnostics)
	}
	if output.Len() != 0 {
		t.Fatal("refused bootstrap published executable output")
	}
}
