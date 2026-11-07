package telemetry

import (
	"context"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// PluginProcess is one verified child process owned by a plugin.
type PluginProcess struct {
	PluginID string
	PID      int
}

// pluginUsage is cumulative CPU seconds and current resident bytes.
type pluginUsage struct {
	cpuSeconds float64
	rssBytes   int64
}

const (
	pluginProcessMaxPlugins = 32
	pluginProcessRefresh    = 1900 * time.Millisecond
)

var pluginProcesses = struct {
	sync.Mutex
	source  func() []PluginProcess
	read    func([]int) map[int]pluginUsage
	at      time.Time
	latest  map[string]pluginUsage
	lastRun time.Time
}{read: readProcessUsage}

// RegisterPluginProcessSource supplies verified plugin PIDs. Usage is sampled at
// most once per collection interval and only for IDs that look like installed plugin IDs.
func RegisterPluginProcessSource(source func() []PluginProcess) {
	pluginProcesses.Lock()
	pluginProcesses.source = source
	pluginProcesses.Unlock()
}

// samplePluginUsage returns cached usage keyed by plugin ID. Plugins whose
// processes cannot be read are absent, never zero.
func samplePluginUsage(now time.Time) map[string]pluginUsage {
	pluginProcesses.Lock()
	defer pluginProcesses.Unlock()
	if pluginProcesses.source == nil {
		return nil
	}
	if pluginProcesses.latest != nil && now.Sub(pluginProcesses.at) < pluginProcessRefresh {
		return pluginProcesses.latest
	}
	procs := pluginProcesses.source()
	sort.Slice(procs, func(i, j int) bool { return procs[i].PluginID < procs[j].PluginID })
	if len(procs) > pluginProcessMaxPlugins {
		procs = procs[:pluginProcessMaxPlugins]
	}
	pids := make([]int, 0, len(procs))
	for _, p := range procs {
		if p.PID > 0 && pluginIDPattern.MatchString(p.PluginID) {
			pids = append(pids, p.PID)
		}
	}
	usage := pluginProcesses.read(pids)
	latest := make(map[string]pluginUsage, len(procs))
	for _, p := range procs {
		if u, ok := usage[p.PID]; ok && pluginIDPattern.MatchString(p.PluginID) {
			total := latest[p.PluginID]
			total.cpuSeconds += u.cpuSeconds
			total.rssBytes += u.rssBytes
			latest[p.PluginID] = total
		}
	}
	pluginProcesses.latest, pluginProcesses.at = latest, now
	return latest
}

func observePluginUsage(ctx context.Context, o metric.Observer, cpu metric.Float64ObservableCounter, rss metric.Int64ObservableGauge) {
	for id, u := range samplePluginUsage(time.Now()) {
		attrs := metric.WithAttributes(attribute.String("plugin", id))
		o.ObserveFloat64(cpu, u.cpuSeconds, attrs)
		o.ObserveInt64(rss, u.rssBytes, attrs)
	}
}

var cpuTimePattern = regexp.MustCompile(`^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$`)

// parseCPUTime parses ps cputime: [[dd-]hh:]mm:ss[.ff].
func parseCPUTime(value string) (float64, bool) {
	m := cpuTimePattern.FindStringSubmatch(strings.TrimSpace(value))
	if m == nil {
		return 0, false
	}
	num := func(s string) float64 {
		v, _ := strconv.ParseFloat(s, 64)
		return v
	}
	return num(m[1])*86400 + num(m[2])*3600 + num(m[3])*60 + num(m[4]), true
}
