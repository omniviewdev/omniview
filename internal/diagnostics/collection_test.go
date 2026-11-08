package diagnostics

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func testService(t *testing.T) *Service {
	t.Helper()
	s, err := New(Options{Directory: filepath.Join(t.TempDir(), "captures"), HistoryLimit: 2})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}
func testData(value int64) *metricdata.ResourceMetrics {
	return &metricdata.ResourceMetrics{ScopeMetrics: []metricdata.ScopeMetrics{{Metrics: []metricdata.Metrics{{Name: "requests", Data: metricdata.Sum[int64]{IsMonotonic: true, DataPoints: []metricdata.DataPoint[int64]{{Value: value, StartTime: time.Unix(1, 0), Attributes: attribute.NewSet(attribute.String("operation", "list"), attribute.String("connection_id", "secret"))}}}}}}}}
}
func TestHistoryIsBoundedAndImmutable(t *testing.T) {
	s := testService(t)
	for i := int64(0); i < 4; i++ {
		if err := s.Export(context.Background(), testData(i)); err != nil {
			t.Fatal(err)
		}
	}
	h := s.GetHistory()
	if len(h.Samples) != 2 {
		t.Fatal(len(h.Samples))
	}
	h.Samples[1].Metrics[0].Points[0].Value = 999
	h.Samples[1].Metrics[0].Points[0].Attributes["operation"] = "changed"
	p := s.GetSnapshot().Metrics[0].Points[0]
	if p.Value != 3 || p.Attributes["operation"] != "list" || p.Attributes["connection_id"] != "" {
		t.Fatalf("unsafe mutable snapshot: %+v", p)
	}
}
func TestPrometheusHistogramUsesCumulativeBuckets(t *testing.T) {
	s := testService(t)
	data := &metricdata.ResourceMetrics{ScopeMetrics: []metricdata.ScopeMetrics{{Metrics: []metricdata.Metrics{{Name: "latency", Data: metricdata.Histogram[float64]{DataPoints: []metricdata.HistogramDataPoint[float64]{{Count: 9, Sum: 10, Bounds: []float64{1, 2}, BucketCounts: []uint64{2, 3, 4}}}}}}}}}
	if err := s.Export(context.Background(), data); err != nil {
		t.Fatal(err)
	}
	text := s.Prometheus()
	for _, want := range []string{"latency_bucket{le=\"1\"} 2", "latency_bucket{le=\"2\"} 5", "latency_bucket{le=\"+Inf\"} 9"} {
		if !strings.Contains(text, want) {
			t.Fatal(text)
		}
	}
}
func TestCaptureRestartMarksInterruptedAndPrivate(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "captures")
	s, err := New(Options{Directory: dir})
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.StartCapture(CaptureRequest{Name: "before", DurationSeconds: 10})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, c.ID+".json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("permissions: %v %v", info, err)
	}
	again, err := New(Options{Directory: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	loaded, err := again.GetCapture(c.ID)
	if err != nil || loaded.Status != "interrupted" || loaded.Coverage.Complete {
		t.Fatalf("%+v %v", loaded, err)
	}
}
func TestCounterComparisonRejectsReset(t *testing.T) {
	start := time.Unix(1, 0)
	c := Capture{Samples: []Snapshot{{ElapsedSeconds: 1, Metrics: []Metric{{Name: "calls", Kind: "counter", Points: []Point{{Value: 100, StartTime: start}}}}}, {ElapsedSeconds: 3, Metrics: []Metric{{Name: "calls", Kind: "counter", Points: []Point{{Value: 110, StartTime: start}}}}}}}
	v := summarize(c)["callsnull"]
	if !v.Valid || v.Baseline != 5 {
		t.Fatalf("%+v", v)
	}
	c.Samples[1].Metrics[0].Points[0].StartTime = time.Unix(2, 0)
	if summarize(c)["callsnull"].Valid {
		t.Fatal("reset accepted")
	}
}
func TestRemoteCopyOwnsSDKBuffers(t *testing.T) {
	data := testData(3)
	owned := copyResource(data)
	sum := data.ScopeMetrics[0].Metrics[0].Data.(metricdata.Sum[int64])
	sum.DataPoints[0].Value = 99
	if owned.ScopeMetrics[0].Metrics[0].Data.(metricdata.Sum[int64]).DataPoints[0].Value != 3 {
		t.Fatal("remote retained SDK buffer")
	}
}

// Plugin-reported metrics rely on this: every key a plugin may attach, with the
// host-stamped plugin label and the maximum four attributes, must survive
// attribute filtering; anything else must not.
func TestPluginReportedAttributeKeysSurviveAllowlist(t *testing.T) {
	for _, key := range []string{"operation", "outcome", "phase", "state", "reason", "cache", "queue", "direction", "event"} {
		got := safeAttributes(attribute.NewSet(attribute.String("plugin", "kube"), attribute.String(key, "ok")))
		if got["plugin"] != "kube" || got[key] != "ok" {
			t.Fatalf("%s dropped: %v", key, got)
		}
	}
	got := safeAttributes(attribute.NewSet(attribute.String("plugin", "kube"), attribute.String("operation", "a"), attribute.String("outcome", "b"),
		attribute.String("phase", "c"), attribute.String("state", "d"), attribute.String("resource_name", "secret")))
	if len(got) != 5 || got["resource_name"] != "" {
		t.Fatalf("unexpected attributes: %v", got)
	}
}
