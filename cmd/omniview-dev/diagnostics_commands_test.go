package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/diagnostics"
)

func TestDiagnosticsCommandErrorExitCodes(t *testing.T) {
	for _, test := range []struct {
		err  error
		exit int
	}{
		{errors.New("diagnostics target unreachable"), 3},
		{errors.New("capture not found"), 3},
		{errors.New("diagnostics target generation is stale"), 4},
		{errors.New("capture conflicts with existing state"), 4},
		{errors.New("diagnostics authentication rejected"), 6},
		{context.Canceled, 7},
		{context.DeadlineExceeded, 7},
		{errors.New("invalid capture name, duration, workload, or identifier"), 2},
		{errors.New("capture storage failed; check profile permissions and disk space"), 5},
	} {
		if got := devcontract.ExitCode(diagnosticsCommandError(test.err)); got != test.exit {
			t.Errorf("%s: exit %d, want %d", test.err, got, test.exit)
		}
	}
	typed := devcontract.Fail(2, "invalid_target", "safe selected target error")
	if got := diagnosticsCommandError(typed); got != typed {
		t.Fatal("typed selection error replaced")
	}
}

func TestCaptureTerminalStatesFailHonestly(t *testing.T) {
	for _, test := range []struct {
		status string
		exit   int
	}{{"complete", 0}, {"error", 5}, {"incomplete", 4}, {"interrupted", 4}, {"reset", 4}, {"canceled", 7}, {"unknown", 5}} {
		result, err := waitDiagnosticsCapture(context.Background(), nil, diagnostics.Capture{ID: "persisted-id", Status: test.status}, time.Second)
		if test.exit == 0 {
			if err != nil {
				t.Fatal(err)
			}
			continue
		}
		if err == nil || devcontract.ExitCode(diagnosticsCommandError(err)) != test.exit {
			t.Fatalf("%s: %v", test.status, err)
		}
		details, ok := result.(captureWaitFailure)
		if !ok || details.CaptureID != "persisted-id" || details.Status != test.status {
			t.Fatalf("missing capture details: %#v", result)
		}
	}
}

func TestCapturePollingFailurePreservesPrimaryExit(t *testing.T) {
	for _, test := range []struct {
		status int
		exit   int
	}{{0, 3}, {401, 6}, {409, 4}, {404, 3}} {
		name := http.StatusText(test.status)
		if test.status == 0 {
			name = "unreachable"
		}
		t.Run(name, func(t *testing.T) {
			var deleted atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodDelete {
					deleted.Store(true)
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				if test.status == 0 {
					connection, _, err := w.(http.Hijacker).Hijack()
					if err == nil {
						connection.Close()
					}
					return
				}
				w.WriteHeader(test.status)
			}))
			defer server.Close()
			client, err := diagnostics.NewClient(diagnostics.EndpointIdentity{Endpoint: server.URL, Generation: "test"}, []byte(strings.Repeat("x", 43)))
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			result, err := waitDiagnosticsCapture(context.Background(), client, diagnostics.Capture{ID: "persisted-id", Status: "running"}, time.Second)
			if err == nil || devcontract.ExitCode(diagnosticsCommandError(err)) != test.exit {
				t.Fatalf("primary poll failure lost: %v", err)
			}
			details := result.(captureWaitFailure)
			if !deleted.Load() || details.Cancellation == nil || details.Cancellation.Confirmed || details.Cancellation.ErrorCode == "" {
				t.Fatalf("cancellation outcome missing: %#v", details)
			}
			if details.CaptureID != "persisted-id" {
				t.Fatal("capture ID lost")
			}
		})
	}
}

func TestCanceledWaitCancelsRealPersistedCapture(t *testing.T) {
	root := t.TempDir()
	service, err := diagnostics.New(diagnostics.Options{Directory: filepath.Join(root, "captures"), Identity: diagnostics.Identity{InstanceID: "test"}})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	options := diagnostics.HTTPOptions{RuntimeDirectory: filepath.Join(root, "runtime"), StateRoot: filepath.Join(root, "state")}
	server, err := diagnostics.StartHTTP(context.Background(), service, options)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client, err := diagnostics.DiscoverClient(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	var capture diagnostics.Capture
	if err := client.Request(context.Background(), http.MethodPost, "/diagnostics/v1/captures", diagnostics.CaptureRequest{Name: "cancel-test", DurationSeconds: 30}, &capture); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := waitDiagnosticsCapture(ctx, client, capture, 30*time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("lost cancellation: %v", err)
	}
	details := result.(captureWaitFailure)
	if details.Cancellation == nil || !details.Cancellation.Confirmed {
		t.Fatalf("cleanup not confirmed: %#v", details)
	}
	persisted, err := service.GetCapture(capture.ID)
	if err != nil || persisted.Status != "canceled" {
		t.Fatalf("server capture still active: %#v %v", persisted, err)
	}
	data, err := json.Marshal(details)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), capture.ID) {
		t.Fatal("missing safe capture ID")
	}
}
