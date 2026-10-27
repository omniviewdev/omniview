package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/spf13/cobra"
)

// parseWorkspaceCommand exercises the production Cobra leaf without running
// workspace operations. Flag registration and validation remain shared.
func parseWorkspaceCommand(args []string, diagnostics io.Writer) (workspaceCommand, error) {
	var parsed workspaceCommand
	root := &cobra.Command{Use: "omniview-dev", SilenceErrors: true, SilenceUsage: true}
	group := &cobra.Command{Use: "workspace"}
	group.AddCommand(newWorkspaceCommand(args[1], func(_ *cobra.Command, c workspaceCommand) error {
		parsed = c
		return nil
	}))
	root.AddCommand(group)
	root.SetOut(diagnostics)
	root.SetErr(diagnostics)
	root.SetArgs(args)
	err := root.Execute()
	return parsed, err
}
func TestWorkspaceCobraValidation(t *testing.T) {
	for _, args := range [][]string{
		{"workspace", "up", "one", "two"},
		{"workspace", "list", "one"},
		{"workspace", "init", "one"},
		{"workspace", "up", "--timeout=0s"},
		{"workspace", "up", "--mode"},
		{"workspace", "up", "--unknown"},
	} {
		if _, err := parseWorkspaceCommand(args, io.Discard); err == nil {
			t.Fatalf("accepted invalid command: %v", args)
		}
	}
	_, err := parseWorkspaceCommand([]string{"workspace", "up", "one", "--workspace", "two"}, io.Discard)
	if devcontract.ExitCode(err) != 4 {
		t.Fatalf("conflicting target exit: %v", err)
	}
}

func TestRepositoryCobraInterspersedAndTerminatedTargets(t *testing.T) {
	for _, args := range [][]string{
		{"repository", "add", "example", "--json"},
		{"repository", "add", "--json", "--", "--example"},
	} {
		var out, diagnostics bytes.Buffer
		if code := run(args, &out, &diagnostics); code != 2 {
			t.Fatalf("exit=%d output=%s diagnostics=%s", code, out.String(), diagnostics.String())
		}
		var result struct {
			Error *devcontract.Error `json:"error"`
		}
		if err := json.Unmarshal(out.Bytes(), &result); err != nil || result.Error == nil || result.Error.Message != "repository add requires --source" {
			t.Fatalf("target or JSON flag was not parsed: %s (%v)", out.String(), err)
		}
	}
}

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
	var initOut, initDiagnostics bytes.Buffer
	initCode := run([]string{"workspace", "init", "--root", root, "--source", "omniview=" + source, "--source-ref", "omniview=main", "--source-directory", "omniview=replacement", "--json"}, &initOut, &initDiagnostics)
	var initFailure struct {
		Error *devcontract.Error `json:"error"`
	}
	if err := json.Unmarshal(initOut.Bytes(), &initFailure); err != nil {
		t.Fatalf("init conflict is not JSON: %s %v", initOut.String(), err)
	}
	if initCode != 4 || initFailure.Error == nil || initFailure.Error.Code != "registry_exists" {
		t.Fatalf("changed registry reported success or wrong error: code=%d out=%s stderr=%s", initCode, initOut.String(), initDiagnostics.String())
	}
	raw := invoke("workspace", "create", "feature-one", "--root", root, "--json")
	var workspace devworkspace.Workspace
	if err := json.Unmarshal(raw, &workspace); err != nil {
		t.Fatal(err)
	}
	if len(workspace.Manifest.Repositories) != 1 || workspace.Manifest.Repositories[0].Directory != "omniview" {
		t.Fatalf("failed registry initialization changed source mapping: %s", raw)
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
	foreignRoot := t.TempDir()
	invoke("workspace", "init", "--root", foreignRoot, "--source", "omniview="+source, "--source-ref", "omniview=main", "--json")
	var foreignOut, foreignDiagnostics bytes.Buffer
	if code := run([]string{"workspace", "remove", "--workspace", filepath.Join(workspace.Root, "workspace.json"), "--root", foreignRoot, "--json"}, &foreignOut, &foreignDiagnostics); code != 4 {
		t.Fatalf("explicit path ignored conflicting collection: code=%d out=%s", code, foreignOut.String())
	}
	if _, err := os.Stat(filepath.Join(workspace.Root, "workspace.json")); err != nil {
		t.Fatalf("foreign collection selection mutated target: %v", err)
	}
	// Explicit lifecycle paths remain authoritative outside the collection.
	t.Chdir(t.TempDir())
	invoke("workspace", "resume", "--workspace", workspace.Root, "--json")
	invoke("workspace", "resume", "--workspace", filepath.Join(workspace.Root, "workspace.json"), "--json")
	var rollbackOut, rollbackDiagnostics bytes.Buffer
	rollbackCode := run([]string{"workspace", "rollback", "--workspace", filepath.Join(other.Root, "workspace.json"), "--json"}, &rollbackOut, &rollbackDiagnostics)
	var rollbackFailure struct {
		Error *devcontract.Error `json:"error"`
	}
	if err := json.Unmarshal(rollbackOut.Bytes(), &rollbackFailure); err != nil || rollbackCode != 4 || rollbackFailure.Error == nil || rollbackFailure.Error.Code != "rollback_not_allowed" {
		t.Fatalf("explicit rollback did not reach its lifecycle policy: code=%d out=%s err=%v", rollbackCode, rollbackOut.String(), err)
	}
	if _, err := os.Stat(filepath.Join(other.Root, "workspace.json")); err != nil {
		t.Fatalf("refused rollback mutated completed workspace: %v", err)
	}
	invoke("workspace", "remove", "--workspace", other.Root, "--json")
	if _, err := os.Stat(other.Root); !os.IsNotExist(err) {
		t.Fatalf("explicit directory remove retained its worktree: %v", err)
	}
	branch := workspace.Manifest.Repositories[0].Branch
	invoke("workspace", "remove", "--workspace", filepath.Join(workspace.Root, "workspace.json"), "--json")
	if _, err := os.Stat(workspace.Root); !os.IsNotExist(err) {
		t.Fatalf("explicit remove retained its worktree: %v", err)
	}
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
