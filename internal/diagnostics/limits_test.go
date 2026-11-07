package diagnostics

import (
	"context"
	"fmt"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"strings"
	"testing"
)

func TestCountLimitDiagnosticDoesNotClaimAmbiguity(t *testing.T) {
	s := testService(t)
	points := make([]metricdata.DataPoint[int64], 17)
	for i := range points {
		points[i] = metricdata.DataPoint[int64]{Attributes: attribute.NewSet(attribute.String("state", fmt.Sprintf("bounded-state-%d", i))), Value: int64(i)}
	}
	data := &metricdata.ResourceMetrics{ScopeMetrics: []metricdata.ScopeMetrics{{Metrics: []metricdata.Metrics{{Name: "bounded.gauge", Data: metricdata.Gauge[int64]{DataPoints: points}}}}}}
	if err := s.Export(context.Background(), data); err != nil {
		t.Fatal(err)
	}
	snapshot := s.GetSnapshot()
	if snapshot.Health.Complete || snapshot.Health.Dropped != 1 || !strings.Contains(snapshot.Health.LastError, "limit") || strings.Contains(snapshot.Health.LastError, "ambiguous") {
		t.Fatalf("limit diagnostic wrong: %+v", snapshot.Health)
	}
	if len(snapshot.Metrics) != 1 || len(snapshot.Metrics[0].Points) != 16 {
		t.Fatalf("series bound changed: %+v", snapshot.Metrics)
	}
}
