package diagnostics

import (
	"context"
	otelruntime "go.opentelemetry.io/contrib/instrumentation/runtime"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"testing"
	"time"
)

func TestRealRuntimeMemoryDimensionsKeepCaptureComplete(t *testing.T) {
	s := testService(t)
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithCardinalityLimit(128))
	defer provider.Shutdown(context.Background())
	if err := otelruntime.Start(otelruntime.WithMeterProvider(provider)); err != nil {
		t.Fatal(err)
	}
	capture, err := s.StartCapture(CaptureRequest{Name: "actual-runtime", DurationSeconds: 1})
	if err != nil {
		t.Fatal(err)
	}
	collect := func() {
		t.Helper()
		var data metricdata.ResourceMetrics
		if err := reader.Collect(context.Background(), &data); err != nil {
			t.Fatal(err)
		}
		if err := s.Export(context.Background(), &data); err != nil {
			t.Fatal(err)
		}
	}
	collect()
	found := false
	for _, metric := range s.GetSnapshot().Metrics {
		if metric.Name != "go.memory.used" {
			continue
		}
		types := map[string]bool{}
		for _, point := range metric.Points {
			types[point.Attributes["go.memory.type"]] = true
		}
		if !types["stack"] || !types["other"] || len(types) != 2 {
			t.Fatalf("runtime dimensions lost: %+v", metric)
		}
		found = true
	}
	if !found {
		t.Fatal("actual runtime memory metric missing")
	}
	time.Sleep(1100 * time.Millisecond)
	collect()
	capture, err = s.GetCapture(capture.ID)
	if err != nil || capture.Status != "complete" || !capture.Coverage.Complete || s.GetHistory().Health.Dropped != 0 {
		t.Fatalf("normal runtime collection degraded: %+v %v", capture, err)
	}
}
func TestStaleHealthDoesNotRenewSamplesOrInflateGapCounts(t *testing.T) {
	s := testService(t)
	if err := s.Export(context.Background(), testData(1)); err != nil {
		t.Fatal(err)
	}
	original := s.GetSnapshot()
	s.mu.Lock()
	s.lastSuccess = time.Now().Add(-7 * time.Second)
	s.mu.Unlock()
	first, second := s.GetSnapshot(), s.GetSnapshot()
	if first.Health.Complete || second.Health.Complete || first.Health.Gaps != second.Health.Gaps || first.Health.Gaps != 1 {
		t.Fatalf("stale health incorrect: %+v %+v", first.Health, second.Health)
	}
	if !first.Timestamp.Equal(original.Timestamp) || second.Sequence != original.Sequence || s.GetHistory().Health.Complete {
		t.Fatal("read renewed stale collection")
	}
	s.mu.RLock()
	gaps := s.health.Gaps
	s.mu.RUnlock()
	if gaps != 0 {
		t.Fatal("reading stale data mutated collection counters")
	}
}
func TestCaptureDeadlineTerminatesWithoutAnotherCollection(t *testing.T) {
	s, err := New(Options{Directory: t.TempDir(), Interval: 10 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	capture, err := s.StartCapture(CaptureRequest{Name: "no-collector", DurationSeconds: 1})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-deadline:
			t.Fatal("capture never terminated without collection")
		case <-tick.C:
			capture, err = s.GetCapture(capture.ID)
			if err != nil {
				t.Fatal(err)
			}
			if capture.Status == "running" {
				continue
			}
			if capture.Status != "incomplete" || capture.Coverage.Complete || capture.Error == "" || capture.ElapsedSeconds != 0 {
				t.Fatalf("false capture completion: %+v", capture)
			}
			return
		}
	}
}
