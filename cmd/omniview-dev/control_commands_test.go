package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/omniviewdev/omniview/internal/instance"
)

func TestControlCommandTypedParameters(t *testing.T) {
	tests := []struct {
		args                     []string
		input, operation, params string
	}{
		{[]string{"instance", "inspect"}, "", "instance.inspect", `{}`},
		{[]string{"plugin", "list"}, "", "plugin.list", `{}`},
		{[]string{"plugin", "get", "one"}, "", "plugin.get", `{"id":"one"}`},
		{[]string{"plugin", "install-version", "one", "--version", "1.2.3"}, "", "plugin.install-version", `{"id":"one","version":"1.2.3"}`},
		{[]string{"plugin", "dev", "rebuild", "one", "--generation", "build-2"}, "", "plugin.dev.rebuild", `{"id":"one","generation":"build-2"}`},
		{[]string{"plugin", "dev", "logs", "two", "--cursor", "4", "--limit", "20"}, "", "plugin.dev.logs", `{"id":"two","cursor":4,"limit":20}`},
		{[]string{"settings", "get", "--scope", "plugin", "--plugin", "one", "--id", "password"}, "", "settings.get", `{"scope":"plugin","pluginID":"one","id":"password"}`},
		{[]string{"settings", "set", "--id", "editor.wrap", "--value", "false"}, "", "settings.set", `{"scope":"host","id":"editor.wrap","value":false}`},
		{[]string{"settings", "set-many", "--values", "-"}, `{"editor.size":14,"editor.wrap":true}`, "settings.bulk", `{"scope":"host","values":{"editor.size":14,"editor.wrap":true}}`},
		{[]string{"operation", "get", "op-1"}, "", "operation.get", `{"operationID":"op-1"}`},
	}
	for _, tt := range tests {
		t.Run(strings.Join(tt.args, " "), func(t *testing.T) {
			command, err := parseControlCommand(tt.args, strings.NewReader(tt.input), &bytes.Buffer{})
			if err != nil {
				t.Fatal(err)
			}
			if command.operation != tt.operation {
				t.Fatalf("operation %q", command.operation)
			}
			got, _ := json.Marshal(command.params)
			var a, b any
			if json.Unmarshal(got, &a) != nil || json.Unmarshal([]byte(tt.params), &b) != nil {
				t.Fatal("invalid test JSON")
			}
			aa, _ := json.Marshal(a)
			bb, _ := json.Marshal(b)
			if !bytes.Equal(aa, bb) {
				t.Fatalf("params %s, want %s", got, tt.params)
			}
		})
	}
}

func TestControlCommandRejectsInvalidInput(t *testing.T) {
	for _, args := range [][]string{
		{"plugin", "get"}, {"plugin", "dev", "start", "one", "two"},
		{"plugin", "install-version", "one"}, {"plugin", "dev", "rebuild", "one"},
		{"plugin", "dev", "logs", "one", "--limit", "501"},
		{"settings", "set", "--id", "x", "--value", "not-json"},
		{"settings", "set", "--id", "x", "--value", "1 2"},
		{"settings", "set-many", "--values", "[]"},
		{"settings", "get", "--scope", "plugin"},
		{"settings", "set", "--id", "x", "--value", "1", "--values", "{}"},
		{"instance", "inspect", "--shell", "rm"},
		{"plugin", "list", "--timeout", "0s"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			_, err := parseControlCommand(args, strings.NewReader(""), &bytes.Buffer{})
			if devcontract.ExitCode(err) != 2 {
				t.Fatalf("expected usage error, got %v", err)
			}
		})
	}
}

// This fixture exercises the real discovery store and real authenticated HTTP
// client. It owns no subprocess and cannot write to the production plugin root.
func controlFixture(t *testing.T, mutate func(*devcontract.InstanceDescriptor), handlers ...func(devcontract.Request, *devcontract.Response)) (string, *[]devcontract.Request) {
	t.Helper()
	return controlFixtureWithCustomState(t, "", mutate, handlers...)
}

