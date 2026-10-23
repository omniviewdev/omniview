package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

const testSDKModule = "module github.com/omniviewdev/plugin-sdk\n\ngo 1.26\n"
const testHostModule = "module github.com/omniviewdev/omniview\n\ngo 1.26\n\nrequire github.com/omniviewdev/plugin-sdk v0.5.0\n"

func quotedModulePath(path string) string { return strconv.Quote(path) }

func sourceFile(t *testing.T, name, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}
func selectionHome(t *testing.T) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
}
func selectedWorkspace(t *testing.T) (string, string) {
	t.Helper()
	selectionHome(t)
	root := filepath.Join(t.TempDir(), "collection", "workspaces", "feature")
	host, sdk := filepath.Join(root, "host"), filepath.Join(root, "sdk")
	sourceFile(t, filepath.Join(host, "go.mod"), testHostModule)
	sourceFile(t, filepath.Join(sdk, "go.mod"), testSDKModule)
	sdkID := "plugin-sdk"
	manifest := devcontract.WorkspaceManifest{
		SchemaVersion: 1, WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Slug: "feature", DisplayName: "Feature",
		Repositories: []devcontract.Repository{
			{ID: "omniview", Directory: "host", BaseRef: "main", BaseCommit: strings.Repeat("a", 40), Branch: "feature/host"},
			{ID: sdkID, Directory: "sdk", BaseRef: "main", BaseCommit: strings.Repeat("b", 40), Branch: "feature/sdk"},
		},
		Links: devcontract.Links{SDKRepositoryID: &sdkID}, Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	sourceFile(t, filepath.Join(root, "workspace.json"), string(raw))
	host, err = filepath.EvalSymlinks(host)
	if err != nil {
		t.Fatal(err)
	}
	sdk, err = filepath.EvalSymlinks(sdk)
	if err != nil {
		t.Fatal(err)
	}
	return host, sdk
}

func TestCanonicalEnclosingWorkspaceSelectsItsActualSDKWithoutSourceWrites(t *testing.T) {
	host, sdk := selectedWorkspace(t)
	before, err := os.ReadFile(filepath.Join(host, "go.mod"))
	if err != nil {
		t.Fatal(err)
	}
	selected, err := selectInputs(inputOptions{root: host})
	if err != nil {
		t.Fatal(err)
	}
	if selected.sdkSource != sdk || selected.root != host {
		t.Fatalf("selected %q / %q", selected.root, selected.sdkSource)
	}
	after, err := os.ReadFile(filepath.Join(host, "go.mod"))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("selection changed the source module")
	}
	if _, err := os.Lstat(filepath.Join(host, ".local")); !os.IsNotExist(err) {
		t.Fatalf("selection created source metadata: %v", err)
	}
}

func TestExplicitSDKAndModuleSelectionsCannotDisagreeWithWorkspace(t *testing.T) {
	host, sdk := selectedWorkspace(t)
	other := filepath.Join(t.TempDir(), "other sdk")
	sourceFile(t, filepath.Join(other, "go.mod"), testSDKModule)
	if _, err := selectInputs(inputOptions{root: host, sdkSource: other}); err == nil {
		t.Fatal("foreign explicit SDK overrode selected workspace")
	}
	effective := filepath.Join(t.TempDir(), "effective.mod")
	sourceFile(t, effective, testHostModule+"\nreplace github.com/omniviewdev/plugin-sdk => "+quotedModulePath(other)+"\n")
	if _, err := selectInputs(inputOptions{root: host, modfile: effective, sdkSource: sdk}); err == nil {
		t.Fatal("conflicting effective SDK replacement was overwritten")
	}
	sourceFile(t, effective, testHostModule+"\nreplace github.com/omniviewdev/plugin-sdk => "+quotedModulePath(sdk)+"\n")
	selected, err := selectInputs(inputOptions{root: host, modfile: effective, sdkSource: sdk})
	if err != nil {
		t.Fatal(err)
	}
	if selected.sdkSource != sdk {
		t.Fatal("matching explicit SDK source lost")
	}
}

func TestEffectiveVersionSpecificSDKReplacementIsAuthoritative(t *testing.T) {
	host, sdk := selectedWorkspace(t)
	other := filepath.Join(t.TempDir(), "versioned sdk")
	sourceFile(t, filepath.Join(other, "go.mod"), testSDKModule)
	content := testHostModule + "\nreplace github.com/omniviewdev/plugin-sdk => " + quotedModulePath(sdk) + "\nreplace github.com/omniviewdev/plugin-sdk v0.5.0 => " + quotedModulePath(other) + "\n"
	sourceFile(t, filepath.Join(host, "go.mod"), content)
	if _, err := selectInputs(inputOptions{root: host}); err == nil {
		t.Fatal("version-specific SDK conflict was ignored")
	}
}

func TestExplicitTargetFailureCannotFallBackToAnUnrelatedSDK(t *testing.T) {
	selectionHome(t)
	host, sdk := filepath.Join(t.TempDir(), "host"), filepath.Join(t.TempDir(), "reviewed sdk")
	sourceFile(t, filepath.Join(host, "go.mod"), testHostModule)
	sourceFile(t, filepath.Join(sdk, "go.mod"), testSDKModule)
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", filepath.Join(t.TempDir(), "missing", "workspace.json"))
	if _, err := selectInputs(inputOptions{root: host, sdkSource: sdk}); err == nil {
		t.Fatal("missing explicit workspace was silently ignored")
	}
}

func TestStandaloneSDKSelectionDoesNotGuessSiblingDirectories(t *testing.T) {
	selectionHome(t)
	parent := t.TempDir()
	host, sdk := filepath.Join(parent, "host"), filepath.Join(parent, "plugin-sdk")
	sourceFile(t, filepath.Join(host, "go.mod"), testHostModule)
	sourceFile(t, filepath.Join(sdk, "go.mod"), testSDKModule)
	selected, err := selectInputs(inputOptions{root: host})
	if err != nil {
		t.Fatal(err)
	}
	if selected.sdkSource != "" {
		t.Fatalf("guessed SDK %q", selected.sdkSource)
	}
	selected, err = selectInputs(inputOptions{root: host, sdkSource: sdk})
	if err != nil {
		t.Fatal(err)
	}
	actual, err := filepath.EvalSymlinks(sdk)
	if err != nil {
		t.Fatal(err)
	}
	if selected.sdkSource != actual {
		t.Fatal("explicit reviewed SDK not selected")
	}
}

func TestInvalidSDKModuleAndRelativeExplicitSourceAreRejected(t *testing.T) {
	selectionHome(t)
	host, sdk := filepath.Join(t.TempDir(), "host"), filepath.Join(t.TempDir(), "wrong")
	sourceFile(t, filepath.Join(host, "go.mod"), testHostModule)
	sourceFile(t, filepath.Join(sdk, "go.mod"), "module example.invalid/not-the-sdk\n\ngo 1.26\n")
	if _, err := selectInputs(inputOptions{root: host, sdkSource: sdk}); err == nil {
		t.Fatal("wrong SDK module accepted")
	}
	if _, err := selectInputs(inputOptions{root: host, sdkSource: "../plugin-sdk"}); err == nil {
		t.Fatal("relative explicit SDK source accepted")
	}
}
