package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
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

func TestWorkspaceUpstreamFlagSemantics(t *testing.T) {
	command, err := parseWorkspaceCommand([]string{
		"workspace", "edit", "feature", "--upstream", "omniview=origin/main", "--upstream", "ui=upstream/release/next",
	}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	values, err := workspaceAssignments(command.upstreams)
	if err != nil || values["omniview"] != "origin/main" ||
		values["ui"] != "upstream/release/next" || !command.supplied["upstream"] {
		t.Fatalf("upstream assignments changed: %+v %v", command, err)
	}
	command, err = parseWorkspaceCommand([]string{
		"workspace", "update", "feature", "--check=false", "--repo", "omniview",
	}, io.Discard)
	if err != nil || command.check || !command.supplied["check"] || len(command.repositories) != 1 {
		t.Fatalf("explicit false check lost: %+v %v", command, err)
	}
	command, err = parseWorkspaceCommand([]string{"workspace", "follow", "feature"}, io.Discard)
	if err != nil || command.apply || command.interval != 30*time.Second || command.supplied["apply"] {
		t.Fatalf("unsafe follow defaults: %+v %v", command, err)
	}
	command, err = parseWorkspaceCommand([]string{
		"workspace", "follow", "feature", "--apply=false", "--watch=false", "--interval=5s",
	}, io.Discard)
	if err != nil || command.apply || command.launch.Watch || command.interval != 5*time.Second ||
		!command.supplied["apply"] || !command.supplied["watch"] {
		t.Fatalf("explicit false follow flags lost: %+v %v", command, err)
	}
	for _, value := range []string{"0s", "-1s", "4999ms"} {
		_, err = parseWorkspaceCommand([]string{"workspace", "follow", "feature", "--interval=" + value}, io.Discard)
		if devcontract.ExitCode(err) != 2 {
			t.Fatalf("invalid interval accepted: %s: %v", value, err)
		}
	}
}

func TestWorkspaceSavedLaunchFlagsIncludeFollowAndExplicitFalse(t *testing.T) {
	w := devworkspace.Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: t.TempDir()}}
	directory, err := devsession.EnsurePrivateDirectory(filepath.Join(w.Root, ".local"))
	if err != nil {
		t.Fatal(err)
	}
	saved := devworkspace.LaunchOptions{
		Mode: "native", MCP: true, Watch: true, LiveFrontend: true,
		ReviewedSDKRevision: strings.Repeat("a", 40), AllowIsolationSourceChanges: true,
		Timeout: 7 * time.Minute,
	}
	if err = devsession.WritePrivateJSON(filepath.Join(directory, "launch.json"), saved); err != nil {
		t.Fatal(err)
	}
	for _, verb := range []string{"up", "refresh", "update", "follow", "recover"} {
		t.Run(verb, func(t *testing.T) {
			checkWorkspaceSavedLaunchFlags(t, verb, w, saved)
		})
	}
	saved.Mode = "browser"
	saved.MCP = false
	saved.Watch = false
	saved.LiveFrontend = false
	saved.AllowIsolationSourceChanges = false
	if err = devsession.WritePrivateJSON(filepath.Join(directory, "launch.json"), saved); err != nil {
		t.Fatal(err)
	}
	for _, verb := range []string{"up", "refresh", "update", "follow", "recover"} {
		checkWorkspaceSavedTimeout(t, verb, w, saved)
	}
}

