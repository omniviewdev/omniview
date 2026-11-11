package registry

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
)

const registryLeakProbe = "registry-body-secret-xyz"

func captureRegistrySpans(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	// The package tracer binds to the first global provider ever set, so swap the
	// variable itself to keep each test independent.
	previous := tracer
	tracer = provider.Tracer("omniview.registry")
	t.Cleanup(func() {
		tracer = previous
		_ = provider.Shutdown(context.Background())
	})
	return exporter
}

func registryAttrs(kvs []attribute.KeyValue) map[string]string {
	out := make(map[string]string, len(kvs))
	for _, kv := range kvs {
		out[string(kv.Key)] = kv.Value.String()
	}
	return out
}

func failingRegistryServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = fmt.Fprintf(w, `{"success":false,"error":{"message":%q}}`, registryLeakProbe)
	}))
	t.Cleanup(server.Close)
	return server
}

//nolint:gocognit // This test checks the complete cross-signal redaction contract.
func TestRegistryFailureSpansAndLogsAreClassifiedAndRedacted(t *testing.T) {
	exporter := captureRegistrySpans(t)
	sink := &logtest.RecordingSink{}
	logger := logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink), Level: logging.NewLevelController(logging.LevelDebug),
	})
	client := NewClient(failingRegistryServer(t).URL).WithLogger(logger)

	if _, err := client.GetPluginReadme(context.Background(), "kubernetes"); err == nil {
		t.Fatal("expected registry failure")
	}

	var httpSpan, methodSpan *tracetest.SpanStub
	spans := exporter.GetSpans()
	for i := range spans {
		switch spans[i].Name {
		case "registry.http":
			httpSpan = &spans[i]
		case "registry.GetPluginReadme":
			methodSpan = &spans[i]
		}
	}
	if httpSpan == nil || methodSpan == nil {
		t.Fatalf("missing spans: %+v", spans)
	}
	attrs := registryAttrs(httpSpan.Attributes)
	if attrs["http.request.method"] != "GET" || attrs["url.path"] != "/v1/plugins/kubernetes" ||
		attrs["http.response.status_code"] != "500" || attrs["outcome"] != "failure" {
		t.Fatalf("unexpected registry.http attributes: %v", attrs)
	}
	if _, hasQuery := attrs["url.query"]; hasQuery {
		t.Fatal("query must not be exported")
	}
	if httpSpan.Parent.SpanID() != methodSpan.SpanContext.SpanID() {
		t.Fatal("registry.http must be a child of the method span")
	}
	methodAttrs := registryAttrs(methodSpan.Attributes)
	if methodAttrs["plugin_id"] != "kubernetes" || methodAttrs["outcome"] != "failure" ||
		methodAttrs["error_class"] == "" {
		t.Fatalf("unexpected method span attributes: %v", methodAttrs)
	}

	for _, span := range spans {
		blob := fmt.Sprint(span.Attributes, span.Status, span.Events)
		if strings.Contains(blob, registryLeakProbe) {
			t.Fatalf("span %s leaked provider body: %s", span.Name, blob)
		}
	}
	var warned bool
	for _, record := range sink.Records() {
		if strings.Contains(fmt.Sprint(record.Message, record.Fields), registryLeakProbe) {
			t.Fatalf("log leaked provider body: %v", record)
		}
		if record.Level == logging.LevelWarn && record.Message == "registry request returned non-success status" {
			warned = true
		}
	}
	if !warned {
		t.Fatal("non-2xx response must log a Warn")
	}
}

func TestRegistryWithoutLoggerEmitsSpanEvents(t *testing.T) {
	exporter := captureRegistrySpans(t)
	client := NewClient(failingRegistryServer(t).URL).WithLogger(nil)
	if _, err := client.GetPluginReadme(context.Background(), "kubernetes"); err == nil {
		t.Fatal("expected registry failure")
	}
	for _, span := range exporter.GetSpans() {
		if span.Name != "registry.http" {
			continue
		}
		for _, event := range span.Events {
			if event.Name == "registry request returned non-success status" {
				return
			}
		}
	}
	t.Fatal("nil logger must fall back to a span event")
}

func TestRegistryArtifactPathIsNotExported(t *testing.T) {
	exporter := captureRegistrySpans(t)
	artifact := &artifactRequest{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	artifact.url = server.URL + "/signed-path-secret/archive.tgz?sig=abc"
	ctx := context.WithValue(context.Background(), artifactRequestKey{}, artifact)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, artifact.url, nil)
	transport := &compatibilityTransport{next: http.DefaultTransport}
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	for _, span := range exporter.GetSpans() {
		if strings.Contains(fmt.Sprint(span.Attributes), "signed-path-secret") {
			t.Fatal("artifact path leaked into span attributes")
		}
	}
}
