package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestWorkspaceTerminatorSelectsActualTarget(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", t.TempDir())
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previous); err != nil {
			t.Error(err)
		}
	})
	writeManifest := func(dir, id string) {
		t.Helper()
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		manifest := devcontract.WorkspaceManifest{SchemaVersion: 1, WorkspaceID: id, Slug: "fixture", DisplayName: "Fixture", Repositories: []devcontract.Repository{{ID: "omniview", Directory: "omniview", BaseRef: "main", BaseCommit: "22e8241a8692b45c496b24aac3a6fb128933cb0e", Branch: "feature/fixture"}}, Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}}
		data, err := json.Marshal(manifest)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "workspace.json"), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	writeManifest(root, "f14566c4-5130-4e3f-aa09-3e49c63b29a6")
	selectedID := "4beee3e2-2450-421c-ad44-485a704c3a65"
	writeManifest(filepath.Join(root, "-selected"), selectedID)
	for _, command := range []string{"inspect", "paths"} {
		for _, target := range []string{"-selected", "./-selected"} {
			t.Run(command+"/"+target, func(t *testing.T) {
				var out, diagnostics bytes.Buffer
				code := run([]string{"workspace", command, "--json", "--", target}, &out, &diagnostics)
				if code != 0 {
					t.Fatalf("exit %d: %s; diagnostics: %s", code, &out, &diagnostics)
				}
				var selected struct {
					WorkspaceID string                        `json:"workspaceID"`
					Manifest    devcontract.WorkspaceManifest `json:"manifest"`
				}
				if err := json.Unmarshal(out.Bytes(), &selected); err != nil {
					t.Fatal(err)
				}
				if command == "inspect" {
					selected.WorkspaceID = selected.Manifest.WorkspaceID
				}
				if selected.WorkspaceID != selectedID {
					t.Fatalf("selected %q, want explicit target %q", selected.WorkspaceID, selectedID)
				}
				if diagnostics.Len() != 0 {
					t.Fatalf("unexpected diagnostics: %s", &diagnostics)
				}
			})
		}
	}
	for _, targets := range [][]string{{"-missing"}, {"-selected", "--json"}} {
		var out, diagnostics bytes.Buffer
		args := append([]string{"workspace", "inspect", "--json", "--"}, targets...)
		want := 3
		if len(targets) > 1 {
			want = 2
		}
		if code := run(args, &out, &diagnostics); code != want {
			t.Fatalf("targets %v: exit %d, want %d: %s", targets, code, want, &out)
		}
		var failure struct {
			Error *devcontract.Error `json:"error"`
		}
		if err := json.Unmarshal(out.Bytes(), &failure); err != nil || failure.Error == nil {
			t.Fatalf("error must be JSON stdout: %s (%v)", &out, err)
		}
	}
}
