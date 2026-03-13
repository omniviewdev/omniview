package telemetry

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestSwitchableSpanExporter_NilInner(t *testing.T) {
	s := &SwitchableSpanExporter{}
	err := s.ExportSpans(context.Background(), nil)
	assert.NoError(t, err)
	err = s.Shutdown(context.Background())
	assert.NoError(t, err)
}

func TestSwitchableSpanExporter_SwapAndExport(t *testing.T) {
	s := &SwitchableSpanExporter{}
	recorder := tracetest.NewInMemoryExporter()

	old := s.Swap(recorder)
	assert.Nil(t, old)

	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(s))
	_, span := tp.Tracer("test").Start(context.Background(), "test-op")
	span.End()
	require.NoError(t, tp.ForceFlush(context.Background()))

	assert.NotEmpty(t, recorder.GetSpans())
}

func TestSwitchableSpanExporter_SwapToNoop(t *testing.T) {
	s := &SwitchableSpanExporter{}
	recorder := tracetest.NewInMemoryExporter()
	s.Swap(recorder)

	old := s.Swap(noopSpanExporter{})
	assert.NotNil(t, old)

	initialCount := len(recorder.GetSpans())
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(s))
	_, span := tp.Tracer("test").Start(context.Background(), "noop-op")
	span.End()
	require.NoError(t, tp.ForceFlush(context.Background()))

	assert.Equal(t, initialCount, len(recorder.GetSpans()))
}

func TestSwitchableSpanExporter_ConcurrentSafety(t *testing.T) {
	s := &SwitchableSpanExporter{}
	s.Swap(noopSpanExporter{})
	var ops atomic.Int64

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_ = s.ExportSpans(context.Background(), nil)
			ops.Add(1)
		}()
		go func() {
			defer wg.Done()
			s.Swap(noopSpanExporter{})
			ops.Add(1)
		}()
	}
	wg.Wait()
	assert.Equal(t, int64(200), ops.Load())
}