func controlFixtureWithCustomState(t *testing.T, customState string, mutate func(*devcontract.InstanceDescriptor), handlers ...func(devcontract.Request, *devcontract.Response)) (string, *[]devcontract.Request) {
	t.Helper()
	home, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	root := t.TempDir()
	id := uuid.NewString()
	manifest := devcontract.WorkspaceManifest{SchemaVersion: 1, WorkspaceID: id, Slug: "client", DisplayName: "Client", Repositories: []devcontract.Repository{{ID: "omniview", Directory: "omniview", BaseRef: "main", BaseCommit: strings.Repeat("a", 40), Branch: "feature/client"}}, Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}}
	data, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(root, "workspace.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: root, Home: home})
	if err != nil {
		t.Fatal(err)
	}
	if customState != "" {
		customState, err = devcontract.CanonicalPath(customState)
		if err != nil {
			t.Fatal(err)
		}
		workspace, err = devcontract.SetCustomProfile(context.Background(), workspace, customState, home)
		if err != nil {
			t.Fatal(err)
		}
	}
	host, err := workspace.RepositoryPath("omniview")
	if err != nil {
		t.Fatal(err)
	}
	process, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: id, Generation: "host-1", Role: "host", Source: host})
	if err != nil {
		t.Fatal(err)
	}
	descriptor := devcontract.InstanceDescriptor{SchemaVersion: 1, WorkspaceID: id, InstanceID: id, Generation: "host-1", Kind: "development", StateRoot: workspace.StateRoot, Process: process, Readiness: "ready", StartedAt: time.Now()}
	token, err := devsession.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	requests := []devcontract.Request{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/control" || r.Header.Get("Authorization") != "Bearer "+string(token) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var request devcontract.Request
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			w.WriteHeader(400)
			return
		}
		requests = append(requests, request)
		response := devcontract.Response{ProtocolVersion: 1, RequestID: request.RequestID, WorkspaceID: id, Generation: "host-1", Status: "succeeded"}
		switch request.Operation {
		case "instance.inspect":
			actual := descriptor
			if mutate != nil {
				mutate(&actual)
			}
			response.Result, _ = json.Marshal(actual)
		case "plugin.list":
			response.Result = json.RawMessage(`[{"id":"one"},{"id":"two"}]`)
		case "plugin.dev.logs":
			var params devcontrol.LogsParams
			_ = json.Unmarshal(request.Params, &params)
			message := "[REDACTED]"
			if params.IncludeOutput {
				message = "build failed"
			}
			response.Result, _ = json.Marshal(devcontrol.LogPage{Entries: []devcontrol.LogEntry{{Source: "go", Level: "error", Message: message}}, NextCursor: 1})
		case "operation.wait":
			response.Status = "running"
			response.OperationID = "op-1"
			response.Error = devcontract.Fail(7, "timeout", "operation continues")
		default:
			response.Status = "accepted"
			response.OperationID = "op-1"
		}
		for _, handler := range handlers {
			handler(request, &response)
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	t.Cleanup(server.Close)
	endpoint := server.URL + "/v1/control"
	descriptor.Endpoints.Control = &endpoint
	profile, err := instance.Resolve(instance.Options{Workspace: workspace.ManifestPath, StateRoot: workspace.StateRoot, Home: home})
	if err != nil {
		t.Fatal(err)
	}
	store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Publish(context.Background(), descriptor, token); err != nil {
		t.Fatal(err)
	}
	return root, &requests
}

