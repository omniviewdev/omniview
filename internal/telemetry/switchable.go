package telemetry

import (
	"context"
	"sync/atomic"

	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// spanExporterHolder is a stable concrete type for atomic.Value storage.
// atomic.Value panics if you swap in values of different concrete types, so we
// always store this wrapper regardless of which SpanExporter is inside.
type spanExporterHolder struct{ exp sdktrace.SpanExporter }
type metricExporterHolder struct{ exp sdkmetric.Exporter }
type logExporterHolder struct{ exp sdklog.Exporter }

// SwitchableSpanExporter wraps a sdktrace.SpanExporter and allows swapping the
// inner exporter at runtime via atomic operations.
type SwitchableSpanExporter struct {
	inner atomic.Value // stores spanExporterHolder
}

func (s *SwitchableSpanExporter) load() sdktrace.SpanExporter {
	if h, ok := s.inner.Load().(spanExporterHolder); ok {
		return h.exp
	}
	return nil
}

func (s *SwitchableSpanExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	if exp := s.load(); exp != nil {
		return exp.ExportSpans(ctx, spans)
	}
	return nil
}

func (s *SwitchableSpanExporter) Shutdown(ctx context.Context) error {
	if exp := s.load(); exp != nil {
		return exp.Shutdown(ctx)
	}
	return nil
}

func (s *SwitchableSpanExporter) Swap(exp sdktrace.SpanExporter) sdktrace.SpanExporter {
	old := s.inner.Swap(spanExporterHolder{exp: exp})
	if h, ok := old.(spanExporterHolder); ok {
		return h.exp
	}
	return nil
}

// SwitchableMetricExporter wraps a sdkmetric.Exporter.
type SwitchableMetricExporter struct {
	inner atomic.Value // stores metricExporterHolder
}

func (s *SwitchableMetricExporter) load() sdkmetric.Exporter {
	if h, ok := s.inner.Load().(metricExporterHolder); ok {
		return h.exp
	}
	return nil
}

func (s *SwitchableMetricExporter) Export(ctx context.Context, rm *metricdata.ResourceMetrics) error {
	if exp := s.load(); exp != nil {
		return exp.Export(ctx, rm)
	}
	return nil
}

func (s *SwitchableMetricExporter) Temporality(k sdkmetric.InstrumentKind) metricdata.Temporality {
	if exp := s.load(); exp != nil {
		return exp.Temporality(k)
	}
	return metricdata.CumulativeTemporality
}

func (s *SwitchableMetricExporter) Aggregation(k sdkmetric.InstrumentKind) sdkmetric.Aggregation {
	if exp := s.load(); exp != nil {
		return exp.Aggregation(k)
	}
	return sdkmetric.AggregationDefault{}
}

func (s *SwitchableMetricExporter) Shutdown(ctx context.Context) error {
	if exp := s.load(); exp != nil {
		return exp.Shutdown(ctx)
	}
	return nil
}

func (s *SwitchableMetricExporter) ForceFlush(ctx context.Context) error {
	if exp := s.load(); exp != nil {
		return exp.ForceFlush(ctx)
	}
	return nil
}

func (s *SwitchableMetricExporter) Swap(exp sdkmetric.Exporter) sdkmetric.Exporter {
	old := s.inner.Swap(metricExporterHolder{exp: exp})
	if h, ok := old.(metricExporterHolder); ok {
		return h.exp
	}
	return nil
}

// SwitchableLogExporter wraps a sdklog.Exporter.
type SwitchableLogExporter struct {
	inner atomic.Value // stores logExporterHolder
}

func (s *SwitchableLogExporter) load() sdklog.Exporter {
	if h, ok := s.inner.Load().(logExporterHolder); ok {
		return h.exp
	}
	return nil
}

func (s *SwitchableLogExporter) Export(ctx context.Context, records []sdklog.Record) error {
	if exp := s.load(); exp != nil {
		return exp.Export(ctx, records)
	}
	return nil
}

func (s *SwitchableLogExporter) Shutdown(ctx context.Context) error {
	if exp := s.load(); exp != nil {
		return exp.Shutdown(ctx)
	}
	return nil
}

func (s *SwitchableLogExporter) ForceFlush(ctx context.Context) error {
	if exp := s.load(); exp != nil {
		return exp.ForceFlush(ctx)
	}
	return nil
}

func (s *SwitchableLogExporter) Swap(exp sdklog.Exporter) sdklog.Exporter {
	old := s.inner.Swap(logExporterHolder{exp: exp})
	if h, ok := old.(logExporterHolder); ok {
		return h.exp
	}
	return nil
}
