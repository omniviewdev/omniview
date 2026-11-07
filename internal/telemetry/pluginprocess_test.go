package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestParseCPUTime(t *testing.T) {
	for in, want := range map[string]float64{"0:01.50": 1.5, "01:02:03": 3723, "2-00:00:10": 172810, "12:34.56": 754.56} {
		got, ok := parseCPUTime(in)
		require.True(t, ok, in)
		require.InDelta(t, want, got, 1e-9, in)
	}
	for _, bad := range []string{"", "abc", "1:2:3:4", "-1:00"} {
		_, ok := parseCPUTime(bad)
		require.False(t, ok, bad)
	}
}

func TestPluginUsageSamplesOffTheCollectionPathAndOmitsUnreadable(t *testing.T) {
	pluginProcesses.Lock()
	pluginProcesses.read = func([]int) map[int]pluginUsage {
		return map[int]pluginUsage{10: {cpuSeconds: 2, rssBytes: 4096}}
	}
	pluginProcesses.Unlock()
	t.Cleanup(func() {
		StopPluginProcessSampling()
		pluginProcesses.Lock()
		pluginProcesses.read = readProcessUsage
		pluginProcesses.Unlock()
	})
	blocked := make(chan struct{})
	t.Cleanup(func() { close(blocked) })
	RegisterPluginProcessSource(func() []PluginProcess {
		return []PluginProcess{{PluginID: "kubernetes", PID: 10}, {PluginID: "gone", PID: 11}, {PluginID: "bad id!", PID: 10}}
	})
	require.Eventually(t, func() bool { return len(cachedPluginUsage()) > 0 }, 2*time.Second, 10*time.Millisecond)
	usage := cachedPluginUsage()
	require.Equal(t, map[string]pluginUsage{"kubernetes": {cpuSeconds: 2, rssBytes: 4096}}, usage)
	require.NotContains(t, usage, "gone", "unreadable process must be absent, not zero")

	// A source that never returns must not block readers of the cached result.
	RegisterPluginProcessSource(func() []PluginProcess { <-blocked; return nil })
	done := make(chan struct{})
	go func() { cachedPluginUsage(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cached read blocked behind a stalled process source")
	}
}

func TestPluginLabelIsHostValidatedAndOptional(t *testing.T) {
	reader := measurementReader(t)
	ok := WithPlugin(context.Background(), "kubernetes")
	bad := WithPlugin(context.Background(), "has spaces; drop table")
	BeginOperation(ok, "resource", "get").End(nil)
	BeginOperation(bad, "resource", "get").End(nil)
	BeginOperation(context.Background(), "resource", "get").End(nil)
	data := measurementCollect(t, reader)["omniview.operation.calls"].Data.(metricdata.Sum[int64])
	plugins := map[string]int64{}
	for _, p := range data.DataPoints {
		id, _ := p.Attributes.Value("plugin")
		plugins[id.AsString()] += p.Value
	}
	require.Equal(t, map[string]int64{"kubernetes": 1, "other": 1, "": 1}, plugins)
}
