package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

func TestWorkspacePreflightAggregatesMissingInputsAfterSourceOnlyCreation(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	root := t.TempDir()
	source := t.TempDir()
	for _, args := range [][]string{{"init", "-b", "main"}, {"config", "user.name", "Fixture"}, {"config", "user.email", "fixture@example.invalid"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = source
		if raw, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s: %v", args, raw, err)
		}
	}
	if err := os.WriteFile(filepath.Join(source, "tracked"), []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "tracked"}, {"commit", "-m", "initial"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = source
		if raw, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s: %v", args, raw, err)
		}
	}
	for _, args := range [][]string{
		{"workspace", "init", "--root", root, "--source", "omniview=" + source, "--source-ref", "omniview=main", "--json"},
		{"workspace", "create", "source-only", "--root", root, "--json"},
	} {
		var out, diagnostics bytes.Buffer
		if code := run(args, &out, &diagnostics); code != 0 {
			t.Fatalf("%v: exit %d: %s %s", args, code, out.String(), diagnostics.String())
		}
	}
	for _, evidence := range []string{"", filepath.Join(root, "missing.json")} {
		var out, diagnostics bytes.Buffer
		args := []string{"workspace", "create", "bad-start", "--root", root, "--start", "--json"}
		if evidence != "" {
			args = append(args, "--link-evidence", evidence)
		}
		if code := run(args, &out, &diagnostics); code == 0 {
			t.Fatalf("missing launch evidence accepted: %s %s", out.String(), diagnostics.String())
		}
		if _, err := os.Stat(filepath.Join(root, "workspaces", "bad-start")); !os.IsNotExist(err) {
			t.Fatalf("bad launch materialized workspace: %v", err)
		}
		cmd := exec.Command("git", "for-each-ref", "--format=%(refname)", "refs/heads/feature/bad-start")
		cmd.Dir = source
		if raw, err := cmd.CombinedOutput(); err != nil || len(raw) != 0 {
			t.Fatalf("bad launch created source branches: %s %v", raw, err)
		}
	}
	for _, extra := range [][]string{nil, {"--link-evidence", filepath.Join(root, "missing.json")}} {
		var out, diagnostics bytes.Buffer
		args := append([]string{"workspace", "preflight", "source-only", "--root", root, "--json"}, extra...)
		if code := run(args, &out, &diagnostics); code != 3 {
			t.Fatalf("exit %d: %s %s", code, out.String(), diagnostics.String())
		}
		var report devworkspace.LaunchPreflight
		if err := json.Unmarshal(out.Bytes(), &report); err != nil {
			t.Fatal(err)
		}
		if report.Ready || len(report.Issues) != 3 {
			t.Fatalf("expected all three missing inputs: %+v", report)
		}
		for i, code := range []string{"link_evidence_required", "reviewed_sdk_required", "sdk_source_required"} {
			if report.Issues[i].Code != code {
				t.Fatalf("issue %d: %+v", i, report.Issues[i])
			}
		}
	}
	var out, diagnostics bytes.Buffer
	if code := run([]string{"workspace", "inspect", "source-only", "--root", root, "--json"}, &out, &diagnostics); code != 0 {
		t.Fatalf("source-only workspace no longer usable: %d %s %s", code, out.String(), diagnostics.String())
	}
	var status devworkspace.Status
	if err := json.Unmarshal(out.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.Phase != "stopped" {
		t.Fatalf("preflight started workspace: %s", out.String())
	}
}
