package telemetry

import (
	"context"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/diagnostics"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// Plugin diagnostics pull in-plugin measurements over the lifecycle RPC and
// surface them through a reader-level producer, so the existing collector's
// limits, captures, comparison, /metrics and OTLP forwarding apply unchanged.
//
// Identity is host-owned: every point is labelled with the plugin ID of the
// host's own record, never a value from the reply. Sampling runs in its own
// goroutine; the producer only reads the cache.

const (
	pluginDiagnosticsInterval = 2 * time.Second
	pluginDiagnosticsTimeout  = 500 * time.Millisecond
	// pluginDiagnosticsStale is three polling intervals.
	pluginDiagnosticsStale = 3 * pluginDiagnosticsInterval

	maxPluginDiagnosticsBytes = 64 << 10
	// Host-wide budgets. The collector rejects a whole sample over 256 KiB and a
	// metric over 64 series, so plugin data gets a fixed share of both.
	maxPluginDiagnosticsPlugins = 32
	maxPluginDiagnosticsNames   = 32
	maxPluginSeriesPerMetric    = 64
	pluginDiagnosticsByteBudget = 96 << 10

	// PluginDiagnosticsStatusMetric is the host-owned availability gauge.
	PluginDiagnosticsStatusMetric = "omniview.plugin.diagnostics.status"
	pluginDiagnosticsScope        = "omniview/plugin-diagnostics"
)

// Availability states reported by PluginDiagnosticsStatusMetric. A plugin that
// is not "ok" or "truncated" contributes no measurement points.
const (
	DiagnosticsOK          = "ok"
	DiagnosticsTruncated   = "truncated"
	DiagnosticsUnsupported = "unsupported"
	DiagnosticsError       = "error"
	DiagnosticsInvalid     = "invalid"
	DiagnosticsStale       = "stale"
)

// PluginDiagnosticsTarget is one running plugin backend. Generation is a
// comparable token that changes whenever the backend is replaced; a
// capability probe result is only reused for the same generation.
type PluginDiagnosticsTarget struct {
	PluginID   string
	Generation any
	Fetch      func(ctx context.Context) (*lifecyclepb.GetDiagnosticsResponse, error)
}

type pluginDiagnosticsEntry struct {
	generation any
	state      string
	inFlight   bool
	at         time.Time
	reply      *validatedDiagnostics
}

type validatedDiagnostics struct {
	startNano int64
	metrics   []*lifecyclepb.DiagMetric
	truncated bool
}

var pluginDiagnostics = struct {
	sync.Mutex
	entries map[string]*pluginDiagnosticsEntry
	stop    context.CancelFunc
	now     func() time.Time
}{entries: map[string]*pluginDiagnosticsEntry{}, now: time.Now}

// RegisterPluginDiagnosticsSource supplies running backends and starts the
// polling goroutine. Passing nil stops polling and drops every cached reply.
func RegisterPluginDiagnosticsSource(source func() []PluginDiagnosticsTarget) {
	pluginDiagnostics.Lock()
	if pluginDiagnostics.stop != nil {
		pluginDiagnostics.stop()
		pluginDiagnostics.stop = nil
	}
	pluginDiagnostics.entries = map[string]*pluginDiagnosticsEntry{}
	if source == nil {
		pluginDiagnostics.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	pluginDiagnostics.stop = cancel
	pluginDiagnostics.Unlock()
	go func() {
		ticker := time.NewTicker(pluginDiagnosticsInterval)
		defer ticker.Stop()
		for {
			pollPluginDiagnostics(ctx, source())
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// StopPluginDiagnostics ends polling (telemetry shutdown).
func StopPluginDiagnostics() { RegisterPluginDiagnosticsSource(nil) }

// pollPluginDiagnostics starts at most one call in flight per plugin and never
// waits for them: a slow plugin cannot delay others or the collector.
func pollPluginDiagnostics(ctx context.Context, targets []PluginDiagnosticsTarget) {
	sort.Slice(targets, func(i, j int) bool { return targets[i].PluginID < targets[j].PluginID })
	pluginDiagnostics.Lock()
	live := make(map[string]bool, len(targets))
	var launch []PluginDiagnosticsTarget
	for _, target := range targets {
		if len(live) >= maxPluginDiagnosticsPlugins {
			break
		}
		if !pluginIDPattern.MatchString(target.PluginID) || target.Fetch == nil {
			continue
		}
		live[target.PluginID] = true
		entry := pluginDiagnostics.entries[target.PluginID]
		if entry == nil || entry.generation != target.Generation {
			// New or replaced backend: the old reply and probe result are void.
			entry = &pluginDiagnosticsEntry{generation: target.Generation}
			pluginDiagnostics.entries[target.PluginID] = entry
		}
		if entry.inFlight || entry.state == DiagnosticsUnsupported {
			continue
		}
		entry.inFlight = true
		launch = append(launch, target)
	}
	for id := range pluginDiagnostics.entries {
		if !live[id] {
			delete(pluginDiagnostics.entries, id)
		}
	}
	pluginDiagnostics.Unlock()
	for _, target := range launch {
		go fetchPluginDiagnostics(ctx, target)
	}
}

func fetchPluginDiagnostics(ctx context.Context, target PluginDiagnosticsTarget) {
	callCtx, cancel := context.WithTimeout(ctx, pluginDiagnosticsTimeout)
	defer cancel()
	reply, err := target.Fetch(callCtx)
	state, valid := DiagnosticsError, (*validatedDiagnostics)(nil)
	switch {
	case err != nil && status.Code(err) == codes.Unimplemented:
		state = DiagnosticsUnsupported
	case err != nil:
	default:
		var ok bool
		if valid, ok = validatePluginDiagnostics(target.PluginID, reply); !ok {
			state, valid = DiagnosticsInvalid, nil
		} else if valid.truncated {
			state = DiagnosticsTruncated
		} else {
			state = DiagnosticsOK
		}
	}
	pluginDiagnostics.Lock()
	defer pluginDiagnostics.Unlock()
	entry := pluginDiagnostics.entries[target.PluginID]
	if entry == nil || entry.generation != target.Generation {
		return // backend replaced or removed while the call was in flight
	}
	entry.inFlight = false
	entry.state = state
	entry.reply = valid
	if valid != nil {
		entry.at = pluginDiagnostics.now()
	}
}

// validatePluginDiagnostics rejects the whole reply for a wrong schema, wrong
// plugin_id or oversize payload, and drops (never clamps) nonconforming
// metrics and points.
func validatePluginDiagnostics(pluginID string, reply *lifecyclepb.GetDiagnosticsResponse) (*validatedDiagnostics, bool) {
	if reply == nil || reply.GetSchemaVersion() != diagnostics.SchemaVersion || reply.GetPluginId() != pluginID ||
		reply.GetProcessStartUnixNs() <= 0 || proto.Size(reply) > maxPluginDiagnosticsBytes {
		return nil, false
	}
	out := &validatedDiagnostics{startNano: reply.GetProcessStartUnixNs(), truncated: reply.GetTruncated()}
	seen := map[string]bool{}
	for _, metric := range reply.GetMetrics() {
		if len(out.metrics) >= diagnostics.MaxMetrics {
			out.truncated = true
			break
		}
		clean, ok := validateDiagMetric(metric)
		if !ok || seen[metric.GetName()] {
			out.truncated = true
			continue
		}
		seen[metric.GetName()] = true
		if len(clean.Points) < len(metric.GetPoints()) {
			out.truncated = true
		}
		if len(clean.Points) > 0 {
			out.metrics = append(out.metrics, clean)
		}
	}
	return out, true
}

func validateDiagMetric(metric *lifecyclepb.DiagMetric) (*lifecyclepb.DiagMetric, bool) {
	kind := metric.GetKind()
	if !diagnostics.ValidName(metric.GetName()) || !diagnostics.ValidUnit(metric.GetUnit()) ||
		kind < lifecyclepb.DiagKind_DIAG_KIND_COUNTER || kind > lifecyclepb.DiagKind_DIAG_KIND_HISTOGRAM {
		return nil, false
	}
	clean := &lifecyclepb.DiagMetric{Name: metric.GetName(), Unit: metric.GetUnit(), Kind: kind}
	seen := map[string]bool{}
	for _, point := range metric.GetPoints() {
		if len(clean.Points) >= diagnostics.MaxPoints {
			break
		}
		id, ok := validateDiagPoint(kind, point)
		if !ok || seen[id] {
			continue
		}
		seen[id] = true
		clean.Points = append(clean.Points, point)
	}
	return clean, true
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func validateDiagPoint(kind lifecyclepb.DiagKind, point *lifecyclepb.DiagPoint) (string, bool) {
	if point == nil || len(point.GetAttrs()) > diagnostics.MaxAttrs {
		return "", false
	}
	keys := map[lifecyclepb.DiagKey]bool{}
	attrs := append([]*lifecyclepb.DiagAttr(nil), point.GetAttrs()...)
	sort.Slice(attrs, func(i, j int) bool { return attrs[i].GetKey() < attrs[j].GetKey() })
	id := ""
	for _, attr := range attrs {
		if !diagnostics.ValidKey(attr.GetKey()) || !diagnostics.ValidValue(attr.GetValue()) || keys[attr.GetKey()] {
			return "", false
		}
		keys[attr.GetKey()] = true
		id += attr.GetKey().String() + "=" + attr.GetValue() + ";"
	}
	switch kind {
	case lifecyclepb.DiagKind_DIAG_KIND_COUNTER:
		return id, finite(point.GetValue()) && point.GetValue() >= 0
	case lifecyclepb.DiagKind_DIAG_KIND_GAUGE:
		return id, finite(point.GetValue())
	}
	bounds, buckets := point.GetBounds(), point.GetBucketCounts()
	if len(bounds) == 0 || len(bounds) > diagnostics.MaxBounds || len(buckets) != len(bounds)+1 || !finite(point.GetSum()) {
		return "", false
	}
	var total uint64
	for i, bound := range bounds {
		if !finite(bound) || (i > 0 && bound <= bounds[i-1]) {
			return "", false
		}
	}
	for _, count := range buckets {
		if math.MaxUint64-total < count {
			return "", false
		}
		total += count
	}
	return id, total == point.GetCount()
}

// pluginDiagnosticsProducer converts cached replies to OpenTelemetry data. It
// never performs I/O.
type pluginDiagnosticsProducer struct{}

// pluginDiagnosticsReaderOption attaches the producer to the existing periodic reader.
func pluginDiagnosticsReaderOption() sdkmetric.PeriodicReaderOption {
	return sdkmetric.WithProducer(pluginDiagnosticsProducer{})
}

func (pluginDiagnosticsProducer) Produce(context.Context) ([]metricdata.ScopeMetrics, error) {
	return producePluginDiagnostics(time.Now()), nil
}

type cachedDiagnostics struct {
	id    string
	state string
	reply *validatedDiagnostics
}

func producePluginDiagnostics(now time.Time) []metricdata.ScopeMetrics {
	pluginDiagnostics.Lock()
	cached := make([]cachedDiagnostics, 0, len(pluginDiagnostics.entries))
	for id, entry := range pluginDiagnostics.entries {
		state := entry.state
		if state == "" {
			continue // first poll not finished: neither available nor failed yet
		}
		reply := entry.reply
		if reply != nil && now.Sub(entry.at) > pluginDiagnosticsStale {
			state, reply = DiagnosticsStale, nil
		}
		cached = append(cached, cachedDiagnostics{id: id, state: state, reply: reply})
	}
	pluginDiagnostics.Unlock()
	if len(cached) == 0 {
		return nil
	}
	sort.Slice(cached, func(i, j int) bool { return cached[i].id < cached[j].id })

	reporting := 0
	for _, c := range cached {
		if c.reply != nil {
			reporting++
		}
	}
	perPlugin := diagnostics.MaxPoints
	if reporting > 0 && maxPluginSeriesPerMetric/reporting < perPlugin {
		perPlugin = max(1, maxPluginSeriesPerMetric/reporting)
	}

	type merged struct {
		unit, kind string
		sum        *metricdata.Sum[float64]
		gauge      *metricdata.Gauge[float64]
		hist       *metricdata.Histogram[float64]
	}
	byName := map[string]*merged{}
	var names []string
	budget := pluginDiagnosticsByteBudget
	status := make([]metricdata.DataPoint[float64], 0, len(cached))
	for _, c := range cached {
		state := c.state
		if c.reply != nil {
			dropped := c.reply.truncated
			start := time.Unix(0, c.reply.startNano)
			for _, metric := range c.reply.metrics {
				m := byName[metric.GetName()]
				if m == nil {
					if len(names) >= maxPluginDiagnosticsNames {
						dropped = true
						continue
					}
					m = &merged{unit: metric.GetUnit(), kind: metric.GetKind().String()}
					switch metric.GetKind() {
					case lifecyclepb.DiagKind_DIAG_KIND_COUNTER:
						m.sum = &metricdata.Sum[float64]{Temporality: metricdata.CumulativeTemporality, IsMonotonic: true}
					case lifecyclepb.DiagKind_DIAG_KIND_GAUGE:
						m.gauge = &metricdata.Gauge[float64]{}
					default:
						m.hist = &metricdata.Histogram[float64]{Temporality: metricdata.CumulativeTemporality}
					}
					byName[metric.GetName()] = m
					names = append(names, metric.GetName())
				} else if m.kind != metric.GetKind().String() || m.unit != metric.GetUnit() {
					dropped = true // plugins disagree about this name: first by ID wins
					continue
				}
				for i, point := range metric.GetPoints() {
					cost := 96 + 48*len(point.GetAttrs()) + 16*len(point.GetBucketCounts())
					if i >= perPlugin || cost > budget {
						dropped = true
						continue
					}
					budget -= cost
					kvs := make([]attribute.KeyValue, 0, len(point.GetAttrs())+1)
					kvs = append(kvs, attribute.String("plugin", c.id))
					for _, attr := range point.GetAttrs() {
						kvs = append(kvs, attribute.String(diagAttrName(attr.GetKey()), attr.GetValue()))
					}
					set := attribute.NewSet(kvs...)
					switch {
					case m.sum != nil:
						m.sum.DataPoints = append(m.sum.DataPoints, metricdata.DataPoint[float64]{Attributes: set, StartTime: start, Time: now, Value: point.GetValue()})
					case m.gauge != nil:
						m.gauge.DataPoints = append(m.gauge.DataPoints, metricdata.DataPoint[float64]{Attributes: set, StartTime: start, Time: now, Value: point.GetValue()})
					default:
						m.hist.DataPoints = append(m.hist.DataPoints, metricdata.HistogramDataPoint[float64]{
							Attributes: set, StartTime: start, Time: now, Count: point.GetCount(), Sum: point.GetSum(),
							Bounds: append([]float64(nil), point.GetBounds()...), BucketCounts: append([]uint64(nil), point.GetBucketCounts()...),
						})
					}
				}
			}
			if dropped {
				state = DiagnosticsTruncated
			}
		}
		status = append(status, metricdata.DataPoint[float64]{
			Attributes: attribute.NewSet(attribute.String("plugin", c.id), attribute.String("state", state)),
			Time:       now, Value: 1,
		})
	}
	metrics := make([]metricdata.Metrics, 0, len(names)+1)
	metrics = append(metrics, metricdata.Metrics{
		Name: PluginDiagnosticsStatusMetric, Description: "Plugin diagnostics availability; absent measurements are unavailable, not zero.", Unit: "1",
		Data: metricdata.Gauge[float64]{DataPoints: status},
	})
	sort.Strings(names)
	for _, name := range names {
		m := byName[name]
		out := metricdata.Metrics{Name: name, Unit: m.unit}
		switch {
		case m.sum != nil && len(m.sum.DataPoints) > 0:
			out.Data = *m.sum
		case m.gauge != nil && len(m.gauge.DataPoints) > 0:
			out.Data = *m.gauge
		case m.hist != nil && len(m.hist.DataPoints) > 0:
			out.Data = *m.hist
		default:
			continue
		}
		metrics = append(metrics, out)
	}
	return []metricdata.ScopeMetrics{{Scope: instrumentation.Scope{Name: pluginDiagnosticsScope}, Metrics: metrics}}
}

func diagAttrName(key lifecyclepb.DiagKey) string {
	switch key {
	case diagnostics.KeyOperation:
		return "operation"
	case diagnostics.KeyOutcome:
		return "outcome"
	case diagnostics.KeyPhase:
		return "phase"
	case diagnostics.KeyState:
		return "state"
	case diagnostics.KeyReason:
		return "reason"
	case diagnostics.KeyCache:
		return "cache"
	case diagnostics.KeyQueue:
		return "queue"
	case diagnostics.KeyDirection:
		return "direction"
	default:
		return "event"
	}
}
