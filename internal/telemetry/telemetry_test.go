package telemetry

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	noopmeter "go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	nooptrace "go.opentelemetry.io/otel/trace/noop"
	collectormetrics "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	"google.golang.org/protobuf/proto"

	"github.com/omniviewdev/omniview/internal/diagnostics"
)

// resetGlobalOTel restores OTel globals to noop implementations so tests don't
// leak state into each other.
func resetGlobalOTel() {
	otel.SetTracerProvider(nooptrace.NewTracerProvider())
	otel.SetMeterProvider(noopmeter.NewMeterProvider())
	otel.SetTextMapPropagator(propagation.TraceContext{})
}

func TestServiceDisabled(t *testing.T) {
	t.Cleanup(resetGlobalOTel)

	cfg := Config{Enabled: false}
	svc := New(cfg, "1.0.0", "abc", "2026-03-11", true, t.TempDir())

	err := svc.Init(context.Background())
	require.NoError(t, err)

	// With telemetry disabled, providers are still created (for hot-toggle),
	// but exporters are noop — spans are sampled but silently dropped.
	tracer := otel.Tracer("test")
	_, span := tracer.Start(context.Background(), "test")
	assert.True(t, span.SpanContext().IsValid())
	span.End()

	assert.NotNil(t, svc.ZapLogger())
	require.NoError(t, svc.Shutdown(context.Background()))
}

func TestServiceEnabledTracesOnly(t *testing.T) {
	t.Cleanup(resetGlobalOTel)

	cfg := Config{
		Enabled:      true,
		Traces:       true,
		Metrics:      false,
		LogsShip:     false,
		Profiling:    false,
		OTLPEndpoint: "localhost:14318",
	}
	svc := New(cfg, "1.0.0", "abc", "2026-03-11", true, t.TempDir())

	err := svc.Init(context.Background())
	require.NoError(t, err)

	// With traces enabled the global tracer should produce valid, sampled spans.
	tracer := otel.Tracer("test")
	_, span := tracer.Start(context.Background(), "test")
	assert.True(t, span.SpanContext().IsValid())
	assert.True(t, span.SpanContext().IsSampled())
	span.End()

	assert.NotNil(t, svc.ZapLogger())
	require.NoError(t, svc.Shutdown(context.Background()))
}

func TestApplyConfig_ToggleTracesOnOff(t *testing.T) {
	t.Cleanup(resetGlobalOTel)

	recorder := tracetest.NewInMemoryExporter()

	svc := New(Config{
		Enabled:      true,
		Traces:       true,
		OTLPEndpoint: "localhost:4318",
	}, "test", "abc", "2026-01-01", true, t.TempDir())

	require.NoError(t, svc.Init(context.Background()))
	defer func() { _ = svc.Shutdown(context.Background()) }()

	// Swap in our in-memory recorder so we can observe
	svc.switchableTraceExp.Swap(recorder)

	// Generate a span — should be exported
	tracer := otel.Tracer("test")
	_, span := tracer.Start(context.Background(), "before-toggle")
	span.End()
	svc.tracerProvider.ForceFlush(context.Background())
	assert.NotEmpty(t, recorder.GetSpans())

	// Toggle traces OFF
	recorder.Reset()
	require.NoError(t, svc.ApplyConfig(context.Background(), Config{
		Enabled:      true,
		Traces:       false,
		OTLPEndpoint: "localhost:4318",
	}))

	// Generate a span — should NOT be exported (noop exporter)
	_, span = tracer.Start(context.Background(), "after-toggle-off")
	span.End()
	svc.tracerProvider.ForceFlush(context.Background())
	assert.Empty(t, recorder.GetSpans())

	// Toggle traces back ON — swap in recorder again
	require.NoError(t, svc.ApplyConfig(context.Background(), Config{
		Enabled:      true,
		Traces:       true,
		OTLPEndpoint: "localhost:4318",
	}))
	svc.switchableTraceExp.Swap(recorder)

	_, span = tracer.Start(context.Background(), "after-toggle-on")
	span.End()
	svc.tracerProvider.ForceFlush(context.Background())
	assert.NotEmpty(t, recorder.GetSpans())
}

