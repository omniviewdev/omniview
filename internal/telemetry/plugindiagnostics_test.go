package telemetry

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/diagnostics"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func reset(t *testing.T) {
	t.Helper()
	StopPluginDiagnostics()
	t.Cleanup(StopPluginDiagnostics)
}

func counterReply(id string, value float64, attrs ...*lifecyclepb.DiagAttr) *lifecyclepb.GetDiagnosticsResponse {
	return &lifecyclepb.GetDiagnosticsResponse{
		SchemaVersion: 1, PluginId: id, ProcessStartUnixNs: 1_000,
		Metrics: []*lifecyclepb.DiagMetric{{
			Name: "omniview.plugin.self.api.calls", Unit: "1", Kind: lifecyclepb.DiagKind_DIAG_KIND_COUNTER,
			Points: []*lifecyclepb.DiagPoint{{Attrs: attrs, Value: value}},
		}},
	}
}

func outcome(v string) *lifecyclepb.DiagAttr {
	return &lifecyclepb.DiagAttr{Key: lifecyclepb.DiagKey_DIAG_KEY_OUTCOME, Value: v}
}

func settle(t *testing.T, id string) {
	t.Helper()
	require.Eventually(t, func() bool {
		pluginDiagnostics.Lock()
		defer pluginDiagnostics.Unlock()
		e := pluginDiagnostics.entries[id]
		return e != nil && !e.inFlight && e.state != ""
	}, 2*time.Second, time.Millisecond)
}

func statusOf(t *testing.T, id string) string {
	t.Helper()
	for _, scope := range producePluginDiagnostics(time.Now()) {
		for _, m := range scope.Metrics {
			if m.Name != PluginDiagnosticsStatusMetric {
				continue
			}
			for _, p := range m.Data.(metricdata.Gauge[float64]).DataPoints {
				if v, _ := p.Attributes.Value("plugin"); v.AsString() == id {
					s, _ := p.Attributes.Value("state")
					return s.AsString()
				}
			}
		}
	}
	return ""
}

func TestHostStampsIdentityAndMismatchVoidsReply(t *testing.T) {
	reset(t)
	pollPluginDiagnostics(context.Background(), []PluginDiagnosticsTarget{
		{PluginID: "kube", Generation: 1, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
			return counterReply("kube", 5, outcome("ok")), nil
		}},
		{PluginID: "liar", Generation: 1, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
			return counterReply("kube", 9), nil // claims another plugin's identity
		}},
	})
	settle(t, "kube")
	settle(t, "liar")
	require.Equal(t, DiagnosticsOK, statusOf(t, "kube"))
	require.Equal(t, DiagnosticsInvalid, statusOf(t, "liar"))
	var points []metricdata.DataPoint[float64]
	for _, scope := range producePluginDiagnostics(time.Now()) {
		for _, m := range scope.Metrics {
			if sum, ok := m.Data.(metricdata.Sum[float64]); ok {
				points = append(points, sum.DataPoints...)
			}
		}
	}
	require.Len(t, points, 1)
	plugin, _ := points[0].Attributes.Value("plugin")
	require.Equal(t, "kube", plugin.AsString())
	require.Equal(t, int64(1_000), points[0].StartTime.UnixNano())
}

func TestUnsupportedIsCachedPerGenerationAndNeverZero(t *testing.T) {
	reset(t)
	var calls atomic.Int32
	target := func(generation int) PluginDiagnosticsTarget {
		return PluginDiagnosticsTarget{PluginID: "old", Generation: generation, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
			calls.Add(1)
			return nil, status.Error(codes.Unimplemented, "no")
		}}
	}
	for i := 0; i < 3; i++ {
		pollPluginDiagnostics(context.Background(), []PluginDiagnosticsTarget{target(1)})
		settle(t, "old")
	}
	require.EqualValues(t, 1, calls.Load(), "probe repeated for one backend generation")
	require.Equal(t, DiagnosticsUnsupported, statusOf(t, "old"))
	pollPluginDiagnostics(context.Background(), []PluginDiagnosticsTarget{target(2)})
	require.Eventually(t, func() bool { return calls.Load() == 2 }, time.Second, time.Millisecond)
	for _, scope := range producePluginDiagnostics(time.Now()) {
		require.Len(t, scope.Metrics, 1, "unsupported plugin emitted measurement points")
	}
}

