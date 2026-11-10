package telemetry

import (
	"context"
	"fmt"
	"strings"

	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// NewTraceExporter creates an OTLP HTTP trace exporter.
func NewTraceExporter(ctx context.Context, endpoint, authHeader, authValue string) (sdktrace.SpanExporter, error) {
	opts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(endpoint),
	}
	if authHeader != "" && authValue != "" {
		opts = append(opts, otlptracehttp.WithHeaders(map[string]string{authHeader: authValue}))
	}
	return otlptracehttp.New(ctx, opts...)
}

// NewMetricExporter creates an OTLP HTTP metric exporter.
func NewMetricExporter(ctx context.Context, endpoint, authHeader, authValue string) (sdkmetric.Exporter, error) {
	opts := []otlpmetrichttp.Option{
		otlpmetrichttp.WithEndpointURL(endpoint),
	}
	if authHeader != "" && authValue != "" {
		opts = append(opts, otlpmetrichttp.WithHeaders(map[string]string{authHeader: authValue}))
	}
	return otlpmetrichttp.New(ctx, opts...)
}

// NewLogExporter creates an OTLP HTTP log exporter.
func NewLogExporter(ctx context.Context, endpoint, authHeader, authValue, tenantID string) (sdklog.Exporter, error) {
	opts := []otlploghttp.Option{
		otlploghttp.WithEndpointURL(endpoint),
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
