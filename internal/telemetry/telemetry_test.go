package telemetry

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"

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
	newLogExporter = func(context.Context, string, string, string) (sdklog.Exporter, error) {
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
