package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func measurementReader(t *testing.T) *sdkmetric.ManualReader {
	t.Helper()
	previous := activeMetrics.Load()
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	_, err := NewMetrics(provider)
	require.NoError(t, err)
	t.Cleanup(func() { activeMetrics.Store(previous); require.NoError(t, provider.Shutdown(context.Background())) })
	return reader
}
func measurementCollect(t *testing.T, reader *sdkmetric.ManualReader) map[string]metricdata.Metrics {
	t.Helper()
	var data metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &data))
	out := make(map[string]metricdata.Metrics)
	for _, scope := range data.ScopeMetrics {
		for _, m := range scope.Metrics {
			out[m.Name] = m
		}
	}
	return out
}

func TestOperationOutcomeBalancesActiveAndBoundsAttributes(t *testing.T) {
	reader := measurementReader(t)
	ctx := context.Background()
	first := BeginOperation(ctx, "resource", "get")
	second := BeginOperation(ctx, "private-provider", "secret-query")
	first.End(context.Canceled)
	second.End(nil)
	measurements := measurementCollect(t, reader)
	active := measurements["omniview.operation.active"].Data.(metricdata.Sum[int64])
	require.Len(t, active.DataPoints, 2)
	for _, p := range active.DataPoints {
		require.Zero(t, p.Value)
	}
	calls := measurements["omniview.operation.calls"].Data.(metricdata.Sum[int64])
	require.Len(t, calls.DataPoints, 2)
	for _, p := range calls.DataPoints {
		require.EqualValues(t, 1, p.Value)
		for _, attr := range p.Attributes.ToSlice() {
			require.NotContains(t, attr.Value.AsString(), "secret")
			require.NotContains(t, attr.Value.AsString(), "private")
		}
	}
	errors := measurements["omniview.resource.op_errors"].Data.(metricdata.Sum[int64])
	require.Len(t, errors.DataPoints, 1)
	require.EqualValues(t, 1, errors.DataPoints[0].Value)
}

func TestPipelineSamplesStateAndUnregistersWithoutStaleValues(t *testing.T) {
	reader := measurementReader(t)
	unregister := RegisterPipelineState(func() PipelineState { return PipelineState{Queued: 2, Inflight: 1, CacheBytes: 1024} })
	t.Cleanup(unregister)
	read := func() (int64, int64) {
		measurements := measurementCollect(t, reader)
		state := measurements["omniview.metric.pipeline.state"]
		require.Equal(t, "{item}", state.Unit)
		bytes := measurements["omniview.metric.pipeline.state_bytes"]
		require.Equal(t, "By", bytes.Unit)
		var inflight, cache int64
		for _, p := range state.Data.(metricdata.Gauge[int64]).DataPoints {
			for _, attr := range p.Attributes.ToSlice() {
				if attr.Value.AsString() == "inflight" {
					inflight = p.Value
				}
			}
		}
		for _, p := range bytes.Data.(metricdata.Gauge[int64]).DataPoints {
			for _, attr := range p.Attributes.ToSlice() {
				if attr.Value.AsString() == "cache" {
					cache = p.Value
				}
			}
		}
		return inflight, cache
	}
	inflight, cache := read()
	require.EqualValues(t, 1, inflight)
	require.EqualValues(t, 1024, cache)
	unregister()
	inflight, cache = read()
	require.Zero(t, inflight)
	require.Zero(t, cache)
}

func TestPipelineProviderCountsActualCallsWithBoundedOutcomes(t *testing.T) {
	reader := measurementReader(t)
	RecordPipelineProvider(context.Background(), "query", time.Now(), context.DeadlineExceeded)
	RecordPipelineProvider(context.Background(), "catalog", time.Now(), nil)
	RecordPipelineProvider(context.Background(), "secret-query", time.Now(), nil)
	data := measurementCollect(t, reader)["omniview.metric.pipeline.provider_duration"].Data.(metricdata.Histogram[float64])
	require.Len(t, data.DataPoints, 2)
	for _, p := range data.DataPoints {
		require.EqualValues(t, 1, p.Count)
	}
}

func TestProcessMeasurementsAreRealOrAbsent(t *testing.T) {
	reader := measurementReader(t)
	measurements := measurementCollect(t, reader)
	heap := measurements["omniview.process.go_heap_bytes"].Data.(metricdata.Gauge[int64])
	require.Positive(t, heap.DataPoints[0].Value)
	goroutines := measurements["omniview.process.goroutines"].Data.(metricdata.Gauge[int64])
	require.Positive(t, goroutines.DataPoints[0].Value)
	if _, _, _, ok := processUsage(); ok {
		cpu := measurements["omniview.process.cpu_time"].Data.(metricdata.Sum[float64])
		require.True(t, cpu.IsMonotonic)
		require.Len(t, cpu.DataPoints, 2)
		for _, p := range cpu.DataPoints {
			require.GreaterOrEqual(t, p.Value, 0.0)
		}
		peak := measurements["omniview.process.memory_peak_rss"].Data.(metricdata.Gauge[int64])
		require.Positive(t, peak.DataPoints[0].Value)
	} else {
		_, exists := measurements["omniview.process.cpu_time"]
		require.False(t, exists)
	}
}
