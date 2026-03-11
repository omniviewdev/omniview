package telemetry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func TestInjectExtractRoundtrip(t *testing.T) {
	otel.SetTextMapPropagator(propagation.TraceContext{})
	tp := sdktrace.NewTracerProvider()
	defer tp.Shutdown(context.Background())
	tracer := tp.Tracer("test")

	ctx, span := tracer.Start(context.Background(), "test-op")
	defer span.End()
	originalTraceID := span.SpanContext().TraceID()
	require.True(t, originalTraceID.IsValid())

	carrier := InjectContext(ctx)
	assert.NotEmpty(t, carrier["traceparent"])

	newCtx := ExtractContext(context.Background(), carrier)
	sc := trace.SpanContextFromContext(newCtx)
	assert.Equal(t, originalTraceID, sc.TraceID())
}
