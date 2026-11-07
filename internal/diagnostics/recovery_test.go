package diagnostics

import (
	"context"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"strings"
	"testing"
	"time"
)

func TestCompatibleHistogramsMergeWithoutChangingBuckets(t *testing.T) {
	start := time.Unix(1, 0)
	metric := Metric{Name: "latency", Kind: "histogram", Points: []Point{
		{Attributes: map[string]string{}, StartTime: start, Count: 3, Sum: 5, Bounds: []float64{1}, BucketCounts: []uint64{1, 2}},
		{Attributes: map[string]string{}, StartTime: start, Count: 4, Sum: 8, Bounds: []float64{1}, BucketCounts: []uint64{2, 2}},
	}}
	points, valid := normalizedPoints(metric)
	if !valid || len(points) != 1 || points[0].Count != 7 || points[0].Sum != 13 || points[0].BucketCounts[0] != 3 || points[0].BucketCounts[1] != 4 {
		t.Fatalf("incorrect additive normalization: %+v %v", points, valid)
	}
	metric.Points[1].Bounds = []float64{2}
	if _, valid := normalizedPoints(metric); valid {
		t.Fatal("incompatible buckets merged")
	}
	metric.Points[1].Bounds = []float64{1}
	metric.Points[1].StartTime = time.Unix(2, 0)
	if _, valid := normalizedPoints(metric); valid {
		t.Fatal("unrelated cumulative start times merged")
	}
	metric.Kind = "gauge"
	metric.Points[1].StartTime = start
	if _, valid := normalizedPoints(metric); valid {
		t.Fatal("ambiguous gauges merged")
	}
}
func TestCurrentHealthRecoversButCaptureWindowRetainsLoss(t *testing.T) {
	s := testService(t)
	export := func(value int64) {
		t.Helper()
		if err := s.Export(context.Background(), testData(value)); err != nil {
			t.Fatal(err)
		}
	}
	export(1)
	affected, err := s.StartCapture(CaptureRequest{Name: "affected", DurationSeconds: 10})
	if err != nil {
		t.Fatal(err)
	}
	export(2)
	bad := testData(3)
	sum := bad.ScopeMetrics[0].Metrics[0].Data.(metricdata.Sum[int64])
	other := sum.DataPoints[0]
	other.Attributes = attribute.NewSet(attribute.String("operation", "list"), attribute.String("connection_id", "private-other"))
	sum.DataPoints = append(sum.DataPoints, other)
	bad.ScopeMetrics[0].Metrics[0].Data = sum
	if err := s.Export(context.Background(), bad); err != nil {
		t.Fatal(err)
	}
	dropped := s.GetSnapshot()
	if dropped.Health.Complete || !strings.Contains(dropped.Health.LastError, "ambiguous") || strings.Contains(dropped.Health.LastError, "limit") {
		t.Fatalf("drop explanation wrong: %+v", dropped.Health)
	}
	export(4)
	healthy := s.GetSnapshot()
	if !healthy.Health.Complete || healthy.Health.Dropped != 1 || healthy.Health.LastError != "" {
		t.Fatalf("health never recovered: %+v", healthy.Health)
	}
	captured, err := s.GetCapture(affected.ID)
	if err != nil || captured.Coverage.Complete || captured.Coverage.Dropped != 1 {
		t.Fatalf("loss erased from capture: %+v %v", captured, err)
	}
	if _, err = s.CancelCapture(affected.ID); err != nil {
		t.Fatal(err)
	}
	fresh, err := s.StartCapture(CaptureRequest{Name: "fresh", DurationSeconds: 1})
	if err != nil {
		t.Fatal(err)
	}
	export(5)
	time.Sleep(1100 * time.Millisecond)
	export(6)
	captured, err = s.GetCapture(fresh.ID)
	if err != nil || captured.Status != "complete" || !captured.Coverage.Complete || captured.Coverage.Dropped != 0 {
		t.Fatalf("fresh capture inherited lifetime loss: %+v %v", captured, err)
	}
	s.mu.Lock()
	s.samples[len(s.samples)-1].Timestamp = time.Now().Add(-7 * time.Second)
	s.mu.Unlock()
	export(7)
	if s.GetSnapshot().Health.Complete {
		t.Fatal("real collection gap was hidden")
	}
	export(8)
	history := s.GetHistory()
	if !history.Health.Complete || history.Health.Gaps != 1 || history.Samples[0].Health.Complete || history.Samples[0].Health.Gaps != 1 {
		t.Fatalf("recovery erased actual history gap: %+v", history)
	}
}
