package diagnostics

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestHTTPPrivateDiscoverySecurityAndPersistence(t *testing.T) {
	root := t.TempDir()
	options := HTTPOptions{RuntimeDirectory: filepath.Join(root, "runtime"), StateRoot: filepath.Join(root, "state"), WorkspaceID: uuid.NewString()}
	store := filepath.Join(root, "captures")
	core, err := New(Options{Directory: store, Identity: Identity{InstanceID: uuid.NewString(), Version: "before", ConfigID: "same"}})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server, err := StartHTTP(ctx, core, options)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	defer core.Close()
	client, err := DiscoverClient(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err = core.Export(ctx, &metricdata.ResourceMetrics{ScopeMetrics: []metricdata.ScopeMetrics{{Metrics: []metricdata.Metrics{{Name: "test.counter", Unit: "1", Data: metricdata.Sum[int64]{IsMonotonic: true, Temporality: metricdata.CumulativeTemporality, DataPoints: []metricdata.DataPoint[int64]{{StartTime: time.Now(), Time: time.Now(), Value: 10}}}}}}}}); err != nil {
		t.Fatal(err)
	}
	var snapshot Snapshot
	if err = client.Get(ctx, "/diagnostics/v1/snapshot", &snapshot); err != nil {
		t.Fatal(err)
	}
	var baseline Capture
	if err = client.Request(ctx, http.MethodPost, "/diagnostics/v1/captures", CaptureRequest{Name: "baseline", DurationSeconds: 1}, &baseline); err != nil {
		t.Fatal(err)
	}
	if baseline.ID == "" {
		t.Fatal("capture missing ID")
	}
	if err = client.Request(ctx, http.MethodDelete, "/diagnostics/v1/captures/"+baseline.ID, nil, &baseline); err != nil {
		t.Fatal(err)
	}
	d, err := readEndpoint(server.directory)
	if err != nil {
		t.Fatal(err)
	}
	token, err := os.ReadFile(d.TokenFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, header, value string
		status              int
	}{{"origin", "Origin", "http://localhost", 403}, {"proxy", "Forwarded", "for=127.0.0.1", 403}, {"token", "Authorization", "Bearer wrong", 401}, {"generation", "X-Diagnostics-Generation", "old", 409}, {"host", "Host", "localhost", 403}} {
		t.Run(test.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, d.Endpoint+"/diagnostics/v1/snapshot", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer "+string(token))
			req.Header.Set("X-Diagnostics-Generation", d.Generation)
			if test.header == "Host" {
				req.Host = test.value
			} else {
				req.Header.Set(test.header, test.value)
			}
			response, err := client.http.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			var failure struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.NewDecoder(response.Body).Decode(&failure); err != nil {
				response.Body.Close()
				t.Fatal(err)
			}
			if failure.Error.Code == "" || failure.Error.Message == "" || strings.Contains(failure.Error.Message, string(token)) {
				response.Body.Close()
				t.Fatalf("unsafe or unstructured early error: %#v", failure)
			}
			response.Body.Close()
			if response.StatusCode != test.status {
				t.Fatalf("status %d, want %d", response.StatusCode, test.status)
			}
		})
	}
	for _, path := range []string{"/diagnostics/v1/snapshot", "/metrics"} {
		req, err := http.NewRequest(http.MethodGet, d.Endpoint+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Add("Authorization", "Bearer "+string(token))
		req.Header.Add("Authorization", "Bearer wrong")
		req.Header.Set("X-Diagnostics-Generation", d.Generation)
		response, err := client.http.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 401 {
			t.Fatalf("duplicate Authorization accepted for %s: %d", path, response.StatusCode)
		}
	}
	scrape, err := http.NewRequest(http.MethodGet, d.Endpoint+"/metrics", nil)
	if err != nil {
		t.Fatal(err)
	}
	scrape.Header.Set("Authorization", "Bearer "+string(token))
	scraped, err := client.http.Do(scrape)
	if err != nil {
		t.Fatal(err)
	}
	scraped.Body.Close()
	if scraped.StatusCode != 200 {
		t.Fatalf("standard bearer-only scrape rejected: %d", scraped.StatusCode)
	}
	var missing Capture
	if err := client.Get(ctx, "/diagnostics/v1/captures/does-not-exist", &missing); err == nil || err.Error() != "capture not found" {
		t.Fatalf("missing capture error: %v", err)
	}
	var invalid Capture
	if err := client.Request(ctx, http.MethodPost, "/diagnostics/v1/captures", CaptureRequest{Name: "invalid", DurationSeconds: 99999}, &invalid); err == nil || err.Error() != "invalid capture name, duration, workload, or identifier" {
		t.Fatalf("invalid capture error: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost, d.Endpoint+"/diagnostics/v1/captures", strings.NewReader(`{"name":"x","durationSeconds":1,"unknown":true}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+string(token))
	request.Header.Set("X-Diagnostics-Generation", d.Generation)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 400 {
		t.Fatalf("unknown JSON field accepted: %d", response.StatusCode)
	}
	if err = server.Close(); err != nil {
		t.Fatal(err)
	}
	if err = core.Close(); err != nil {
		t.Fatal(err)
	}
	next, err := New(Options{Directory: store, Identity: Identity{InstanceID: uuid.NewString(), Version: "after", ConfigID: "same"}})
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	restarted, err := StartHTTP(ctx, next, options)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	nextClient, err := DiscoverClient(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	defer nextClient.Close()
	var persisted Capture
	if err = nextClient.Get(ctx, "/diagnostics/v1/captures/"+baseline.ID, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.Identity.Version != "before" {
		t.Fatal("capture identity lost across restart")
	}
	var candidate Capture
	if err = nextClient.Request(ctx, http.MethodPost, "/diagnostics/v1/captures", CaptureRequest{Name: "candidate", DurationSeconds: 1}, &candidate); err != nil {
		t.Fatal(err)
	}
	if err = nextClient.Request(ctx, http.MethodDelete, "/diagnostics/v1/captures/"+candidate.ID, nil, &candidate); err != nil {
		t.Fatal(err)
	}
	var comparison Comparison
	if err = nextClient.Get(ctx, "/diagnostics/v1/compare?baseline=baseline&candidate=candidate", &comparison); err != nil {
		t.Fatal(err)
	}
	if comparison.Baseline != baseline.ID || comparison.Candidate != candidate.ID {
		t.Fatalf("comparison lost persisted capture IDs: got %q/%q, want %q/%q", comparison.Baseline, comparison.Candidate, baseline.ID, candidate.ID)
	}
}

func TestClientRejectsNonLoopbackEndpoints(t *testing.T) {
	for _, endpoint := range []string{"https://127.0.0.1:1234", "http://localhost:1234", "http://127.0.0.1:1234/path", "http://127.0.0.1:1234?token=secret", "http://user:secret@127.0.0.1:1234"} {
		if client, err := NewClient(EndpointIdentity{Endpoint: endpoint, Generation: "generation"}, []byte(strings.Repeat("x", 43))); err == nil {
			client.Close()
			t.Fatalf("accepted endpoint %s", endpoint)
		}
	}
}
