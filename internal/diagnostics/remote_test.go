package diagnostics

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

type blockedExporter struct {
	started chan struct{}
	release chan struct{}
	exports atomic.Int64
}

func (e *blockedExporter) Temporality(sdkmetric.InstrumentKind) metricdata.Temporality {
	return metricdata.CumulativeTemporality
}
func (e *blockedExporter) Aggregation(k sdkmetric.InstrumentKind) sdkmetric.Aggregation {
	return sdkmetric.DefaultAggregationSelector(k)
}
func (e *blockedExporter) Export(ctx context.Context, _ *metricdata.ResourceMetrics) error {
	select {
	case e.started <- struct{}{}:
	default:
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-e.release:
		e.exports.Add(1)
		return nil
	}
}
func (e *blockedExporter) ForceFlush(context.Context) error { return nil }
func (e *blockedExporter) Shutdown(context.Context) error   { return nil }
func TestRemoteNetworkCannotBlockLocalCollection(t *testing.T) {
	s := testService(t)
	remote := &blockedExporter{started: make(chan struct{}, 1), release: make(chan struct{})}
	t.Cleanup(func() { close(remote.release) })
	s.SetRemote(remote)
	if err := s.Export(context.Background(), testData(1)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-remote.started:
	case <-time.After(time.Second):
		t.Fatal("remote worker did not start")
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := int64(2); i < 6; i++ {
			_ = s.Export(context.Background(), testData(i))
		}
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("remote network blocked local collection")
	}
	snapshot := s.GetSnapshot()
	if snapshot.Sequence != 5 || snapshot.Metrics[0].Points[0].Value != 5 {
		t.Fatalf("local collection stalled: %+v", snapshot)
	}
	s.mu.RLock()
	pending := s.pending
	s.mu.RUnlock()
	if pending == nil || pending.ScopeMetrics[0].Metrics[0].Data.(metricdata.Sum[int64]).DataPoints[0].Value != 5 {
		t.Fatal("bounded remote pending slot did not retain newest cumulative sample")
	}
}

func TestFlushWaitsForPendingExportsAndHonorsDeadline(t *testing.T) {
	s := testService(t)
	remote := &blockedExporter{started: make(chan struct{}, 1), release: make(chan struct{})}
	s.SetRemote(remote)
	if err := s.Export(context.Background(), testData(1)); err != nil {
		t.Fatal(err)
	}
	select {
	case <-remote.started:
	case <-time.After(time.Second):
		t.Fatal("remote did not start")
	}
	if err := s.Export(context.Background(), testData(2)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	err := s.ForceFlush(ctx)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		close(remote.release)
		t.Fatalf("flush ignored deadline: %v", err)
	}
	close(remote.release)
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := s.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if remote.exports.Load() != 2 {
		t.Fatalf("shutdown discarded final pending collection: %d", remote.exports.Load())
	}
}
