package telemetry

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// otlpSignalURL accepts a shared OTLP base or a complete signal endpoint.
// Preserve nonstandard paths, which may be explicit collector routes.
func otlpSignalURL(endpoint, signal string) string {
	if !strings.Contains(endpoint, "://") {
		endpoint = "http://" + endpoint
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	path := strings.TrimRight(u.Path, "/")
	switch {
	case path == "" || path == "/otlp":
		u.Path = path + "/v1/" + signal
	case strings.HasSuffix(path, "/v1/traces"), strings.HasSuffix(path, "/v1/metrics"),
		strings.HasSuffix(path, "/v1/logs"):
		u.Path = path[:strings.LastIndex(path, "/")+1] + signal
	}
	return u.String()
}

// NewTraceExporter creates an OTLP HTTP trace exporter.
func NewTraceExporter(ctx context.Context, endpoint, authHeader, authValue string) (sdktrace.SpanExporter, error) {
	opts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(otlpSignalURL(endpoint, "traces")),
	}
	if authHeader != "" && authValue != "" {
		opts = append(opts, otlptracehttp.WithHeaders(map[string]string{authHeader: authValue}))
	}
	return otlptracehttp.New(ctx, opts...)
}

// NewMetricExporter creates an OTLP HTTP metric exporter.
func NewMetricExporter(ctx context.Context, endpoint, authHeader, authValue string) (sdkmetric.Exporter, error) {
	opts := []otlpmetrichttp.Option{
		otlpmetrichttp.WithEndpointURL(otlpSignalURL(endpoint, "metrics")),
	}
	if authHeader != "" && authValue != "" {
		opts = append(opts, otlpmetrichttp.WithHeaders(map[string]string{authHeader: authValue}))
	}
	return otlpmetrichttp.New(ctx, opts...)
}

// NewLogExporter creates an OTLP HTTP log exporter.
func NewLogExporter(ctx context.Context, endpoint, authHeader, authValue, tenantID string) (sdklog.Exporter, error) {
	opts := []otlploghttp.Option{
		otlploghttp.WithEndpointURL(otlpSignalURL(endpoint, "logs")),
	}
	headers := make(map[string]string)
	if authHeader != "" && authValue != "" {
		if tenantID != "" && strings.EqualFold(authHeader, "X-Scope-OrgID") {
			return nil, fmt.Errorf("OTLP log auth header conflicts with X-Scope-OrgID tenant header")
		}
		headers[authHeader] = authValue
	}
	if tenantID != "" {
		headers["X-Scope-OrgID"] = tenantID
	}
	if len(headers) > 0 {
		opts = append(opts, otlploghttp.WithHeaders(headers))
	}
	return otlploghttp.New(ctx, opts...)
}

type noopSpanExporter struct{}

func (noopSpanExporter) ExportSpans(_ context.Context, _ []sdktrace.ReadOnlySpan) error { return nil }
func (noopSpanExporter) Shutdown(_ context.Context) error                               { return nil }

// NewNoopTraceExporter returns a span exporter that discards all spans.
func NewNoopTraceExporter() sdktrace.SpanExporter {
	return noopSpanExporter{}
}

type noopMetricExporter struct{}

func (noopMetricExporter) Export(_ context.Context, _ *metricdata.ResourceMetrics) error { return nil }
func (noopMetricExporter) Temporality(_ sdkmetric.InstrumentKind) metricdata.Temporality {
	return metricdata.CumulativeTemporality
}
func (noopMetricExporter) Aggregation(_ sdkmetric.InstrumentKind) sdkmetric.Aggregation {
	return sdkmetric.AggregationDefault{}
}
func (noopMetricExporter) Shutdown(_ context.Context) error   { return nil }
func (noopMetricExporter) ForceFlush(_ context.Context) error { return nil }

type noopLogExporter struct{}

func (noopLogExporter) Export(_ context.Context, _ []sdklog.Record) error { return nil }
func (noopLogExporter) Shutdown(_ context.Context) error                  { return nil }
func (noopLogExporter) ForceFlush(_ context.Context) error                { return nil }
