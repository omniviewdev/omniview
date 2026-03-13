package telemetry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	noopmeter "go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
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

	cfg := TelemetryConfig{Enabled: false}
	svc := New(cfg, "1.0.0", "abc", "2026-03-11", true)

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

	cfg := TelemetryConfig{
		Enabled:      true,
		Traces:       true,
		Metrics:      false,
		LogsShip:     false,
		Profiling:    false,
		OTLPEndpoint: "localhost:14318",
	}
	svc := New(cfg, "1.0.0", "abc", "2026-03-11", true)

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

	svc := New(TelemetryConfig{
		Enabled:      true,
		Traces:       true,
		OTLPEndpoint: "localhost:4318",
	}, "test", "abc", "2026-01-01", true)

	require.NoError(t, svc.Init(context.Background()))
	defer svc.Shutdown(context.Background())

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
	require.NoError(t, svc.ApplyConfig(context.Background(), TelemetryConfig{
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
	require.NoError(t, svc.ApplyConfig(context.Background(), TelemetryConfig{
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

	svc := New(TelemetryConfig{
		Enabled:      true,
		Traces:       true,
		Metrics:      true,
		LogsShip:     true,
		OTLPEndpoint: "localhost:4318",
	}, "test", "abc", "2026-01-01", true)

	require.NoError(t, svc.Init(context.Background()))
	defer svc.Shutdown(context.Background())

	// Swap in recorder so we can observe
	svc.switchableTraceExp.Swap(recorder)

	// Turn everything off
	require.NoError(t, svc.ApplyConfig(context.Background(), TelemetryConfig{
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