func TestApplyConfig_MasterSwitchOff(t *testing.T) {
	t.Cleanup(resetGlobalOTel)

	recorder := tracetest.NewInMemoryExporter()

	svc := New(Config{
		Enabled:      true,
		Traces:       true,
		Metrics:      true,
		LogsShip:     true,
		OTLPEndpoint: "localhost:4318",
	}, "test", "abc", "2026-01-01", true, t.TempDir())

	require.NoError(t, svc.Init(context.Background()))
	defer func() { _ = svc.Shutdown(context.Background()) }()

	// Swap in recorder so we can observe
	svc.switchableTraceExp.Swap(recorder)

	// Turn everything off
	require.NoError(t, svc.ApplyConfig(context.Background(), Config{
		Enabled: false,
	}))

	assert.False(t, svc.cfg.Enabled)

	// Emit a span after master switch OFF — should not be exported.
	recorder.Reset()
	tracer := otel.Tracer("test-off")
	_, span := tracer.Start(context.Background(), "after-master-off")
	span.End()
	svc.tracerProvider.ForceFlush(context.Background())
	assert.Empty(t, recorder.GetSpans(), "no spans should be exported after master switch off")
}

type shutdownCountingSpanExporter struct {
	noopSpanExporter
	shutdowns atomic.Int32
}

func (e *shutdownCountingSpanExporter) Shutdown(context.Context) error {
	e.shutdowns.Add(1)
	return nil
}

type shutdownCountingMetricExporter struct {
	noopMetricExporter
	shutdowns atomic.Int32
}

func (e *shutdownCountingMetricExporter) Shutdown(context.Context) error {
	e.shutdowns.Add(1)
	return nil
}

func TestApplyConfig_FailureReleasesAllocatedExporters(t *testing.T) {
	t.Cleanup(resetGlobalOTel)

	traceExp := &shutdownCountingSpanExporter{}
	metricExp := &shutdownCountingMetricExporter{}
	origTrace, origMetric, origLog := newTraceExporter, newMetricExporter, newLogExporter
	t.Cleanup(func() { newTraceExporter, newMetricExporter, newLogExporter = origTrace, origMetric, origLog })
	newTraceExporter = func(context.Context, string, string, string) (sdktrace.SpanExporter, error) {
		return traceExp, nil
	}
	newMetricExporter = func(context.Context, string, string, string) (sdkmetric.Exporter, error) {
		return metricExp, nil
	}
	newLogExporter = func(context.Context, string, string, string, string) (sdklog.Exporter, error) {
		return nil, errors.New("log exporter unavailable")
	}

	svc := New(Config{Enabled: false}, "test", "abc", "2026-01-01", true, t.TempDir())
	require.NoError(t, svc.Init(context.Background()))
	defer func() { _ = svc.Shutdown(context.Background()) }()

	err := svc.ApplyConfig(context.Background(), Config{
		Enabled:      true,
		Traces:       true,
		Metrics:      true,
		LogsShip:     true,
		OTLPEndpoint: "http://localhost:4318",
	})
	require.Error(t, err)

	assert.Equal(t, int32(1), traceExp.shutdowns.Load(), "unused trace exporter must be shut down")
	assert.Equal(t, int32(1), metricExp.shutdowns.Load(), "unused metric exporter must be shut down")
	assert.False(t, svc.Config().Enabled, "a failed ApplyConfig must not change the config")
}

