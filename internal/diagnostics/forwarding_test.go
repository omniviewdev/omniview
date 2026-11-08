package diagnostics

import (
	"context"
	"testing"
	"time"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

type cadenceExporter struct{ values chan int64 }

func (e *cadenceExporter) Temporality(sdkmetric.InstrumentKind) metricdata.Temporality {
	return metricdata.CumulativeTemporality
}
func (e *cadenceExporter) Aggregation(k sdkmetric.InstrumentKind) sdkmetric.Aggregation {
	return sdkmetric.DefaultAggregationSelector(k)
}
func (e *cadenceExporter) ForceFlush(ctx context.Context) error { return ctx.Err() }
func (e *cadenceExporter) Shutdown(ctx context.Context) error   { return ctx.Err() }
func (e *cadenceExporter) Export(ctx context.Context, data *metricdata.ResourceMetrics) error {
	value := data.ScopeMetrics[0].Metrics[0].Data.(metricdata.Sum[int64]).DataPoints[0].Value
	select {
	case e.values <- value:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func TestRemoteCadenceCoalescesAndFlushesLatest(t *testing.T) {
	s, err := New(Options{Directory: t.TempDir(), Interval: time.Millisecond, RemoteInterval: 150 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	exporter := &cadenceExporter{values: make(chan int64, 16)}
	s.SetRemote(exporter)
	take := func(want int64) {
		t.Helper()
		select {
		case got := <-exporter.values:
			if got != want {
				t.Fatalf("exported %d, want latest %d", got, want)
			}
		case <-time.After(time.Second):
			t.Fatal("remote export missing")
		}
	}
	if err = s.Export(context.Background(), testData(1)); err != nil {
		t.Fatal(err)
	}
	take(1)
	for value := int64(2); value <= 5; value++ {
		if err = s.Export(context.Background(), testData(value)); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case value := <-exporter.values:
		t.Fatalf("local sampling accelerated remote export: %d", value)
	case <-time.After(25 * time.Millisecond):
	}
	if s.GetSnapshot().Sequence != 5 {
		t.Fatal("remote cadence delayed local samples")
	}
	take(5)
	if err = s.Export(context.Background(), testData(6)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err = s.ForceFlush(ctx); err != nil {
		t.Fatal(err)
	}
	take(6)
	if err = s.Export(context.Background(), testData(7)); err != nil {
		t.Fatal(err)
	}
	if err = s.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	take(7)
	select {
	case value := <-exporter.values:
		t.Fatalf("duplicate/coalesced intermediate export: %d", value)
	default:
	}
}
func TestRemoteIntervalPreservesSDKEnvironmentConvention(t *testing.T) {
	for _, value := range []string{"", "invalid", "0", "-1"} {
		t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", value)
		if got := resolveRemoteInterval(0); got != time.Minute {
			t.Fatalf("%q selected %v", value, got)
		}
	}
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "125")
	if got := resolveRemoteInterval(0); got != 125*time.Millisecond {
		t.Fatal(got)
	}
	if got := resolveRemoteInterval(50 * time.Millisecond); got != 50*time.Millisecond {
		t.Fatal(got)
	}
}
