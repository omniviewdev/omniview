package telemetry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	noopmeter "go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
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

	// With telemetry disabled the global tracer should produce unsampled spans.
	tracer := otel.Tracer("test")
	_, span := tracer.Start(context.Background(), "test")
	assert.False(t, span.SpanContext().IsSampled())
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
