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

func TestWorkspaceLifecycleCLIUsesRealGitAndPreservesBranches(t *testing.T) {
	root := t.TempDir()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	source := filepath.Join(root, "source with spaces")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = source
		if raw, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s %v", args, raw, err)
		}
	}
	git("init", "-b", "main")
	git("config", "user.name", "Fixture")
	git("config", "user.email", "fixture@example.invalid")
	if err := os.WriteFile(filepath.Join(source, "tracked"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	git("add", "tracked")
	git("commit", "-m", "initial")
	invoke := func(args ...string) json.RawMessage {
		t.Helper()
		var out, diagnostics bytes.Buffer
		code := run(args, &out, &diagnostics)
		if code != 0 {
			t.Fatalf("%v => %d %s stderr=%s", args, code, out.String(), diagnostics.String())
		}
		if !json.Valid(out.Bytes()) {
			t.Fatalf("stdout is not a single JSON value: %s", out.String())
		}
		return out.Bytes()
	}
	invoke("workspace", "init", "--root", root, "--source", "omniview="+source, "--source-ref", "omniview=main", "--json")
	raw := invoke("workspace", "create", "feature-one", "--root", root, "--json")
	var workspace devworkspace.Workspace
	if err := json.Unmarshal(raw, &workspace); err != nil {
		t.Fatal(err)
	}
	if workspace.Manifest.WorkspaceID == "" || workspace.Root == source {
		t.Fatalf("not an independent worktree: %s", raw)
	}
	invoke("workspace", "edit", "feature-one", "--root", root, "--name", "Feature One Renamed", "--json")
	raw = invoke("workspace", "inspect", "feature-one", "--root", root, "--json")
	var status devworkspace.Status
	if err := json.Unmarshal(raw, &status); err != nil {
		t.Fatal(err)
	}
	if status.Manifest.DisplayName != "Feature One Renamed" || status.Phase != "stopped" {
		t.Fatalf("wrong stopped inspection: %s", raw)
	}
	raw = invoke("workspace", "create", "feature-two", "--root", root, "--json")
	var other devworkspace.Workspace
	if err := json.Unmarshal(raw, &other); err != nil {
		t.Fatal(err)
	}
	for _, verb := range []string{"remove", "rollback", "resume"} {
		t.Setenv(devcontract.WorkspaceEnvironment, filepath.Join(other.Root, "workspace.json"))
		var out, diagnostics bytes.Buffer
		if code := run([]string{"workspace", verb, "feature-one", "--root", root, "--json"}, &out, &diagnostics); code != 4 {
			t.Fatalf("explicit %s ignored conflicting environment: code=%d out=%s", verb, code, out.String())
		}
		if _, err := os.Stat(filepath.Join(workspace.Root, "workspace.json")); err != nil {
			t.Fatalf("conflict mutated target workspace: %v", err)
		}
	}
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_STATE_DIR", filepath.Join(home, "conflicting-state"))
	var conflictOut, conflictDiagnostics bytes.Buffer
	if code := run([]string{"workspace", "remove", "feature-one", "--root", root, "--json"}, &conflictOut, &conflictDiagnostics); code != 4 {
		t.Fatalf("explicit remove ignored conflicting state: %d %s", code, conflictOut.String())
	}
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	branch := workspace.Manifest.Repositories[0].Branch
	invoke("workspace", "remove", "feature-one", "--root", root, "--json")
	git("show-ref", "--verify", "refs/heads/"+branch)
	if data, err := os.ReadFile(filepath.Join(source, "tracked")); err != nil || string(data) != "original" {
		t.Fatalf("canonical source changed: %s %v", data, err)
	}
}

func TestWorkspaceCreateStartDoesNotPretendMissingTrustIsReady(t *testing.T) {
	command, err := parseWorkspaceCommand([]string{"workspace", "create", "feature", "--start", "--repo", "plugin-sdk", "--json"}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	if !command.start || command.launch.ReviewedSDKRevision != "" {
		t.Fatalf("trust was fabricated: %+v", command)
	}
	if err = command.launch.Validate(); err == nil {
		t.Fatal("unreviewed SDK source accepted")
	}
}

func TestWorkspaceCLIRejectsConflictingExplicitContext(t *testing.T) {
	var out, diagnostics bytes.Buffer
	code := run([]string{"workspace", "inspect", "one", "--workspace", "two", "--json"}, &out, &diagnostics)
	if code != 4 {
		t.Fatalf("conflicting context exit=%d output=%s", code, out.String())
	}
	var failure struct {
		Error *devcontract.Error `json:"error"`
	}
	if err := json.Unmarshal(out.Bytes(), &failure); err != nil || failure.Error == nil || failure.Error.Code != "conflicting_target" {
		t.Fatalf("wrong error: %s %v", out.String(), err)
	}
}
