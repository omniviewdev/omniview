//go:build devcontrol

package host

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/instance"
)

func TestDevelopmentBrowserEndpointRequiresItsBootIdentity(t *testing.T) {
	identity := devcontract.BootIdentity{SchemaVersion: 1, InstanceID: "profile-a", Kind: "development", DisplayName: "Feature <alpha>"}
	server := httptest.NewServer(instance.BootMiddleware(identity)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, "<!doctype html><html><head><title>Omniview</title></head><body></body></html>")
	})))
	defer server.Close()
	client := developmentHTTPClient()
	defer client.CloseIdleConnections()
	if !developmentBrowserObserved(context.Background(), client, server.URL, identity) {
		t.Fatal("owned injected document was not recognized")
	}
	foreign := identity
	foreign.InstanceID = "profile-b"
	if developmentBrowserObserved(context.Background(), client, server.URL, foreign) {
		t.Fatal("foreign profile accepted as this endpoint")
	}
}

func TestDevelopmentMCPEndpointRejectsDifferentBootGenerationOrIdentity(t *testing.T) {
	expected := devcontract.InstanceDescriptor{SchemaVersion: 1, WorkspaceID: "workspace-a", InstanceID: "workspace-a", Generation: "generation-a", Kind: "development", DisplayName: "A", Process: devcontract.ProcessIdentity{PID: 123, StartIdentity: "start-a", Executable: "/owned/host", WorkspaceID: "workspace-a", Generation: "generation-a", Role: "host", Source: "/owned/workspace"}}
	for _, variant := range []string{"owned", "generation", "boot", "unauthorized"} {
		t.Run(variant, func(t *testing.T) {
			boot := expected.BootIdentity()
			switch variant {
			case "generation":
				boot.Generation = "old"
			case "boot":
				boot.InstanceID = "other"
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer private-fixture-token" {
					t.Error("missing private bearer")
				}
				if variant == "unauthorized" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				var request struct {
					ID string `json:"id"`
				}
				if json.NewDecoder(r.Body).Decode(&request) != nil {
					t.Error("invalid RPC request")
					w.WriteHeader(400)
					return
				}
				proof, _ := json.Marshal(map[string]any{"boot": boot})
				_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": map[string]any{"isError": false, "content": []map[string]any{{"type": "text", "text": string(proof)}}}})
			}))
			defer server.Close()
			client := developmentHTTPClient()
			defer client.CloseIdleConnections()
			observed := developmentMCPObserved(context.Background(), client, server.URL, "private-fixture-token", expected)
			if observed != (variant == "owned") {
				t.Fatalf("endpoint accepted=%v for %s", observed, variant)
			}
		})
	}
}
