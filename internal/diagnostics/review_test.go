package diagnostics

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestUnusableSavedCaptureIsSetAsideInsteadOfBlockingStartup(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "captures")
	first, err := New(Options{Directory: dir})
	require.NoError(t, err)
	good, err := first.StartCapture(CaptureRequest{Name: "good", DurationSeconds: 10})
	require.NoError(t, err)
	require.NoError(t, first.Close())
	bad := filepath.Join(dir, "0123456789abcdef0123456789abcdef.json")
	require.NoError(t, os.WriteFile(bad, []byte("{not json"), 0o600))

	again, err := New(Options{Directory: dir})
	require.NoError(t, err, "one malformed capture must not stop the application")
	t.Cleanup(func() { _ = again.Close() })
	_, err = again.GetCapture(good.ID)
	require.NoError(t, err, "valid captures still load")
	_, err = os.Stat(bad + ".invalid")
	require.NoError(t, err, "unusable file is kept for inspection")
	require.NotEmpty(t, again.GetSnapshot().Health.LastError)
}

func TestFinishedCaptureCanBeRemovedToFreeItsSlot(t *testing.T) {
	s := testService(t)
	var ids []string
	for i := range 20 {
		c, err := s.StartCapture(CaptureRequest{Name: fmt.Sprintf("c%d", i), DurationSeconds: 1})
		require.NoError(t, err)
		_, err = s.CancelCapture(c.ID)
		require.NoError(t, err)
		ids = append(ids, c.ID)
	}
	_, err := s.StartCapture(CaptureRequest{Name: "over", DurationSeconds: 1})
	require.Error(t, err, "the capture limit is enforced")

	require.NoError(t, s.DeleteCapture(ids[0]))
	_, err = os.Stat(filepath.Join(s.opts.Directory, ids[0]+".json"))
	require.ErrorIs(t, err, os.ErrNotExist, "removal frees disk as well as the slot")
	_, err = s.StartCapture(CaptureRequest{Name: "after", DurationSeconds: 1})
	require.NoError(t, err)

	running, err := s.StartCapture(CaptureRequest{Name: "running", DurationSeconds: 100})
	require.Error(t, err, "two captures already running or limit reached must still refuse")
	_ = running
	require.Error(t, s.DeleteCapture("deadbeefdeadbeefdeadbeefdeadbeef"))
}

func TestRunningCaptureCannotBeDeleted(t *testing.T) {
	s := testService(t)
	c, err := s.StartCapture(CaptureRequest{Name: "live", DurationSeconds: 100})
	require.NoError(t, err)
	require.Error(t, s.DeleteCapture(c.ID))
}

func TestSeriesBudgetCoversAllSupportedPlugins(t *testing.T) {
	var points []metricdata.DataPoint[int64]
	for i := range 32 {
		points = append(points, metricdata.DataPoint[int64]{Value: int64(i), Attributes: attribute.NewSet(attribute.String("plugin", fmt.Sprintf("plugin-%02d", i)))})
	}
	data := &metricdata.ResourceMetrics{ScopeMetrics: []metricdata.ScopeMetrics{{Metrics: []metricdata.Metrics{{Name: "omniview.plugin.process.memory_rss", Unit: "By", Data: metricdata.Gauge[int64]{DataPoints: points}}}}}}
	s := testService(t)
	require.NoError(t, s.Export(context.Background(), data))
	snapshot := s.GetSnapshot()
	require.Len(t, snapshot.Metrics[0].Points, 32)
	require.True(t, snapshot.Health.Complete, "32 plugins must not make collection incomplete")
}

func TestStaleCollectionIsNotServedAsFreshScrape(t *testing.T) {
	s, err := New(Options{Directory: filepath.Join(t.TempDir(), "captures"), Interval: 10 * time.Millisecond})
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	require.False(t, s.Fresh(), "no collection yet")
	require.NoError(t, s.Export(context.Background(), testData(1)))
	require.True(t, s.Fresh())
	time.Sleep(60 * time.Millisecond)
	require.False(t, s.Fresh(), "collection stopped: scrapes must fail rather than republish cached values")
}

func TestRemoteCopyOwnsHistogramBuffers(t *testing.T) {
	bounds := []float64{1, 2}
	counts := []uint64{1, 2, 3}
	data := &metricdata.ResourceMetrics{ScopeMetrics: []metricdata.ScopeMetrics{{Metrics: []metricdata.Metrics{{Name: "latency", Unit: "ms", Data: metricdata.Histogram[float64]{
		Temporality: metricdata.CumulativeTemporality,
		DataPoints:  []metricdata.HistogramDataPoint[float64]{{Count: 6, Sum: 12, Bounds: bounds, BucketCounts: counts}},
	}}}}}}
	owned := copyResource(data)
	bounds[0], counts[0] = 99, 99
	got := owned.ScopeMetrics[0].Metrics[0].Data.(metricdata.Histogram[float64]).DataPoints[0]
	require.Equal(t, []float64{1, 2}, got.Bounds)
	require.Equal(t, []uint64{1, 2, 3}, got.BucketCounts)
}
