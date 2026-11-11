package resource

import (
	"context"
	"os"
	"os/exec"
	"testing"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/omniviewdev/omniview/internal/telemetry"
)

// NewMetrics installs a process-global registry. Isolate it so other resource
// tests cannot inherit a stopped provider or race with registry replacement.
func TestH3SourceOverflowMetric(t *testing.T) {
	const child = "OMNIVIEW_H3_METRIC_CHILD"
	if os.Getenv(child) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestH3SourceOverflowMetric$")
		cmd.Env = append(os.Environ(), child+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated metric test: %v\n%s", err, output)
		}
		return
	}
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	defer func() {
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Error(err)
		}
	}()
	if _, err := telemetry.NewMetrics(provider); err != nil {
		t.Fatal(err)
	}
	s := &sourceSession{
		coordinator: newSourceCoordinator(&controller{}), ctx: context.Background(), pluginID: "plugin",
		pluginGeneration: &pluginState{generationID: "generation"},
		members:          make(map[string]sourceMember), hasSnapshot: true,
	}
	v := newSourceView(s, "view", "owner", "target")
	v.resetLocked("overflow", "Source view queue overflowed.")
	var data metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &data); err != nil {
		t.Fatal(err)
	}
	if !hasSourceOverflowMetric(data) {
		t.Fatal("source overflow stream metric not recorded")
	}
}

func hasSourceOverflowMetric(data metricdata.ResourceMetrics) bool {
	for _, scope := range data.ScopeMetrics {
		for _, metric := range scope.Metrics {
			if metric.Name != "omniview.plugin.stream.events" {
				continue
			}
			sum, ok := metric.Data.(metricdata.Sum[int64])
			if !ok {
				continue
			}
			for _, point := range sum.DataPoints {
				if isSourceOverflowPoint(point) {
					return true
				}
			}
		}
	}
	return false
}

func isSourceOverflowPoint(point metricdata.DataPoint[int64]) bool {
	attrs := map[string]string{}
	for _, attr := range point.Attributes.ToSlice() {
		attrs[string(attr.Key)] = attr.Value.AsString()
	}
	return point.Value == 1 && attrs["stream"] == "source" && attrs["event"] == "overflow"
}