func TestControlCommandsRejectSelectedSourceMismatchBeforeMutation(t *testing.T) {
	root, requests := controlFixture(t, nil)
	path := filepath.Join(root, "workspace.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var manifest devcontract.WorkspaceManifest
	if err = json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.Repositories[0].Directory = "different-host"
	data, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	var out, diag bytes.Buffer
	handled, code := HandleControlCommand(context.Background(), []string{"plugin", "uninstall", "one", "--workspace", root}, strings.NewReader(""), &out, &diag)
	if !handled || code != 4 {
		t.Fatalf("wrong selected source was not rejected: handled=%v code=%d output=%s", handled, code, out.String())
	}
	if len(*requests) != 0 {
		t.Fatalf("wrong selected source reached the authenticated endpoint: %+v", *requests)
	}
}

func TestControlCommandsVerifyActualDescriptorBeforeMutation(t *testing.T) {
	root, requests := controlFixture(t, func(d *devcontract.InstanceDescriptor) { d.Generation = "replaced" })
	var out, diag bytes.Buffer
	handled, code := HandleControlCommand(context.Background(), []string{"plugin", "dev", "stop", "one", "--workspace", root}, strings.NewReader(""), &out, &diag)
	if !handled || code != 4 {
		t.Fatalf("handled=%v code=%d output=%s", handled, code, out.String())
	}
	if len(*requests) != 1 || (*requests)[0].Operation != "instance.inspect" {
		t.Fatalf("mutation reached wrong descriptor: %+v", *requests)
	}
}

func TestControlCommandsListInstalledAndPreserveAcceptedTimeout(t *testing.T) {
	root, requests := controlFixture(t, nil)
	var out, diag bytes.Buffer
	_, code := HandleControlCommand(context.Background(), []string{"plugin", "list", "--workspace", root}, strings.NewReader(""), &out, &diag)
	if code != 0 || !strings.Contains(out.String(), `"two"`) {
		t.Fatalf("code=%d output=%s", code, out.String())
	}
	if (*requests)[1].Operation != "plugin.list" {
		t.Fatalf("not installed plugin list: %+v", *requests)
	}
	out.Reset()
	_, code = HandleControlCommand(context.Background(), []string{"plugin", "dev", "start", "one", "--workspace", root, "--wait", "--timeout", "10ms"}, strings.NewReader(""), &out, &diag)
	if code != 7 || !strings.Contains(out.String(), `"operationID":"op-1"`) {
		t.Fatalf("timeout loses accepted operation: code=%d %s", code, out.String())
	}
}

func TestControlLogsStayOnStderr(t *testing.T) {
	root, _ := controlFixture(t, nil)
	var out, diag bytes.Buffer
	_, code := HandleControlCommand(context.Background(), []string{"plugin", "dev", "logs", "one", "--workspace", root}, strings.NewReader(""), &out, &diag)
	if code != 0 || !strings.Contains(diag.String(), "[REDACTED]") || strings.Contains(out.String(), "build failed") {
		t.Fatalf("code=%d stdout=%s stderr=%s", code, out.String(), diag.String())
	}
	var result devcontract.Response
	if json.Unmarshal(out.Bytes(), &result) != nil {
		t.Fatal("stdout is not one JSON response")
	}
}

func TestControlHandlerDoesNotClaimWorkspaceCommands(t *testing.T) {
	handled, _ := HandleControlCommand(context.Background(), []string{"workspace", "inspect"}, nil, &bytes.Buffer{}, &bytes.Buffer{})
	if handled {
		t.Fatal("workspace root handler was intercepted")
	}
}

func TestControlMutationsAddressTwoPluginsWithoutTouchingArchive(t *testing.T) {
	root, requests := controlFixture(t, nil)
	archive := filepath.Join(t.TempDir(), "plugin.tar.gz")
	original := []byte("caller-owned archive fixture")
	if err := os.WriteFile(archive, original, 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"plugin", "install-archive", "--path", archive},
		{"plugin", "dev", "start", "one"},
		{"plugin", "dev", "restart", "two"},
		{"plugin", "dev", "stop", "one"},
		{"plugin", "uninstall", "two"},
	} {
		var out, diag bytes.Buffer
		args = append(args, "--workspace", root)
		_, code := HandleControlCommand(context.Background(), args, strings.NewReader(""), &out, &diag)
		if code != 0 || !strings.Contains(out.String(), `"operationID":"op-1"`) {
			t.Fatalf("args=%v code=%d %s", args, code, out.String())
		}
	}
	data, err := os.ReadFile(archive)
	if err != nil || !bytes.Equal(data, original) {
		t.Fatalf("client changed caller archive: %v", err)
	}
	want := map[string]string{"plugin.dev.start": "one", "plugin.dev.restart": "two", "plugin.dev.stop": "one", "plugin.uninstall": "two"}
	for _, request := range *requests {
		if id, ok := want[request.Operation]; ok {
			var params devcontrol.PluginParams
			if json.Unmarshal(request.Params, &params) != nil || params.ID != id {
				t.Fatalf("wrong plugin target: %+v", request)
			}
		}
	}
}

func TestControlForwardsBuildFailureAndRecovery(t *testing.T) {
	var failed atomic.Bool
	failed.Store(true)
	root, _ := controlFixture(t, nil, func(request devcontract.Request, response *devcontract.Response) {
		if request.Operation == "operation.wait" {
			if failed.Load() {
				response.Status = "failed"
				response.Error = devcontract.Fail(5, "build_failed", "build failed; watcher retained")
			} else {
				response.Status = "succeeded"
				response.Error = nil
				response.Result = json.RawMessage(`{"ready":true,"generation":"build-3"}`)
			}
		}
	})
	for _, want := range []int{5, 0} {
		var out, diag bytes.Buffer
		_, code := HandleControlCommand(context.Background(), []string{"plugin", "dev", "rebuild", "one", "--generation", "build-2", "--workspace", root, "--wait"}, strings.NewReader(""), &out, &diag)
		if code != want {
			t.Fatalf("code=%d want=%d %s", code, want, out.String())
		}
		if want == 5 && !strings.Contains(out.String(), "build_failed") {
			t.Fatal("build error was suppressed")
		}
		if want == 0 && !strings.Contains(out.String(), `"ready":true`) {
			t.Fatal("recovery result was lost")
		}
		failed.Store(false)
	}
}

