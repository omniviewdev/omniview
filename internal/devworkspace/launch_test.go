package devworkspace

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestLaunchOptionsRejectUnreviewedSDKAndInvalidModes(t *testing.T) {
	for _, o := range []LaunchOptions{{Mode: "browser"}, {Mode: "other", ReviewedSDKRevision: strings.Repeat("a", 40)}, {Mode: "browser", ReviewedSDKRevision: "base7bc9616"}, {Mode: "browser", ReviewedSDKRevision: strings.Repeat("a", 40), MCP: true}} {
		if err := o.validate(); err == nil {
			t.Fatalf("accepted invalid launch options: %+v", o)
		}
	}
	if err := (LaunchOptions{Mode: "native", ReviewedSDKRevision: strings.Repeat("a", 40), MCP: true}).validate(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkspaceChildEnvironmentDoesNotLeakHostModuleFlags(t *testing.T) {
	w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: "/selected", ManifestPath: "/selected/workspace.json", StateRoot: "/profile/state", Manifest: devcontract.WorkspaceManifest{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6"}}}
	o := LaunchOptions{ReviewedSDKRevision: strings.Repeat("a", 40), Watch: true}
	env := workspaceEnvironment([]string{"HOME=/unchanged", "GOFLAGS=-modfile=/foreign.mod", "GOWORK=/foreign.work", "OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES=1", "OMNIVIEW_WORKSPACE_FILE=/foreign", "PNPM_CONFIG_WORKSPACE_DIR=/foreign/root", "pnpm_config_workspace_dir=/foreign/root", "NPM_CONFIG_WORKSPACE_DIR=/foreign/root", "npm_config_workspace_dir=/foreign/root"}, w, "generation", o)
	joined := strings.Join(env, "\n")
	if strings.Contains(joined, "/foreign") || strings.Contains(joined, "OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES=1") {
		t.Fatal(joined)
	}
	for _, wanted := range []string{"HOME=/unchanged", "GOWORK=off", "GOFLAGS=", "OMNIVIEW_WORKSPACE_FILE=/selected/workspace.json", "OMNIVIEW_WORKSPACE_GRAPH_WATCH=1"} {
		if !strings.Contains(joined, wanted) {
			t.Fatalf("missing %s: %s", wanted, joined)
		}
	}
	o.AllowIsolationSourceChanges = true
	if !strings.Contains(strings.Join(workspaceEnvironment(nil, w, "generation", o), "\n"), "OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES=1") {
		t.Fatal("explicit opt-in absent")
	}
}

func TestSupervisorAuthenticationAndExactGeneration(t *testing.T) {
	token := []byte(strings.Repeat("s", 43))
	calls := 0
	h := supervisorHandler("workspace", "generation", token, func(ctx context.Context, command string) (Status, error) {
		calls++
		return Status{Phase: "stopped"}, nil
	})
	for _, tc := range []struct {
		authorization, body string
		code                int
	}{{"", `{"workspaceID":"workspace","generation":"generation","command":"stop"}`, 401}, {"Bearer " + string(token), `{"workspaceID":"workspace","generation":"stale","command":"stop"}`, 409}, {"Bearer " + string(token), `{"workspaceID":"workspace","generation":"generation","command":"stop"}`, 200}} {
		r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/supervisor", strings.NewReader(tc.body))
		r.Host = "127.0.0.1"
		r.Header.Set("Authorization", tc.authorization)
		r.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		h.ServeHTTP(response, r)
		if response.Code != tc.code {
			t.Fatalf("got %d want %d: %s", response.Code, tc.code, response.Body.String())
		}
	}
	if calls != 1 {
		t.Fatalf("unauthorized/stale request mutated supervisor: %d", calls)
	}
}

func TestSupervisorStatusWritesAtomicPrivateJSON(t *testing.T) {
	root, canonicalErr := devcontract.CanonicalPath(t.TempDir())
	if canonicalErr != nil {
		t.Fatal(canonicalErr)
	}
	path := filepath.Join(root, "status.json")
	for _, phase := range []string{"building", "ready", "stopped"} {
		if err := saveLaunchJSON(path, Status{Phase: phase}); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var status Status
		if err = json.Unmarshal(raw, &status); err != nil || status.Phase != phase {
			t.Fatalf("status not atomically replaced: %s %v", raw, err)
		}
	}
	if err := devsession.ValidatePrivateFile(path); err != nil {
		t.Fatalf("status is not platform-private: %v", err)
	}
}

func TestReadinessRejectsForeignIdentityAndStartingDescriptor(t *testing.T) {
	target := devcontract.InstanceDescriptor{WorkspaceID: "workspace", InstanceID: "workspace", Generation: "generation", StateRoot: "/profile/state", Readiness: "host-ready"}
	for _, change := range []func(*devcontract.InstanceDescriptor){func(d *devcontract.InstanceDescriptor) { d.Generation = "other" }, func(d *devcontract.InstanceDescriptor) { d.WorkspaceID = "other" }, func(d *devcontract.InstanceDescriptor) { d.StateRoot = "/other" }, func(d *devcontract.InstanceDescriptor) { d.Readiness = "starting" }} {
		candidate := target
		change(&candidate)
		if hostDescriptorReady(candidate, target) == nil {
			t.Fatalf("accepted %+v", candidate)
		}
	}
	if err := hostDescriptorReady(target, target); err != nil {
		t.Fatal(err)
	}
}

func TestSupervisorClientHonorsDeadline(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := callSupervisor(ctx, supervisorRecord{Endpoint: server.URL, WorkspaceID: "workspace", Generation: "generation"}, []byte(strings.Repeat("s", 43)), "status")
	if err == nil {
		t.Fatal("deadline accepted as readiness")
	}
}

func TestFailedBindDetectionRequiresExactPortOnFailureLine(t *testing.T) {
	output := &childOutput{}
	output.Write([]byte("Browser ready at http://127.0.0.1:20123\nlisten tcp 127.0.0.1:20124: bind: address already in use\n"))
	if output.failedBind(20123) {
		t.Fatal("successful browser port was blamed for unrelated listener conflict")
	}
	if !output.failedBind(20124) {
		t.Fatal("actual failed assigned listener was not identified")
	}
	if output.failedBind(123) {
		t.Fatal("partial decimal port substring was adopted")
	}
}
