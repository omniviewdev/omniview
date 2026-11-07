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

func TestPluginUsageIsCachedBoundedAndOmitsUnreadable(t *testing.T) {
	reads := 0
	pluginProcesses.Lock()
	pluginProcesses.latest = nil
	pluginProcesses.read = func(pids []int) map[int]pluginUsage {
		reads++
		return map[int]pluginUsage{10: {cpuSeconds: 2, rssBytes: 4096}}
	}
	pluginProcesses.Unlock()
	t.Cleanup(func() {
		pluginProcesses.Lock()
		pluginProcesses.source, pluginProcesses.read, pluginProcesses.latest = nil, readProcessUsage, nil
		pluginProcesses.Unlock()
	})
	RegisterPluginProcessSource(func() []PluginProcess {
		return []PluginProcess{{PluginID: "kubernetes", PID: 10}, {PluginID: "gone", PID: 11}, {PluginID: "bad id!", PID: 10}}
	})
	now := time.Now()
	usage := samplePluginUsage(now)
	require.Equal(t, map[string]pluginUsage{"kubernetes": {cpuSeconds: 2, rssBytes: 4096}}, usage)
	require.NotContains(t, usage, "gone", "unreadable process must be absent, not zero")
	samplePluginUsage(now.Add(time.Second))
	require.Equal(t, 1, reads, "reads inside the refresh window must reuse the cache")
	samplePluginUsage(now.Add(pluginProcessRefresh + time.Second))
	require.Equal(t, 2, reads)
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
