package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

// TestEndToEndTraceCorrelation verifies that a frontend span and a backend span
// created via context propagation share the same trace ID and that the backend
// span is correctly parented to the frontend span.
func TestEndToEndTraceCorrelation(t *testing.T) {
	t.Cleanup(resetGlobalOTel)

	// Create in-memory exporter for verification.
	exporter := tracetest.NewInMemoryExporter()

	// Build a resource for the tracer provider.
	res, err := NewResource("test", "abc", "today", true)
	require.NoError(t, err)

	// Create TracerProvider with a synchronous exporter so spans are immediately available.
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithSyncer(exporter),
	)
	defer func() { _ = tp.Shutdown(context.Background()) }()

	// Register as global provider with W3C TraceContext propagation.
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	tracer := tp.Tracer("integration-test")

	// --- Simulate frontend: create the root span and inject context into carrier ---
	frontendCtx, frontendSpan := tracer.Start(context.Background(), "wails.LoadPlugin")
	carrier := InjectContext(frontendCtx)
	frontendSpan.End()

	// --- Simulate backend: extract context from carrier and create a child span ---
	backendCtx := ExtractContext(context.Background(), carrier)
	_, backendSpan := tracer.Start(backendCtx, "PluginService.LoadPlugin")
	backendSpan.End()

	// Collect all exported spans.
	spans := exporter.GetSpans()
	require.Len(t, spans, 2, "expected exactly 2 spans")

	// Identify spans by name.
	var frontend, backend *tracetest.SpanStub
	for i := range spans {
		s := &spans[i]
		switch s.Name {
		case "wails.LoadPlugin":
			frontend = s
		case "PluginService.LoadPlugin":
			backend = s
		}
	}
	require.NotNil(t, frontend, "frontend span not found")
	require.NotNil(t, backend, "backend span not found")

	// Both spans must share the same trace ID.
	assert.Equal(t, frontend.SpanContext.TraceID(), backend.SpanContext.TraceID(),
		"frontend and backend spans must share the same trace ID")

	// The backend span's parent must be the frontend span.
	assert.Equal(t, frontend.SpanContext.SpanID(), backend.Parent.SpanID(),
		"backend span parent must be the frontend span ID")
	assert.True(t, backend.Parent.IsValid(), "backend span must have a valid parent")
}

// TestEndToEndLogCorrelation verifies that a ZapBackend log record is written
// with the correct message and traceId field captured from an active span.
func TestEndToEndLogCorrelation(t *testing.T) {
	t.Cleanup(resetGlobalOTel)

	// Set up trace provider with in-memory exporter.
	exporter := tracetest.NewInMemoryExporter()

	res, err := NewResource("test", "abc", "today", true)
	require.NoError(t, err)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithSyncer(exporter),
	)
	defer func() { _ = tp.Shutdown(context.Background()) }()

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})

	// Set up Zap observer to capture log entries.
	core, logs := observer.New(zapcore.InfoLevel)
	zapLogger := zap.New(core)
	backend := NewZapBackend(zapLogger)

	tracer := tp.Tracer("integration-test")

	// Create a span and capture its trace ID.
	ctx, span := tracer.Start(context.Background(), "operation")
	traceID := span.SpanContext().TraceID()
	require.True(t, traceID.IsValid(), "span must have a valid trace ID")
	span.End()

	// Write a log record that includes the trace ID as a field.
	record := logging.Record{
		Timestamp: time.Now(),
		Level:     logging.LevelInfo,
		Message:   "operation completed",
		Fields: []logging.Field{
			logging.String("traceId", traceID.String()),
		},
	}
	err = backend.Write(ctx, record)
	require.NoError(t, err)

	// Verify the log entry was captured with the correct data.
	require.Equal(t, 1, logs.Len(), "expected exactly one log entry")
	entry := logs.All()[0]
	assert.Equal(t, "operation completed", entry.Message)

	fieldMap := entry.ContextMap()
	assert.Equal(t, traceID.String(), fieldMap["traceId"],
		"traceId field must match the span's trace ID")
}
