package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

func TestWorkspaceLifecycleTargetFormsPreserveDecoyEdges(t *testing.T) {
	for _, verb := range []string{"resume", "rollback", "remove", "recover"} {
		for _, form := range []string{"slug", "uuid", "relative-directory", "absolute-directory", "manifest"} {
			t.Run(verb+"/"+form, func(t *testing.T) {
				f := newCLIEdgeFixture(t)
				var decoy devworkspace.Workspace
				if err := json.Unmarshal(f.success("workspace", "create", "decoy", "--root", f.root, "--json"), &decoy); err != nil {
					t.Fatal(err)
				}
				decoyBefore, err := os.ReadFile(decoy.ManifestPath)
				if err != nil {
					t.Fatal(err)
				}
				target := f.workspace.Manifest.Slug
				switch form {
				case "uuid":
					target = f.workspace.Manifest.WorkspaceID
				case "relative-directory":
					t.Chdir(f.root)
					target, err = filepath.Rel(f.root, f.workspace.Root)
					if err != nil {
						t.Fatal(err)
					}
					target = "." + string(filepath.Separator) + target
				case "absolute-directory":
					target = f.workspace.Root
				case "manifest":
					target = f.workspace.ManifestPath
				}
				var out, diagnostics bytes.Buffer
				code := run([]string{"workspace", verb, target, "--root", f.root, "--json"}, &out, &diagnostics)
				if verb == "resume" || verb == "remove" {
					if code != 0 {
						t.Errorf("target form failed: code=%d stdout=%s stderr=%s", code, &out, &diagnostics)
					}
				} else if verb == "rollback" {
					var result struct {
						Error *devcontract.Error `json:"error"`
					}
					if err := json.Unmarshal(out.Bytes(), &result); err != nil || code != 4 || result.Error == nil || result.Error.Code != "rollback_not_allowed" {
						t.Errorf("completed-workspace rollback reached wrong policy: code=%d out=%s err=%v", code, &out, err)
					}
				} else {
					var result struct {
						Error *devcontract.Error `json:"error"`
					}
					if err := json.Unmarshal(out.Bytes(), &result); err != nil || code != 3 || result.Error == nil || result.Error.Code != "refresh_evidence_required" {
						t.Errorf("source-only recovery reached wrong prerequisite: code=%d out=%s err=%v", code, &out, err)
					}
				}
				if after, err := os.ReadFile(decoy.ManifestPath); err != nil || !bytes.Equal(decoyBefore, after) {
					t.Fatalf("lifecycle target changed decoy: %s %v", after, err)
				}
				if verb == "remove" && code == 0 {
					if _, err := os.Stat(f.workspace.Root); !os.IsNotExist(err) {
						t.Errorf("remove did not delete selected root: %v", err)
					}
				} else {
					if raw, err := os.ReadFile(f.workspace.ManifestPath); err != nil || !bytes.Contains(raw, []byte(f.workspace.Manifest.WorkspaceID)) {
						t.Errorf("selected workspace identity lost: %s %v", raw, err)
					}
				}
			})
		}
	}
}

func TestWorkspaceSlugWinsOverSameNamedLocalDirectoryEdges(t *testing.T) {
	f := newCLIEdgeFixture(t)
	var decoy devworkspace.Workspace
	if err := json.Unmarshal(f.success("workspace", "create", "decoy", "--root", f.root, "--json"), &decoy); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(decoy.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	cwd := t.TempDir()
	if err := os.Symlink(decoy.Root, filepath.Join(cwd, "feature")); err != nil {
		t.Fatal(err)
	}
	t.Chdir(cwd)
	f.success("workspace", "edit", "feature", "--root", f.root, "--name", "Selected registered slug", "--json")
	var manifest devcontract.WorkspaceManifest
	if err := json.Unmarshal(f.manifest(), &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.DisplayName != "Selected registered slug" {
		t.Fatal("local same-named directory displaced registered slug")
	}
	if after, err := os.ReadFile(decoy.ManifestPath); err != nil || !bytes.Equal(before, after) {
		t.Fatalf("slug edit mutated local directory decoy: %s %v", after, err)
	}
}