func checkWorkspaceSavedLaunchFlags(
	t *testing.T, verb string, w devworkspace.Workspace, saved devworkspace.LaunchOptions,
) {
	t.Helper()
	command, err := parseWorkspaceCommand([]string{"workspace", verb, "feature"}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	options, err := workspaceLaunchOptions(command, w)
	if err != nil || !reflect.DeepEqual(options, saved) {
		t.Fatalf("saved options changed: %+v %v", options, err)
	}
	refresh, err := workspaceRefreshOptions(command, w, io.Discard)
	if err != nil || refresh.Launch != nil {
		t.Fatalf("omitted flags became explicit launch options: %+v %v", refresh, err)
	}
	command, err = parseWorkspaceCommand([]string{
		"workspace", verb, "feature", "--mcp=false", "--watch=false", "--live-frontend=false",
		"--allow-isolation-source-changes=false",
	}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	refresh, err = workspaceRefreshOptions(command, w, io.Discard)
	if err != nil || refresh.Launch == nil {
		t.Fatalf("explicit launch override missing: %+v %v", refresh, err)
	}
	got := *refresh.Launch
	want := saved
	want.MCP = false
	want.Watch = false
	want.LiveFrontend = false
	want.AllowIsolationSourceChanges = false
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("explicit false or saved settings lost: %+v", got)
	}
}

func checkWorkspaceSavedTimeout(
	t *testing.T, verb string, w devworkspace.Workspace, saved devworkspace.LaunchOptions,
) {
	t.Helper()
	command, err := parseWorkspaceCommand([]string{"workspace", verb, "feature", "--timeout=3s"}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	refresh, err := workspaceRefreshOptions(command, w, io.Discard)
	if err != nil || refresh.Launch == nil {
		t.Fatalf("%s: explicit timeout missing: %+v %v", verb, refresh, err)
	}
	got := *refresh.Launch
	want := saved
	want.Timeout = 3 * time.Second
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s: Cobra defaults replaced saved false values: %+v", verb, got)
	}
}

type cancelWorkspaceFollowOnPlan struct {
	bytes.Buffer
	cancel context.CancelFunc
}

func (w *cancelWorkspaceFollowOnPlan) Write(raw []byte) (int, error) {
	n, err := w.Buffer.Write(raw)
	var status devworkspace.FollowStatus
	if json.Unmarshal(raw, &status) == nil && status.Plan != nil {
		w.cancel()
	}
	return n, err
}

func TestWorkspaceUpstreamCLIObservesRealRemoteWithoutSourceMutation(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", t.TempDir())
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	source := filepath.Join(root, "source")
	remote := filepath.Join(root, "origin.git")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	git := func(directory string, args ...string) string {
		t.Helper()
		command := exec.Command("git", args...)
		command.Dir = directory
		raw, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %s %v", args, raw, err)
		}
		return strings.TrimSpace(string(raw))
	}
	git(source, "init", "-b", "main")
	git(source, "config", "user.name", "Fixture")
	git(source, "config", "user.email", "fixture@example.invalid")
	if err := os.WriteFile(filepath.Join(source, "tracked"), []byte("original\n"), 0600); err != nil {
		t.Fatal(err)
	}
	git(source, "add", "tracked")
	git(source, "commit", "-m", "initial")
	old := git(source, "rev-parse", "HEAD")
	git(root, "init", "--bare", remote)
	git(source, "remote", "add", "origin", remote)
	git(source, "push", "origin", "main")
	invoke := func(args ...string) []byte {
		t.Helper()
		var out, diagnostics bytes.Buffer
		if code := run(args, &out, &diagnostics); code != 0 {
			t.Fatalf("%v: exit=%d stdout=%s stderr=%s", args, code, &out, &diagnostics)
		}
		if !json.Valid(out.Bytes()) {
			t.Fatalf("not one JSON result: %s", &out)
		}
		return out.Bytes()
	}
	invoke("workspace", "init", "--root", root, "--source", "omniview="+source, "--source-ref", "omniview=main", "--json")
	var created devworkspace.Workspace
	if err := json.Unmarshal(invoke("workspace", "create", "feature", "--root", root, "--json"), &created); err != nil {
		t.Fatal(err)
	}
	invoke("workspace", "edit", "feature", "--root", root, "--upstream", "omniview=origin/main", "--json")
	before, err := os.ReadFile(created.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	checkWorkspaceCurrentFollow(t, root, created, before)
	publisher := filepath.Join(root, "publisher")
	git(root, "clone", "--branch", "main", remote, publisher)
	git(publisher, "config", "user.name", "Fixture")
	git(publisher, "config", "user.email", "fixture@example.invalid")
	if err = os.WriteFile(filepath.Join(publisher, "tracked"), []byte("upstream\n"), 0600); err != nil {
		t.Fatal(err)
	}
	git(publisher, "add", "tracked")
	git(publisher, "commit", "-m", "upstream change")
	target := git(publisher, "rev-parse", "HEAD")
	git(publisher, "push", "origin", "main")
	var result devworkspace.RefreshResult
	rawResult := invoke("workspace", "update", "feature", "--root", root, "--check", "--repo", "omniview", "--json")
	if err = json.Unmarshal(rawResult, &result); err != nil {
		t.Fatal(err)
	}
	checkWorkspaceUpstreamPlan(t, result, target, old)
	checkWorkspaceObserveFollow(t, root)
	after, err := os.ReadFile(created.ManifestPath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("observation changed manifest: %s %v", after, err)
	}
	checkout := filepath.Join(created.Root, created.Manifest.Repositories[0].Directory)
	if got := git(checkout, "rev-parse", "HEAD"); got != old {
		t.Fatalf("observation advanced workspace: %s", got)
	}
	if got := git(source, "rev-parse", "HEAD"); got != old {
		t.Fatalf("observation changed canonical source: %s", got)
	}
	if raw, readErr := os.ReadFile(filepath.Join(checkout, "tracked")); readErr != nil || string(raw) != "original\n" {
		t.Fatalf("observation changed source bytes: %s %v", raw, readErr)
	}
	checkWorkspaceBlockedUpdate(t, root, checkout, old, git)
}

func checkWorkspaceUpstreamPlan(t *testing.T, result devworkspace.RefreshResult, target, old string) {
	t.Helper()
	if result.Plan == nil || result.Plan.Result != "update_available" || len(result.Plan.Repositories) != 1 {
		t.Fatalf("missing check plan: %+v", result)
	}
	repository := result.Plan.Repositories[0]
	if repository.TargetSHA != target || repository.OldSHA != old || repository.Classification != "behind" {
		t.Fatalf("check did not fetch real upstream: %+v", repository)
	}
}

func visitWorkspaceFollowStatuses(t *testing.T, raw []byte, visit func(devworkspace.FollowStatus)) {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	for {
		var status devworkspace.FollowStatus
		err := decoder.Decode(&status)
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			t.Fatalf("invalid follow JSON stream: %s %v", raw, err)
		}
		visit(status)
	}
}

