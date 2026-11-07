package diagnostics

import (
	"context"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"strings"
	"testing"
)

func TestDroppedLabelsCannotProduceIndistinguishableSeries(t *testing.T) {
	s := testService(t)
	data := testData(2)
	sum := data.ScopeMetrics[0].Metrics[0].Data.(metricdata.Sum[int64])
	extra := sum.DataPoints[0]
	extra.Attributes = attribute.NewSet(attribute.String("operation", "list"), attribute.String("connection_id", "different"))
	sum.DataPoints = append(sum.DataPoints, extra)
	data.ScopeMetrics[0].Metrics[0].Data = sum
	if err := s.Export(context.Background(), data); err != nil {
		t.Fatal(err)
	}
	snapshot := s.GetSnapshot()
	if len(snapshot.Metrics) != 0 || snapshot.Health.Dropped != 1 || snapshot.Health.Complete {
		t.Fatalf("ambiguous series exposed: %+v", snapshot)
	}
}
func TestCaptureStartsWithFreshSampleEndpoint(t *testing.T) {
	s := testService(t)
	if err := s.Export(context.Background(), testData(100)); err != nil {
		t.Fatal(err)
	}
	c, err := s.StartCapture(CaptureRequest{Name: "fresh", DurationSeconds: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Samples) != 0 {
		t.Fatal("capture reused stale cached baseline")
	}
	if err = s.Export(context.Background(), testData(110)); err != nil {
		t.Fatal(err)
	}
	c, err = s.GetCapture(c.ID)
	if err != nil || len(c.Samples) != 1 || c.ElapsedSeconds != 0 || c.Status != "running" {
		t.Fatalf("invalid first endpoint: %+v %v", c, err)
	}
	if _, err = s.GetCapture("fresh"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.StartCapture(CaptureRequest{Name: "fresh", DurationSeconds: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.GetCapture("fresh"); ErrorCode(err) != "conflict" {
		t.Fatalf("ambiguous name accepted: %v", err)
	}
}
func TestPrometheusOmitSanitizedNameCollisions(t *testing.T) {
	s := testService(t)
	data := testData(1)
	data.ScopeMetrics[0].Metrics[0].Name = "calls.total"
	second := data.ScopeMetrics[0].Metrics[0]
	second.Name = "calls_total"
	data.ScopeMetrics[0].Metrics = append(data.ScopeMetrics[0].Metrics, second)
	if err := s.Export(context.Background(), data); err != nil {
		t.Fatal(err)
	}
	text := s.Prometheus()
	if strings.Contains(text, "calls_total{") || !strings.Contains(text, "omitted conflicting") {
		t.Fatal(text)
	}
	if got := labelValue("quote\"slash\\line\n"); got != "\"quote\\\"slash\\\\line\\n\"" {
		t.Fatal(got)
	}
}