func TestControlForwardsSettingsValidationAndRedactedRead(t *testing.T) {
	root, _ := controlFixture(t, nil, func(request devcontract.Request, response *devcontract.Response) {
		switch request.Operation {
		case "settings.set":
			response.Status = "failed"
			response.Error = devcontract.Fail(2, "invalid_params", "setting value fails schema validation")
		case "settings.get":
			response.Result = json.RawMessage(`{"password":"[REDACTED]","enabled":true}`)
		}
	})
	var out, diag bytes.Buffer
	_, code := HandleControlCommand(context.Background(), []string{"settings", "set", "--scope", "plugin", "--plugin", "one", "--id", "enabled", "--value", `"wrong-type"`, "--workspace", root}, strings.NewReader(""), &out, &diag)
	if code != 2 || !strings.Contains(out.String(), "invalid_params") {
		t.Fatalf("validation code=%d %s", code, out.String())
	}
	out.Reset()
	_, code = HandleControlCommand(context.Background(), []string{"settings", "get", "--scope", "plugin", "--plugin", "one", "--workspace", root}, strings.NewReader(""), &out, &diag)
	if code != 0 || !strings.Contains(out.String(), "[REDACTED]") || diag.Len() != 0 {
		t.Fatalf("redaction code=%d stdout=%s stderr=%s", code, out.String(), diag.String())
	}
}

func TestControlRawLogsRequireDeliberateFlagAndWarning(t *testing.T) {
	root, _ := controlFixture(t, nil)
	var out, diag bytes.Buffer
	_, code := HandleControlCommand(context.Background(), []string{"plugin", "dev", "logs", "one", "--workspace", root, "--unsafe-output"}, strings.NewReader(""), &out, &diag)
	if code != 0 || !strings.Contains(out.String(), "build failed") || !strings.Contains(diag.String(), "WARNING") || !strings.Contains(diag.String(), "secrets") {
		t.Fatalf("code=%d stdout=%s stderr=%s", code, out.String(), diag.String())
	}
}

func TestControlWorkspaceLookupUsesActualRegistryAndEnclosingManifest(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	root := t.TempDir()
	source := filepath.Join(root, "omniview")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", source}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull, "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid", "GIT_TERMINAL_PROMPT=0", "GOWORK=off")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git fixture: %v %s", err, out)
		}
	}
	git("init", "-b", "main")
	git("commit", "--allow-empty", "-m", "fixture")
	ctx := context.Background()
	if _, err := devworkspace.Init(ctx, devworkspace.InitOptions{Root: root, Sources: []devworkspace.SourceSpec{{ID: "omniview", Path: source}}}); err != nil {
		t.Fatal(err)
	}
	manager, err := devworkspace.Open(root, devworkspace.Options{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	created, err := manager.Create(ctx, devworkspace.CreateOptions{Slug: "client-name", DisplayName: "Client Name"})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"client-name", created.Manifest.WorkspaceID, created.Root, created.ManifestPath} {
		actual, err := resolveControlWorkspace(ctx, root, name)
		if err != nil || actual.Manifest.WorkspaceID != created.Manifest.WorkspaceID {
			t.Fatalf("lookup %q: %+v %v", name, actual, err)
		}
	}
	t.Chdir(filepath.Join(created.Root, "omniview"))
	actual, err := resolveControlWorkspace(ctx, "", "")
	if err != nil || actual.ManifestPath != created.ManifestPath {
		t.Fatalf("enclosing lookup: %+v %v", actual, err)
	}
	if _, err = resolveControlWorkspace(ctx, root, "missing"); devcontract.ExitCode(err) != 3 {
		t.Fatalf("unknown name should exit3: %v", err)
	}
	t.Setenv(devcontract.WorkspaceEnvironment, filepath.Join(t.TempDir(), "workspace.json"))
	if _, err = resolveControlWorkspace(ctx, root, "client-name"); devcontract.ExitCode(err) != 4 {
		t.Fatalf("environment conflict should exit4: %v", err)
	}
}