func checkWorkspaceCurrentFollow(t *testing.T, root string, created devworkspace.Workspace, before []byte) {
	t.Helper()
	var failed, failedDiagnostics bytes.Buffer
	code := run([]string{
		"workspace", "edit", "feature", "--root", root, "--name", "Must Not Persist",
		"--upstream", "omniview=missing/main", "--json",
	}, &failed, &failedDiagnostics)
	if code == 0 {
		t.Fatal("accepted nonexistent upstream remote")
	}
	afterFailure, err := os.ReadFile(created.ManifestPath)
	if err != nil || !bytes.Equal(before, afterFailure) {
		t.Fatalf("failed combined edit changed manifest: %s %v", afterFailure, err)
	}
	applyContext, stopApply := context.WithTimeout(context.Background(), 10*time.Second)
	defer stopApply()
	applyStream := &cancelWorkspaceFollowOnPlan{cancel: stopApply}
	var applyDiagnostics bytes.Buffer
	code = runWithInput(applyContext, []string{
		"workspace", "follow", "feature", "--root", root, "--repo", "omniview", "--apply", "--json",
	}, strings.NewReader(""), applyStream, &applyDiagnostics)
	if code != 0 {
		t.Fatalf("current-cohort apply follow exit=%d stdout=%s stderr=%s", code, applyStream.String(), &applyDiagnostics)
	}
	for _, warning := range []string{
		"selected repositories: omniview", "execute code with your local permissions", "not a sandbox",
	} {
		if !strings.Contains(applyDiagnostics.String(), warning) {
			t.Errorf("apply consent omitted %q: %s", warning, &applyDiagnostics)
		}
	}
	observedCurrent := false
	visitWorkspaceFollowStatuses(t, applyStream.Bytes(), func(status devworkspace.FollowStatus) {
		if status.Apply && status.Plan != nil && status.Plan.Result == "up_to_date" {
			observedCurrent = true
		}
	})
	if !observedCurrent {
		t.Fatalf("apply-follow did not observe unchanged cohort: %s", applyStream.String())
	}
}

func checkWorkspaceObserveFollow(t *testing.T, root string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	stream := &cancelWorkspaceFollowOnPlan{cancel: cancel}
	var diagnostics bytes.Buffer
	code := runWithInput(ctx, []string{
		"workspace", "follow", "feature", "--root", root, "--interval=5s", "--apply=false", "--json",
	}, strings.NewReader(""), stream, &diagnostics)
	if code != 0 {
		t.Fatalf("follow exit=%d stdout=%s stderr=%s", code, stream.String(), &diagnostics)
	}
	observed := false
	visitWorkspaceFollowStatuses(t, stream.Bytes(), func(status devworkspace.FollowStatus) {
		if status.Apply {
			t.Fatal("observe-only follow gained apply consent")
		}
		if status.Plan != nil && status.Plan.Result == "update_available" {
			observed = true
		}
	})
	if !observed || strings.Contains(diagnostics.String(), "Follow apply trusts") {
		t.Fatalf("observe-only contract lost: %s stderr=%s", stream.String(), &diagnostics)
	}
}