func TestOneCallInFlightAndProducerNeverBlocks(t *testing.T) {
	reset(t)
	release := make(chan struct{})
	var calls atomic.Int32
	target := PluginDiagnosticsTarget{PluginID: "slow", Generation: 1, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
		calls.Add(1)
		<-release
		return counterReply("slow", 1), nil
	}}
	for i := 0; i < 5; i++ {
		pollPluginDiagnostics(context.Background(), []PluginDiagnosticsTarget{target})
	}
	require.Eventually(t, func() bool { return calls.Load() >= 1 }, time.Second, time.Millisecond)
	done := make(chan struct{})
	go func() { producePluginDiagnostics(time.Now()); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("producer blocked on a slow plugin")
	}
	close(release)
	settle(t, "slow")
	require.EqualValues(t, 1, calls.Load())
}

func TestDeadlineAndErrorsEmitNoPoints(t *testing.T) {
	reset(t)
	pollPluginDiagnostics(context.Background(), []PluginDiagnosticsTarget{{PluginID: "hang", Generation: 1, Fetch: func(ctx context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}}, {PluginID: "boom", Generation: 1, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
		return nil, errors.New("boom")
	}}})
	settle(t, "hang")
	settle(t, "boom")
	require.Equal(t, DiagnosticsError, statusOf(t, "hang"))
	require.Equal(t, DiagnosticsError, statusOf(t, "boom"))
}

func TestStaleReplyIsUnavailableNotLastValue(t *testing.T) {
	reset(t)
	pollPluginDiagnostics(context.Background(), []PluginDiagnosticsTarget{{PluginID: "kube", Generation: 1, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
		return counterReply("kube", 1), nil
	}}})
	settle(t, "kube")
	later := time.Now().Add(pluginDiagnosticsStale + time.Second)
	scopes := producePluginDiagnostics(later)
	require.Len(t, scopes[0].Metrics, 1)
	g := scopes[0].Metrics[0].Data.(metricdata.Gauge[float64]).DataPoints[0]
	state, _ := g.Attributes.Value("state")
	require.Equal(t, DiagnosticsStale, state.AsString())
}

func TestReplacedBackendDiscardsInFlightResult(t *testing.T) {
	reset(t)
	release := make(chan struct{})
	pollPluginDiagnostics(context.Background(), []PluginDiagnosticsTarget{{PluginID: "kube", Generation: 1, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
		<-release
		return counterReply("kube", 99), nil
	}}})
	pollPluginDiagnostics(context.Background(), []PluginDiagnosticsTarget{{PluginID: "kube", Generation: 2, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
		return nil, errors.New("starting")
	}}})
	close(release)
	settle(t, "kube")
	time.Sleep(20 * time.Millisecond)
	require.Equal(t, DiagnosticsError, statusOf(t, "kube"))
}

func TestValidationDropsNonconformingDataWithoutClamping(t *testing.T) {
	good := &lifecyclepb.DiagPoint{Attrs: []*lifecyclepb.DiagAttr{outcome("ok")}, Value: 1}
	cases := map[string]*lifecyclepb.DiagPoint{
		"resource-name value": {Attrs: []*lifecyclepb.DiagAttr{{Key: lifecyclepb.DiagKey_DIAG_KEY_OPERATION, Value: "pods/default/secret"}}},
		"unknown key":         {Attrs: []*lifecyclepb.DiagAttr{{Key: 77, Value: "x"}}},
		"duplicate key":       {Attrs: []*lifecyclepb.DiagAttr{outcome("a"), outcome("b")}},
		"negative counter":    {Value: -1},
	}
	for name, bad := range cases {
		reply := counterReply("kube", 0)
		reply.Metrics[0].Points = []*lifecyclepb.DiagPoint{bad, good}
		out, ok := validatePluginDiagnostics("kube", reply)
		require.True(t, ok, name)
		require.Len(t, out.metrics[0].Points, 1, name)
		require.True(t, out.truncated, name)
	}
	for name, mutate := range map[string]func(*lifecyclepb.GetDiagnosticsResponse){
		"schema":        func(r *lifecyclepb.GetDiagnosticsResponse) { r.SchemaVersion = 2 },
		"no start time": func(r *lifecyclepb.GetDiagnosticsResponse) { r.ProcessStartUnixNs = 0 },
		"host metric":   nil,
	} {
		reply := counterReply("kube", 1)
		if mutate == nil {
			reply.Metrics[0].Name = "omniview.plugin.active" // host-owned namespace
			out, ok := validatePluginDiagnostics("kube", reply)
			require.True(t, ok)
			require.Empty(t, out.metrics, name)
			continue
		}
		mutate(reply)
		_, ok := validatePluginDiagnostics("kube", reply)
		require.False(t, ok, name)
	}
	big := counterReply("kube", 1)
	big.Metrics[0].Unit = string(make([]byte, maxPluginDiagnosticsBytes))
	_, ok := validatePluginDiagnostics("kube", big)
	require.False(t, ok, "oversize reply")
}