func TestLokiShippingStartsWithoutOTLPEndpointAndUpdatesLive(t *testing.T) {
	t.Cleanup(resetGlobalOTel)
	type received struct {
		tenant string
		body   string
	}
	requests := make(chan received, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requests <- received{tenant: r.Header.Get("X-Scope-OrgID"), body: string(body)}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	cfg := Config{Enabled: true, LogsShip: true, LogsShipLevel: "info", LogFormat: "loki", LokiEndpoint: server.URL, LokiTenantID: "first"}
	svc := New(cfg, "test", "commit", "date", false, t.TempDir())
	require.NoError(t, svc.Init(context.Background()))
	defer func() { _ = svc.Shutdown(context.Background()) }()
	svc.ZapLogger().Info("first host event")
	require.NoError(t, svc.loggerProvider.ForceFlush(context.Background()))
	var first received
	select {
	case first = <-requests:
	case <-time.After(5 * time.Second):
		t.Fatal("host log was not delivered to Loki")
	}
	assert.Equal(t, "first", first.tenant)
	assert.True(t, strings.Contains(first.body, "first host event"))

	cfg.LokiTenantID = "second"
	require.NoError(t, svc.ApplyConfig(context.Background(), cfg))
	svc.ZapLogger().Info("second host event")
	require.NoError(t, svc.loggerProvider.ForceFlush(context.Background()))
	var second received
	select {
	case second = <-requests:
	case <-time.After(5 * time.Second):
		t.Fatal("host log was not delivered after the Loki tenant changed")
	}
	assert.Equal(t, "second", second.tenant)
	assert.True(t, strings.Contains(second.body, "second host event"))
}

func TestTraceShippingUsesSignalPathAtStartupAndAfterConfigChange(t *testing.T) {
	t.Cleanup(resetGlobalOTel)
	requests := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	ctx := context.Background()
	cfg := Config{Enabled: true, Traces: true, OTLPEndpoint: server.URL + "/otlp"}
	svc := New(cfg, "test", "commit", "date", false, t.TempDir())
	require.NoError(t, svc.Init(ctx))
	defer func() { _ = svc.Shutdown(ctx) }()
	ship := func(expected string) {
		t.Helper()
		_, span := svc.TracerProvider().Tracer("test").Start(ctx, "host operation")
		span.End()
		require.NoError(t, svc.TracerProvider().ForceFlush(ctx))
		select {
		case path := <-requests:
			assert.Equal(t, expected, path)
		case <-time.After(5 * time.Second):
			t.Fatal("expected a trace export request")
		}
	}
	ship("/otlp/v1/traces")
	cfg.OTLPEndpoint = server.URL
	require.NoError(t, svc.ApplyConfig(ctx, cfg))
	ship("/v1/traces")
}

func TestLogShippingModesAndCredentialIsolation(t *testing.T) {
	t.Cleanup(resetGlobalOTel)
	type request struct {
		method string
		path   string
		auth   string
		tenant string
	}
	requests := make(chan request, 20)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- request{r.Method, r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("X-Scope-OrgID")}
		w.WriteHeader(http.StatusOK)
	})
	server := httptest.NewServer(handler)
	defer server.Close()
	logServer := httptest.NewServer(handler)
	defer logServer.Close()

	ctx := context.Background()
	cfg := Config{
		Enabled: true, Traces: true, LogsShip: true, LogsShipLevel: "info", LogFormat: "otlp",
		OTLPEndpoint: server.URL + "/traces", AuthHeader: "Authorization", AuthValue: "trace-secret",
		OTLPLogEndpoint: logServer.URL + "/logs", OTLPLogAuthHeader: "Authorization",
		OTLPLogAuthValue: "log-secret", OTLPLogTenantID: "log-tenant",
		LokiEndpoint: server.URL + "/loki/api/v1/push", LokiAuthHeader: "Authorization",
		LokiAuthValue: "loki-secret", LokiTenantID: "loki-tenant",
	}
	svc := New(cfg, "test", "commit", "date", false, t.TempDir())
	require.NoError(t, svc.Init(ctx))
	defer func() { _ = svc.Shutdown(ctx) }()

	next := func() request {
		t.Helper()
		select {
		case got := <-requests:
			return got
		case <-time.After(5 * time.Second):
			t.Fatal("expected an export request")
			return request{}
		}
	}
	ship := func() request {
		t.Helper()
		svc.ZapLogger().Info("host event")
		require.NoError(t, svc.LoggerProvider().ForceFlush(ctx))
		return next()
	}
	assert.Equal(t, request{"POST", "/logs", "log-secret", "log-tenant"}, ship())

	_, span := svc.TracerProvider().Tracer("test").Start(ctx, "trace")
	span.End()
	require.NoError(t, svc.TracerProvider().ForceFlush(ctx))
	assert.Equal(t, request{"POST", "/traces", "trace-secret", ""}, next())

	cfg.OTLPLogEndpoint = logServer.URL + "/logs-updated"
	cfg.OTLPLogAuthValue = "updated-secret"
	cfg.OTLPLogTenantID = "updated-tenant"
	require.NoError(t, svc.ApplyConfig(ctx, cfg))
	assert.Equal(t, request{"POST", "/logs-updated", "updated-secret", "updated-tenant"}, ship())

	cfg.OTLPLogAuthHeader, cfg.OTLPLogAuthValue = "", ""
	require.NoError(t, svc.ApplyConfig(ctx, cfg))
	assert.Equal(t, request{"POST", "/logs-updated", "", "updated-tenant"}, ship())

	cfg.LogFormat = "loki"
	require.NoError(t, svc.ApplyConfig(ctx, cfg))
	assert.Equal(t, request{"POST", "/loki/api/v1/push", "loki-secret", "loki-tenant"}, ship())

	cfg.LogFormat = "otlp"
	cfg.OTLPLogEndpoint = ""
	require.NoError(t, svc.ApplyConfig(ctx, cfg))
	assert.Equal(t, request{"POST", "/traces", "trace-secret", "updated-tenant"}, ship())
}