func checkWorkspaceBlockedUpdate(
	t *testing.T, root, checkout, old string, git func(string, ...string) string,
) {
	t.Helper()
	note := filepath.Join(checkout, "local-note")
	if err := os.WriteFile(note, []byte("authored data\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var blockedOut, blockedDiagnostics bytes.Buffer
	code := run([]string{
		"workspace", "update", "feature", "--root", root, "--repo", "omniview", "--json",
	}, &blockedOut, &blockedDiagnostics)
	var blocked struct {
		Error *devcontract.Error       `json:"error"`
		Plan  *devworkspace.UpdatePlan `json:"plan"`
	}
	if err := json.Unmarshal(blockedOut.Bytes(), &blocked); err != nil ||
		code != 4 || blocked.Error == nil || blocked.Plan == nil {
		t.Fatalf("blocked update lost plan/error: exit=%d stdout=%s stderr=%s err=%v",
			code, &blockedOut, &blockedDiagnostics, err)
	}
	if len(blocked.Plan.Repositories) != 1 || len(blocked.Plan.Repositories[0].BlockerPaths) == 0 {
		t.Fatalf("blocked update omitted authored paths: %+v", blocked.Plan)
	}
	if raw, err := os.ReadFile(note); err != nil || string(raw) != "authored data\n" {
		t.Fatalf("blocked update changed authored bytes: %s %v", raw, err)
	}
	if got := git(checkout, "rev-parse", "HEAD"); got != old {
		t.Fatalf("blocked update advanced workspace: %s", got)
	}
}

func TestWorkspaceEditApplyRestartAuthority(t *testing.T) {
	for _, test := range []struct {
		name, phase, generation string
		restart                 bool
	}{
		{"ready", "ready", "owned-generation", true},
		{"starting", "starting", "owned-generation", true},
		{"failed-live-supervisor", "failed", "owned-generation", true},
		{"stopped", "stopped", "previous-generation", false},
		{"crashed", "crashed", "previous-generation", false},
		{"never-started", "stopped", "", false},
		{"phase-without-owner", "ready", "", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			status := devworkspace.Status{Phase: test.phase, Generation: test.generation}
			if got := workspaceWasRunning(status); got != test.restart {
				t.Fatalf("restart authority=%t want=%t for %+v", got, test.restart, status)
			}
		})
	}
}

func TestWorkspaceEditApplyCLILeavesStoppedWorkspaceStopped(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", t.TempDir())
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	source := filepath.Join(root, "source")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", args...)
		command.Dir = source
		if raw, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s %v", args, raw, err)
		}
	}
	git("init", "-b", "main")
	git("config", "user.name", "Fixture")
	git("config", "user.email", "fixture@example.invalid")
	if err := os.WriteFile(filepath.Join(source, "tracked"), []byte("source\n"), 0600); err != nil {
		t.Fatal(err)
	}
	git("add", "tracked")
	git("commit", "-m", "initial")
	invoke := func(args ...string) []byte {
		t.Helper()
		var out, diagnostics bytes.Buffer
		if code := run(args, &out, &diagnostics); code != 0 {
			t.Fatalf("%v: exit=%d stdout=%s stderr=%s", args, code, &out, &diagnostics)
		}
		return out.Bytes()
	}
	invoke("workspace", "init", "--root", root, "--source", "omniview="+source, "--source-ref", "omniview=main", "--json")
	var created devworkspace.Workspace
	if err := json.Unmarshal(invoke("workspace", "create", "feature", "--root", root, "--json"), &created); err != nil {
		t.Fatal(err)
	}
	var out, diagnostics bytes.Buffer
	code := run([]string{
		"workspace", "edit", "feature", "--root", root, "--name", "Edited While Stopped", "--apply", "--json",
	}, &out, &diagnostics)
	var failure struct {
		Error *devcontract.Error `json:"error"`
	}
	if err := json.Unmarshal(out.Bytes(), &failure); err != nil || code != 3 ||
		failure.Error == nil || failure.Error.Code != "refresh_evidence_required" {
		t.Fatalf("missing real dependency proof was not reported: exit=%d stdout=%s stderr=%s err=%v",
			code, &out, &diagnostics, err)
	}
	var status devworkspace.Status
	if err := json.Unmarshal(invoke("workspace", "inspect", "feature", "--root", root, "--json"), &status); err != nil {
		t.Fatal(err)
	}
	if status.Manifest.DisplayName != "Edited While Stopped" ||
		status.Manifest.WorkspaceID != created.Manifest.WorkspaceID ||
		status.Phase != "stopped" || status.Generation != "" || workspaceWasRunning(status) {
		t.Fatalf("edit --apply started or replaced stopped workspace identity: %+v", status)
	}
	for _, name := range []string{"supervisor.json", "launch.json"} {
		if _, err := os.Stat(filepath.Join(created.Root, ".local", name)); !os.IsNotExist(err) {
			t.Fatalf("edit --apply created launch state for stopped workspace: %s: %v", name, err)
		}
	}
}