func TestHistogramValidation(t *testing.T) {
	hist := func(bounds []float64, buckets []uint64, count uint64) *lifecyclepb.DiagMetric {
		return &lifecyclepb.DiagMetric{Name: "omniview.plugin.self.lat", Unit: "s", Kind: lifecyclepb.DiagKind_DIAG_KIND_HISTOGRAM,
			Points: []*lifecyclepb.DiagPoint{{Bounds: bounds, BucketCounts: buckets, Count: count, Sum: 1}}}
	}
	_, ok := validateDiagMetric(hist([]float64{1, 2}, []uint64{1, 1, 1}, 3))
	require.True(t, ok)
	for name, m := range map[string]*lifecyclepb.DiagMetric{
		"count mismatch":  hist([]float64{1, 2}, []uint64{1, 1, 1}, 9),
		"bucket mismatch": hist([]float64{1, 2}, []uint64{1, 1}, 2),
		"not increasing":  hist([]float64{2, 1}, []uint64{1, 1, 1}, 3),
	} {
		clean, ok := validateDiagMetric(m)
		require.True(t, ok, name)
		require.Empty(t, clean.Points, name)
	}
}

func TestSeriesBudgetIsSharedDeterministically(t *testing.T) {
	reset(t)
	var targets []PluginDiagnosticsTarget
	for i := 0; i < 8; i++ {
		id := fmt.Sprintf("p%d", i)
		reply := counterReply(id, 1)
		reply.Metrics[0].Points = nil
		for j := 0; j < 16; j++ {
			reply.Metrics[0].Points = append(reply.Metrics[0].Points, &lifecyclepb.DiagPoint{Attrs: []*lifecyclepb.DiagAttr{{Key: lifecyclepb.DiagKey_DIAG_KEY_OPERATION, Value: fmt.Sprintf("op%d", j)}}, Value: 1})
		}
		targets = append(targets, PluginDiagnosticsTarget{PluginID: id, Generation: 1, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) { return reply, nil }})
	}
	pollPluginDiagnostics(context.Background(), targets)
	for i := 0; i < 8; i++ {
		settle(t, fmt.Sprintf("p%d", i))
	}
	for _, scope := range producePluginDiagnostics(time.Now()) {
		for _, m := range scope.Metrics {
			if sum, ok := m.Data.(metricdata.Sum[float64]); ok {
				require.LessOrEqual(t, len(sum.DataPoints), maxPluginSeriesPerMetric)
				require.Len(t, sum.DataPoints, 64)
			}
		}
	}
	require.Equal(t, DiagnosticsTruncated, statusOf(t, "p0"))
}

// The merged data must pass through the real collector: one metric per name
// across plugins (duplicate names are rejected as ambiguous), all allowlisted
// attributes preserved, and the sample marked complete.
func TestCollectorAcceptsPluginMetricsAndCapturesThem(t *testing.T) {
	reset(t)
	svc, err := diagnostics.New(diagnostics.Options{Directory: t.TempDir(), Interval: 10 * time.Millisecond})
	require.NoError(t, err)
	t.Cleanup(func() { _ = svc.Shutdown(context.Background()) })
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(sdkmetric.NewPeriodicReader(svc, sdkmetric.WithInterval(time.Hour), pluginDiagnosticsReaderOption())))
	t.Cleanup(func() { _ = mp.Shutdown(context.Background()) })
	pollPluginDiagnostics(context.Background(), []PluginDiagnosticsTarget{
		{PluginID: "aws", Generation: 1, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
			return counterReply("aws", 2, outcome("ok")), nil
		}},
		{PluginID: "kube", Generation: 1, Fetch: func(context.Context) (*lifecyclepb.GetDiagnosticsResponse, error) {
			return counterReply("kube", 3, outcome("error")), nil
		}},
	})
	settle(t, "aws")
	settle(t, "kube")
	require.NoError(t, mp.ForceFlush(context.Background()))
	snap := svc.GetSnapshot()
	require.True(t, snap.Health.Complete, snap.Health.LastError)
	found := 0
	for _, m := range snap.Metrics {
		if m.Name != "omniview.plugin.self.api.calls" {
			continue
		}
		require.Equal(t, "counter", m.Kind)
		require.Len(t, m.Points, 2)
		for _, p := range m.Points {
			require.NotEmpty(t, p.Attributes["plugin"])
			require.NotEmpty(t, p.Attributes["outcome"])
		}
		found++
	}
	require.Equal(t, 1, found)
}