func TestControlSetManySendsAllowlistedBulkOperation(t *testing.T) {
	root, requests := controlFixture(t, nil)
	var out, diag bytes.Buffer
	_, code := HandleControlCommand(context.Background(), []string{"settings", "set-many", "--workspace", root, "--scope", "plugin", "--plugin", "one", "--values", "-"}, strings.NewReader(`{"enabled":false,"size":14}`), &out, &diag)
	if code != 0 {
		t.Fatalf("code=%d stdout=%s stderr=%s", code, out.String(), diag.String())
	}
	if len(*requests) != 2 {
		t.Fatalf("expected inspect and bulk mutation, got %+v", *requests)
	}
	mutation := (*requests)[1]
	if mutation.Operation != "settings.bulk" {
		t.Fatalf("operation=%q", mutation.Operation)
	}
	var params devcontrol.SettingsParams
	if err := json.Unmarshal(mutation.Params, &params); err != nil {
		t.Fatal(err)
	}
	if params.Scope != "plugin" || params.PluginID != "one" || string(params.Values["enabled"]) != "false" || string(params.Values["size"]) != "14" {
		t.Fatalf("typed bulk params=%s", mutation.Params)
	}
}

func TestControlCustomStateUsesUUIDRuntimeNotAdjacentDiscovery(t *testing.T) {
	root, requests := controlFixtureWithCustomState(t, filepath.Join(t.TempDir(), "custom-profile", "state"), nil)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: root, Home: home})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("OMNIVIEW_STATE_DIR", workspace.StateRoot)
	profile, err := instance.Resolve(instance.Options{Workspace: workspace.ManifestPath, StateRoot: workspace.StateRoot, Home: home})
	if err != nil {
		t.Fatal(err)
	}
	adjacentRuntime := filepath.Join(filepath.Dir(workspace.StateRoot), "runtime")
	if adjacentRuntime == profile.RuntimeRoot {
		t.Fatal("custom binding did not separate persistent state from UUID-owned runtime")
	}
	actualStore, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := actualStore.Read(context.Background(), workspace.Manifest.WorkspaceID, "")
	if err != nil {
		t.Fatal(err)
	}
	var decoyRequests atomic.Int32
	decoyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decoyRequests.Add(1)
		http.Error(w, "adjacent discovery must not be contacted", http.StatusInternalServerError)
	}))
	t.Cleanup(decoyServer.Close)
	decoyEndpoint := decoyServer.URL + "/v1/control"
	decoyDescriptor := actual.InstanceDescriptor
	decoyDescriptor.Endpoints.Control = &decoyEndpoint
	decoyToken, err := devsession.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	decoyStore, err := devsession.OpenDiscoveryStore(adjacentRuntime)
	if err != nil {
		t.Fatal(err)
	}
	decoy, err := decoyStore.Publish(context.Background(), decoyDescriptor, decoyToken)
	if err != nil {
		t.Fatal(err)
	}
	decoyDiscoveryPath := filepath.Join(adjacentRuntime, "discovery.json")
	before, err := os.ReadFile(decoyDiscoveryPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"instance", "inspect"}, {"plugin", "dev", "stop", "one"}} {
		var out, diagnostics bytes.Buffer
		args = append(args, "--workspace", root)
		handled, code := HandleControlCommand(context.Background(), args, strings.NewReader(""), &out, &diagnostics)
		if !handled || code != 0 {
			t.Fatalf("custom-profile command %v: handled=%v code=%d stdout=%s stderr=%s", args, handled, code, out.String(), diagnostics.String())
		}
		if args[0] == "instance" {
			var response devcontract.Response
			var descriptor devcontract.InstanceDescriptor
			if json.Unmarshal(out.Bytes(), &response) != nil || json.Unmarshal(response.Result, &descriptor) != nil || descriptor.StateRoot != workspace.StateRoot || descriptor.Generation != actual.Generation {
				t.Fatalf("wrong authenticated custom-profile descriptor: %s", out.String())
			}
		}
	}
	if decoyRequests.Load() != 0 {
		t.Fatal("control command contacted discovery beside custom state")
	}
	if len(*requests) != 3 || (*requests)[0].Operation != "instance.inspect" || (*requests)[1].Operation != "instance.inspect" || (*requests)[2].Operation != "plugin.dev.stop" {
		t.Fatalf("actual UUID-runtime endpoint did not receive inspect/mutation: %+v", *requests)
	}
	after, err := os.ReadFile(decoyDiscoveryPath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("adjacent discovery sentinel changed: %v", err)
	}
	afterToken, err := os.ReadFile(decoy.TokenFile)
	if err != nil || !bytes.Equal(decoyToken, afterToken) {
		t.Fatalf("adjacent token sentinel changed: %v", err)
	}
}
