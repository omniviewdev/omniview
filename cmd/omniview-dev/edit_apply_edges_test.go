package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

func TestWorkspaceInvalidApplyNeverRequestsHealthySupervisorStopEdges(t *testing.T) {
	for _, flags := range [][]string{
		{"--add-plugin", "unregistered"},
		{"--slug", "../escape"},
		{"--add-repo", "unregistered"},
		{"--upstream", "omniview=invalid"},
		{"--slug", "occupied"},
		{"--slug", "redirected"},
	} {
		t.Run(strings.Join(flags, "/"), func(t *testing.T) {
			f := newCLIEdgeFixture(t)
			before := f.manifest()
			var decoy devworkspace.Workspace
			if err := json.Unmarshal(f.success("workspace", "create", "occupied", "--root", f.root, "--json"), &decoy); err != nil {
				t.Fatal(err)
			}
			decoyBefore, err := os.ReadFile(decoy.ManifestPath)
			if err != nil {
				t.Fatal(err)
			}
			redirect := filepath.Join(filepath.Dir(f.workspace.Root), "redirected")
			if err := os.Symlink(decoy.Root, redirect); err != nil {
				t.Fatal(err)
			}
			preserved := map[string][]byte{}
			for _, root := range []string{f.workspace.Root, decoy.Root} {
				path := filepath.Join(root, "omniview", "tracked")
				raw, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				preserved[path] = raw
			}
			generation := "edge-owned-supervisor"
			token := strings.Repeat("e", 64)
			owner, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: f.workspace.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: f.workspace.Root})
			if err != nil {
				t.Fatal(err)
			}
			var statuses, mutations atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(out http.ResponseWriter, request *http.Request) {
				var command struct {
					WorkspaceID string `json:"workspaceID"`
					Generation  string `json:"generation"`
					Command     string `json:"command"`
				}
				if request.Method != http.MethodPost || request.URL.Path != "/v1/supervisor" || request.Header.Get("Authorization") != "Bearer "+token || json.NewDecoder(request.Body).Decode(&command) != nil || command.WorkspaceID != f.workspace.Manifest.WorkspaceID || command.Generation != generation {
					http.Error(out, "invalid authenticated request", http.StatusForbidden)
					return
				}
				status := devworkspace.Status{Workspace: f.workspace, Generation: generation, Phase: "ready"}
				if command.Command == "status" {
					statuses.Add(1)
					_ = json.NewEncoder(out).Encode(map[string]any{"status": status})
					return
				}
				// This boundary records attempted effects without ever stopping a process.
				mutations.Add(1)
				_ = json.NewEncoder(out).Encode(map[string]any{"status": status, "error": devcontract.Fail(4, "edge_stop_forbidden", "invalid edit must not reach supervisor mutation")})
			}))
			t.Cleanup(server.Close)
			tokenPath := filepath.Join(f.workspace.Root, ".local", "supervisor-"+generation+".secret")
			if err := os.MkdirAll(filepath.Dir(tokenPath), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(tokenPath, []byte(token), 0600); err != nil {
				t.Fatal(err)
			}
			if err := devsession.WritePrivateJSON(filepath.Join(f.workspace.Root, ".local", "supervisor.json"), map[string]any{"workspaceID": f.workspace.Manifest.WorkspaceID, "generation": generation, "endpoint": server.URL + "/v1/supervisor", "tokenFile": tokenPath, "process": owner}); err != nil {
				t.Fatal(err)
			}
			// Prove the live authenticated fixture works before exercising refusal ordering.
			f.success("workspace", "inspect", "feature", "--root", f.root, "--json")
			if statuses.Load() == 0 {
				t.Fatal("inspect did not authenticate live supervisor")
			}
			args := append([]string{"workspace", "edit", "feature", "--root", f.root, "--apply", "--name", "Must not persist", "--json"}, flags...)
			var out, diagnostics bytes.Buffer
			if code := run(args, &out, &diagnostics); code == 0 {
				t.Errorf("invalid apply succeeded: %s", &out)
			}
			if flags[0] == "--slug" && (flags[1] == "occupied" || flags[1] == "redirected") {
				var result struct {
					Error *devcontract.Error `json:"error"`
				}
				if err := json.Unmarshal(out.Bytes(), &result); err != nil || result.Error == nil || result.Error.Code != "workspace_exists" {
					t.Errorf("occupied destination did not reach canonical refusal: %s %v", &out, err)
				}
			}
			if mutations.Load() != 0 {
				t.Errorf("invalid edit attempted %d supervisor mutations before canonical refusal", mutations.Load())
			}
			if !bytes.Equal(before, f.manifest()) {
				t.Fatal("invalid apply changed manifest")
			}
			if after, err := os.ReadFile(decoy.ManifestPath); err != nil || !bytes.Equal(decoyBefore, after) {
				t.Fatalf("invalid apply changed destination workspace: %s %v", after, err)
			}
			if target, err := os.Readlink(redirect); err != nil || target != decoy.Root {
				t.Fatalf("invalid apply changed destination redirect: %q %v", target, err)
			}
			for path, before := range preserved {
				if after, err := os.ReadFile(path); err != nil || !bytes.Equal(before, after) {
					t.Errorf("invalid apply changed source bytes at %s: %q %v", path, after, err)
				}
			}
		})
	}
}
