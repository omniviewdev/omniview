package telemetry

import (
	"context"

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
		otlptracehttp.WithEndpoint(endpoint),
		otlptracehttp.WithInsecure(),
	}
	if authHeader != "" && authValue != "" {
		opts = append(opts, otlptracehttp.WithHeaders(map[string]string{authHeader: authValue}))
	}
	return otlptracehttp.New(ctx, opts...)
}

// NewMetricExporter creates an OTLP HTTP metric exporter.
func NewMetricExporter(ctx context.Context, endpoint, authHeader, authValue string) (sdkmetric.Exporter, error) {
	opts := []otlpmetrichttp.Option{
		otlpmetrichttp.WithEndpoint(endpoint),
		otlpmetrichttp.WithInsecure(),
	}
	if authHeader != "" && authValue != "" {
		opts = append(opts, otlpmetrichttp.WithHeaders(map[string]string{authHeader: authValue}))
	}
	return otlpmetrichttp.New(ctx, opts...)
}

// NewLogExporter creates an OTLP HTTP log exporter.
func NewLogExporter(ctx context.Context, endpoint, authHeader, authValue string) (sdklog.Exporter, error) {
	opts := []otlploghttp.Option{
		otlploghttp.WithEndpoint(endpoint),
		otlploghttp.WithInsecure(),
	}
	if authHeader != "" && authValue != "" {
		opts = append(opts, otlploghttp.WithHeaders(map[string]string{authHeader: authValue}))
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