func TestOTLPLogShippingWithoutTraceEndpoint(t *testing.T) {
	t.Cleanup(resetGlobalOTel)
	requests := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	ctx := context.Background()
	cfg := Config{Enabled: true, LogsShip: true, LogsShipLevel: "info", OTLPLogEndpoint: server.URL + "/logs"}
	svc := New(cfg, "test", "commit", "date", false, t.TempDir())
	require.NoError(t, svc.Init(ctx))
	defer func() { _ = svc.Shutdown(ctx) }()
	svc.ZapLogger().Info("host event")
	require.NoError(t, svc.LoggerProvider().ForceFlush(ctx))
	select {
	case path := <-requests:
		assert.Equal(t, "/logs", path)
	case <-time.After(5 * time.Second):
		t.Fatal("expected an OTLP log request")
	}
}

func TestSelectedLogModeErrorsAtStartupAndOnUpdate(t *testing.T) {
	t.Cleanup(resetGlobalOTel)
	ctx := context.Background()
	cfg := Config{Enabled: true, LogsShip: true, LogFormat: "loki", OTLPEndpoint: "http://localhost:4318"}
	svc := New(cfg, "test", "commit", "date", false, t.TempDir())
	require.ErrorContains(t, svc.Init(ctx), "Loki log endpoint is required")

	cfg.Enabled = false
	svc = New(cfg, "test", "commit", "date", false, t.TempDir())
	require.NoError(t, svc.Init(ctx))
	defer func() { _ = svc.Shutdown(ctx) }()
	cfg.Enabled = true
	require.ErrorContains(t, svc.ApplyConfig(ctx, cfg), "Loki log endpoint is required")
	assert.False(t, svc.Config().Enabled)

	cfg.LogFormat = "otlp"
	cfg.OTLPLogEndpoint = "http://localhost:4318/logs"
	cfg.OTLPLogAuthHeader = "x-scope-orgid"
	cfg.OTLPLogAuthValue = "credential"
	cfg.OTLPLogTenantID = "tenant"
	require.ErrorContains(t, svc.ApplyConfig(ctx, cfg), "conflicts")
	assert.False(t, svc.Config().Enabled)
	cfg.OTLPLogEndpoint = ""
	cfg.AuthHeader, cfg.AuthValue = "X-Scope-OrgID", "trace-credential"
	require.ErrorContains(t, svc.ApplyConfig(ctx, cfg), "conflicts")
	assert.False(t, svc.Config().Enabled)
}

func TestMetricsShipToOTLPCollector(t *testing.T) {
	t.Cleanup(resetGlobalOTel)
	type metricRequest struct {
		path string
		body *collectormetrics.ExportMetricsServiceRequest
	}
	requests := make(chan metricRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read failed", http.StatusBadRequest)
			return
		}
		var request collectormetrics.ExportMetricsServiceRequest
		if unmarshalErr := proto.Unmarshal(body, &request); unmarshalErr != nil {
			http.Error(w, "invalid protobuf", http.StatusBadRequest)
			return
		}
		select {
		case requests <- metricRequest{path: r.URL.Path, body: &request}:
		default:
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	ctx := context.Background()
	svc := New(Config{Enabled: true, Metrics: true, OTLPEndpoint: server.URL + "/otlp"},
		"test", "commit", "date", false, t.TempDir())
	diagnosticsService, err := diagnostics.New(diagnostics.Options{Directory: t.TempDir()})
	require.NoError(t, err)
	svc.SetDiagnostics(diagnosticsService)
	require.NoError(t, svc.Init(ctx))
	defer func() { _ = svc.Shutdown(ctx) }()
	counter, err := svc.meterProvider.Meter("test").Int64Counter("test.shipped.counter")
	require.NoError(t, err)
	counter.Add(ctx, 7)
	require.NoError(t, svc.meterProvider.ForceFlush(ctx))
	request := <-requests
	require.Equal(t, "/otlp/v1/metrics", request.path)
	found := false
	for _, resource := range request.body.GetResourceMetrics() {
		for _, scope := range resource.GetScopeMetrics() {
			for _, metric := range scope.GetMetrics() {
				if metric.GetName() == "test.shipped.counter" {
					require.EqualValues(t, 7, metric.GetSum().GetDataPoints()[0].GetAsInt())
					found = true
				}
			}
		}
	}
	require.True(t, found, "counter was not exported")
}
