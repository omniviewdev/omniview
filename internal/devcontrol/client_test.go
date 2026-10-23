package devcontrol

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestClientRequiresExplicitLoopbackEndpoint(t *testing.T) {
	for _, endpoint := range []string{"https://127.0.0.1:1234/v1/control", "http://localhost:1234/v1/control", "http://192.0.2.1:1234/v1/control", "http://127.0.0.1:1234/other", "http://user:secret@127.0.0.1:1234/v1/control", "http://127.0.0.1:1234/v1/control?token=secret"} {
		if _, err := NewClient(endpoint, []byte("token-with-more-than-thirty-two-bytes"), "workspace", "generation"); err == nil {
			t.Fatalf("accepted %s", endpoint)
		}
	}
}

func TestClientNeverRedirectsCredentials(t *testing.T) {
	var forwarded atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded.Add(1); w.WriteHeader(http.StatusOK) }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/v1/control", http.StatusTemporaryRedirect)
	}))
	defer origin.Close()
	client, err := NewClient(origin.URL, []byte("token-with-more-than-thirty-two-bytes"), "workspace", "generation")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if _, err := client.Call(context.Background(), "instance.inspect", EmptyParams{}); err == nil {
		t.Fatal("redirect treated as control response")
	}
	if forwarded.Load() != 0 {
		t.Fatal("client followed redirect and could disclose bearer credentials")
	}
}

func TestProtocolErrorExitCodes(t *testing.T) {
	for code, want := range map[string]int{"unauthorized": 6, "timeout": 7, "invalid_params": 2, "validation_failed": 2, "stale_target": 4, "operation_not_found": 3, "operation_failed": 5} {
		if got := devcontract.ExitCode(&devcontract.Error{Code: code, Exit: errorExit(code)}); got != want {
			t.Fatalf("%s exit=%d want %d", code, got, want)
		}
	}
}

func TestClientRestoresValidationFailureUsageExit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request devcontract.Request
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		_ = json.NewEncoder(w).Encode(devcontract.Response{ProtocolVersion: devcontract.ProtocolVersion, RequestID: request.RequestID, WorkspaceID: request.WorkspaceID, Generation: request.Generation, Status: "failed", Error: devcontract.Fail(2, "validation_failed", "provider rejected the requested value")})
	}))
	defer server.Close()
	client, err := NewClient(server.URL, []byte("token-with-more-than-thirty-two-bytes"), "workspace", "generation")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	response, err := client.Call(context.Background(), "settings.set", SettingsParams{Scope: "host", ID: "limits.count", Value: json.RawMessage("0")})
	if devcontract.ExitCode(err) != 2 || response.Error == nil || response.Error.Exit != 2 {
		t.Fatalf("validation exit=%d response=%+v err=%v", devcontract.ExitCode(err), response, err)
	}
}

func TestClientWaitBoundsStalledHTTPAndPreservesOperationIdentity(t *testing.T) {
	for _, stage := range []string{"headers", "body"} {
		t.Run(stage, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if stage == "body" {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
			}))
			defer server.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			client, err := NewClient(server.URL, []byte("token-with-more-than-thirty-two-bytes"), "workspace", "generation")
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			type outcome struct {
				response devcontract.Response
				err      error
			}
			completed := make(chan outcome, 1)
			go func() {
				response, err := client.Wait(ctx, "accepted-operation", 20*time.Millisecond)
				completed <- outcome{response, err}
			}()
			select {
			case result := <-completed:
				if devcontract.ExitCode(result.err) != 7 || result.response.OperationID != "accepted-operation" || result.response.Status != "running" || result.response.Error == nil || result.response.Error.Code != "timeout" {
					t.Fatalf("stalled wait=%+v err=%v", result.response, result.err)
				}
			case <-time.After(time.Second):
				cancel()
				t.Fatal("operation wait timeout did not bound the HTTP request")
			}
		})
	}
}
