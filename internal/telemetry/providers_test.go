package telemetry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
)

func TestNewTracerProvider(t *testing.T) {
	res := resource.Default()
	exp := NewNoopTraceExporter()
	tp := NewTracerProvider(res, exp)
	require.NotNil(t, tp)

	tracer := tp.Tracer("test")
	_, span := tracer.Start(context.Background(), "test-span")
	assert.True(t, span.SpanContext().IsValid())
	span.End()

	require.NoError(t, tp.Shutdown(context.Background()))
}

func TestNewMeterProvider(t *testing.T) {
	res := resource.Default()
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(reader),
	)
	require.NotNil(t, mp)

	meter := mp.Meter("test")
	counter, err := meter.Int64Counter("test.counter")
	require.NoError(t, err)
	counter.Add(context.Background(), 1)

	require.NoError(t, mp.Shutdown(context.Background()))
}

func TestNewLoggerProvider(t *testing.T) {
	res := resource.Default()
	lp := sdklog.NewLoggerProvider(sdklog.WithResource(res))
	require.NotNil(t, lp)
	require.NoError(t, lp.Shutdown(context.Background()))
}
