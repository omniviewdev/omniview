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
	source func() []PluginProcess
	read   func([]int) map[int]pluginUsage
	latest map[string]pluginUsage
	stop   context.CancelFunc
}{read: readProcessUsage}

// RegisterPluginProcessSource supplies verified plugin PIDs and starts a background
// sampler. Sampling never runs inside the metric collection callback: the callback
// only reads the latest cached result, so a slow process listing or a lock held by
// the plugin manager cannot stall collection.
func RegisterPluginProcessSource(source func() []PluginProcess) {
	pluginProcesses.Lock()
	defer pluginProcesses.Unlock()
	if pluginProcesses.stop != nil {
		pluginProcesses.stop()
		pluginProcesses.stop = nil
	}
	pluginProcesses.source, pluginProcesses.latest = source, nil
	if source == nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	pluginProcesses.stop = cancel
	go func() {
		ticker := time.NewTicker(pluginProcessRefresh)
		defer ticker.Stop()
		for {
			refreshPluginUsage(source)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// StopPluginProcessSampling ends background sampling (telemetry shutdown).
func StopPluginProcessSampling() { RegisterPluginProcessSource(nil) }

// refreshPluginUsage samples once. Plugins whose processes cannot be read are
// absent from the result, never zero.
func refreshPluginUsage(source func() []PluginProcess) {
	procs := source()
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
	pluginProcesses.Lock()
	read := pluginProcesses.read
	pluginProcesses.Unlock()
	usage := read(pids)
	latest := make(map[string]pluginUsage, len(procs))
	for _, p := range procs {
		if u, ok := usage[p.PID]; ok && pluginIDPattern.MatchString(p.PluginID) {
			total := latest[p.PluginID]
			total.cpuSeconds += u.cpuSeconds
			total.rssBytes += u.rssBytes
			latest[p.PluginID] = total
		}
	}
	pluginProcesses.Lock()
	if pluginProcesses.source != nil {
		pluginProcesses.latest = latest
	}
	pluginProcesses.Unlock()
}

func cachedPluginUsage() map[string]pluginUsage {
	pluginProcesses.Lock()
	defer pluginProcesses.Unlock()
	return pluginProcesses.latest
}

func observePluginUsage(ctx context.Context, o metric.Observer, cpu metric.Float64ObservableCounter, rss metric.Int64ObservableGauge) {
	for id, u := range cachedPluginUsage() {
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
