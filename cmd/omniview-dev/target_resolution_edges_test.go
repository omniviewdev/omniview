package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/gofrs/flock"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

func TestWorkspaceLifecycleTargetFormsPreserveDecoyEdges(t *testing.T) {
	for _, verb := range []string{"resume", "remove", "recover"} {
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
				if verb == "recover" {
					base := filepath.Join(f.root, ".omniview-dev", "recovery", decoy.Manifest.WorkspaceID)
					if err := os.MkdirAll(base, 0700); err != nil {
						t.Fatal(err)
					}
					lock := flock.New(filepath.Join(base, "refresh.lock"))
					if held, err := lock.TryLock(); err != nil || !held {
						t.Fatalf("hold decoy refresh authority: held=%t err=%v", held, err)
					}
					t.Cleanup(func() { _ = lock.Unlock() })
					var out, diagnostics bytes.Buffer
					code := run([]string{"workspace", "recover", decoy.Manifest.Slug, "--root", f.root, "--json"}, &out, &diagnostics)
					var result struct {
						Error *devcontract.Error `json:"error"`
					}
					if err := json.Unmarshal(out.Bytes(), &result); err != nil || code != 4 || result.Error == nil || result.Error.Code != "workspace_busy" {
						t.Fatalf("held decoy authority did not block recovery: code=%d out=%s err=%v", code, &out, err)
					}
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
				} else {
					var result struct {
						Error *devcontract.Error `json:"error"`
					}
					if err := json.Unmarshal(out.Bytes(), &result); err != nil || code != 3 || result.Error == nil || result.Error.Code != "refresh_evidence_required" {
						t.Errorf("source-only recovery reached wrong prerequisite: code=%d out=%s err=%v", code, &out, err)
					}
				}
				if verb == "resume" && code == 0 {
					var resumed devworkspace.Workspace
					if err := json.Unmarshal(out.Bytes(), &resumed); err != nil || resumed.Manifest.WorkspaceID != f.workspace.Manifest.WorkspaceID {
						t.Errorf("resume returned wrong selected workspace: out=%s err=%v", &out, err)
					}
				}
				if after, err := os.ReadFile(decoy.ManifestPath); err != nil || !bytes.Equal(decoyBefore, after) {
					t.Fatalf("lifecycle target changed decoy: %s %v", after, err)
				}
				if verb == "remove" && code == 0 {
					if _, err := os.Stat(f.workspace.Root); !os.IsNotExist(err) {
						t.Errorf("%s did not delete selected root: %v", verb, err)
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

func TestWorkspaceCompletedRollbackRefusesWithoutMutationEdges(t *testing.T) {
	f := newCLIEdgeFixture(t)
	before := f.manifest()
	var out, diagnostics bytes.Buffer
	code := run([]string{"workspace", "rollback", f.workspace.Manifest.Slug, "--root", f.root, "--json"}, &out, &diagnostics)
	var result struct {
		Error *devcontract.Error `json:"error"`
	}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil || code != 4 || result.Error == nil || result.Error.Code != "rollback_not_allowed" {
		t.Errorf("completed rollback reached wrong policy: code=%d out=%s err=%v", code, &out, err)
	}
	if !bytes.Equal(before, f.manifest()) {
		t.Fatal("refused rollback changed completed workspace")
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
