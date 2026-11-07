package telemetry

import (
	"context"
	"errors"
	"regexp"
	"runtime"
	runtimemetrics "runtime/metrics"
	"sync"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var activeMetrics atomic.Pointer[Metrics]

type pluginContextKey struct{}

// WithPlugin attaches the host-assigned plugin ID to measurements recorded with ctx.
// IDs come from installed manifests, never from plugin-supplied data.
func WithPlugin(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, pluginContextKey{}, id)
}

var pluginIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// pluginAttributes returns the bounded plugin label, or none when ctx carries no plugin.
func pluginAttributes(ctx context.Context) []attribute.KeyValue {
	id, _ := ctx.Value(pluginContextKey{}).(string)
	if id == "" {
		return nil
	}
	if !pluginIDPattern.MatchString(id) {
		id = "other"
	}
	return []attribute.KeyValue{attribute.String("plugin", id)}
}

// Operation measures one host operation. End must be deferred immediately.
// Attribute values are normalized here, never copied from caller identities.
type Operation struct {
	metrics   *Metrics
	ctx       context.Context
	domain    string
	operation string
	plugin    []attribute.KeyValue
	started   time.Time
}

func safeOperation(domain, operation string) (string, string) {
	switch domain {
	case "resource":
		switch operation {
		case "get", "enumerate", "query", "mutate":
			return domain, operation
		}
	case "plugin":
		switch operation {
		case "load", "unload":
			return domain, operation
		}
	case "wails":
		// Only real binding middleware may use this domain. Binding names are omitted.
		return domain, "call"
	}
	return "other", "other"
}

func BeginOperation(ctx context.Context, domain, operation string) Operation {
	m := activeMetrics.Load()
	if m == nil {
		return Operation{}
	}
	domain, operation = safeOperation(domain, operation)
	plugin := pluginAttributes(ctx)
	attrs := metric.WithAttributes(append([]attribute.KeyValue{attribute.String("domain", domain), attribute.String("operation", operation)}, plugin...)...)
	m.OperationActive.Add(ctx, 1, attrs)
	return Operation{metrics: m, ctx: ctx, domain: domain, operation: operation, plugin: plugin, started: time.Now()}
}

func (o Operation) End(err error) {
	if o.metrics == nil {
		return
	}
	base := append([]attribute.KeyValue{attribute.String("domain", o.domain), attribute.String("operation", o.operation)}, o.plugin...)
	attrs := metric.WithAttributes(base...)
	o.metrics.OperationActive.Add(o.ctx, -1, attrs)
	outcome := "success"
	if err != nil {
		outcome = "error"
	}
	if errors.Is(err, context.Canceled) {
		outcome = "canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		outcome = "timeout"
	}
	result := metric.WithAttributes(append(append([]attribute.KeyValue{}, base...), attribute.String("outcome", outcome))...)
	o.metrics.OperationCalls.Add(o.ctx, 1, result)
	elapsed := float64(time.Since(o.started)) / float64(time.Millisecond)
	switch o.domain {
	case "resource":
		o.metrics.ResourceOpDuration.Record(o.ctx, elapsed, result)
		if err != nil {
			o.metrics.ResourceOpErrors.Add(o.ctx, 1, attrs)
		}
	case "plugin":
		if o.operation == "load" {
			o.metrics.PluginLoadDuration.Record(o.ctx, elapsed, result)
		}
	case "wails":
		o.metrics.WailsCalls.Add(o.ctx, 1, result)
		o.metrics.WailsCallDuration.Record(o.ctx, elapsed, result)
	}
}

func RecordResourceRecords(ctx context.Context, operation string, count int64) {
	if count < 0 {
		return
	}
	_, operation = safeOperation("resource", operation)
	if m := activeMetrics.Load(); m != nil {
		m.ResourceRecords.Add(ctx, count, metric.WithAttributes(append([]attribute.KeyValue{attribute.String("operation", operation)}, pluginAttributes(ctx)...)...))
	}
}
func RecordPluginActive(ctx context.Context, delta int64) {
	if m := activeMetrics.Load(); m != nil {
		m.PluginActive.Add(ctx, delta, metric.WithAttributes(pluginAttributes(ctx)...))
	}
}
func RecordPluginCrash(ctx context.Context) {
	if m := activeMetrics.Load(); m != nil {
		m.PluginCrashes.Add(ctx, 1, metric.WithAttributes(pluginAttributes(ctx)...))
	}
}
func RecordPluginQuarantine(ctx context.Context) {
	if m := activeMetrics.Load(); m != nil {
		m.PluginQuarantines.Add(ctx, 1, metric.WithAttributes(pluginAttributes(ctx)...))
	}
}

// PipelineState is sampled under the coordinator's own lock. Inflight includes
// retired providers until they return, not merely until cancellation is requested.
type PipelineState struct {
	Queued, Inflight, CatalogInflight, CatalogWaiters, CacheEntries, CacheBytes, Observations, SnapshotBytes int64
}

var pipelineSources = struct {
	sync.Mutex
	next    uint64
	sources map[uint64]func() PipelineState
}{sources: make(map[uint64]func() PipelineState)}

func RegisterPipelineState(source func() PipelineState) func() {
	pipelineSources.Lock()
	pipelineSources.next++
	id := pipelineSources.next
	pipelineSources.sources[id] = source
	pipelineSources.Unlock()
	return func() { pipelineSources.Lock(); delete(pipelineSources.sources, id); pipelineSources.Unlock() }
}

func RecordPipelineEvent(ctx context.Context, event string, count int64) {
	switch event {
	case "cache_hit_pairs", "cache_miss_pairs", "dispatch", "cancel_interest", "cancel_provider":
	default:
		return
	}
	if m := activeMetrics.Load(); m != nil {
		m.PipelineEvents.Add(ctx, count, metric.WithAttributes(attribute.String("event", event)))
	}
}
func RecordPipelineDispatch(ctx context.Context, queued time.Time, targets, pairs int) {
	if m := activeMetrics.Load(); m != nil {
		m.PipelineQueueDuration.Record(ctx, float64(time.Since(queued))/float64(time.Millisecond))
		m.PipelineWork.Add(ctx, int64(targets), metric.WithAttributes(attribute.String("work", "targets")))
		m.PipelineWork.Add(ctx, int64(pairs), metric.WithAttributes(attribute.String("work", "pairs")))
		m.PipelineEvents.Add(ctx, 1, metric.WithAttributes(attribute.String("event", "dispatch")))
	}
}
func RecordPipelineProvider(ctx context.Context, operation string, started time.Time, err error) {
	if operation != "query" && operation != "catalog" {
		return
	}
	if m := activeMetrics.Load(); m != nil {
		outcome := "success"
		if err != nil {
			outcome = "error"
		}
		if errors.Is(err, context.Canceled) {
			outcome = "canceled"
		}
		if errors.Is(err, context.DeadlineExceeded) {
			outcome = "timeout"
		}
		m.PipelineProviderDuration.Record(ctx, float64(time.Since(started))/float64(time.Millisecond), metric.WithAttributes(append([]attribute.KeyValue{attribute.String("operation", operation), attribute.String("outcome", outcome)}, pluginAttributes(ctx)...)...))
	}
}
func RecordPipelineResponse(ctx context.Context, bytes, results int) {
	if m := activeMetrics.Load(); m != nil {
		m.PipelineResponseBytes.Record(ctx, int64(bytes))
		m.PipelineWork.Add(ctx, int64(results), metric.WithAttributes(attribute.String("work", "results")))
	}
}

func registerMeasurements(meter metric.Meter, m *Metrics) error {
	var err error
	if m.OperationCalls, err = meter.Int64Counter("omniview.operation.calls", metric.WithDescription("Completed host operations, including failed admission")); err != nil {
		return err
	}
	if m.OperationActive, err = meter.Int64UpDownCounter("omniview.operation.active", metric.WithDescription("Host operations currently executing")); err != nil {
		return err
	}
	if m.ResourceRecords, err = meter.Int64Counter("omniview.resource.records", metric.WithDescription("Records returned by successful host resource operations")); err != nil {
		return err
	}
	if m.PipelineEvents, err = meter.Int64Counter("omniview.metric.pipeline.events", metric.WithDescription("Finite metrics coordinator cache, dispatch and cancellation events")); err != nil {
		return err
	}
	if m.PipelineQueueDuration, err = meter.Float64Histogram("omniview.metric.pipeline.queue_duration", metric.WithUnit("ms"), metric.WithDescription("Age of oldest sample interest at provider job dispatch")); err != nil {
		return err
	}
	if m.PipelineProviderDuration, err = meter.Float64Histogram("omniview.metric.pipeline.provider_duration", metric.WithUnit("ms"), metric.WithDescription("Actual finite QueryResources or GetResourceMetricsCatalog provider call duration, excluding admission and projection")); err != nil {
		return err
	}
	if m.PipelineWork, err = meter.Int64Counter("omniview.metric.pipeline.work", metric.WithDescription("Dispatched target and target-metric pair counts; validated response result counts")); err != nil {
		return err
	}
	if m.PipelineResponseBytes, err = meter.Int64Histogram("omniview.metric.pipeline.response_bytes", metric.WithUnit("By"), metric.WithDescription("JSON bytes of validated bounded provider responses before caller projection")); err != nil {
		return err
	}
	state, err := meter.Int64ObservableGauge("omniview.metric.pipeline.state", metric.WithUnit("{item}"), metric.WithDescription("Sampled coordinator counts; queued means interests with uncovered work; inflight includes retired jobs until provider return"))
	if err != nil {
		return err
	}
	stateBytes, err := meter.Int64ObservableGauge("omniview.metric.pipeline.state_bytes", metric.WithUnit("By"), metric.WithDescription("Retained finite sample cache and displayed observation snapshot bytes"))
	if err != nil {
		return err
	}
	goroutines, err := meter.Int64ObservableGauge("omniview.process.goroutines", metric.WithDescription("Current Go goroutines"))
	if err != nil {
		return err
	}
	heap, err := meter.Int64ObservableGauge("omniview.process.go_heap_bytes", metric.WithUnit("By"), metric.WithDescription("Live Go heap allocation; not process resident memory"))
	if err != nil {
		return err
	}
	cpu, err := meter.Float64ObservableCounter("omniview.process.cpu_time", metric.WithUnit("s"), metric.WithDescription("OS process cumulative CPU time by user/system state; derive utilization from elapsed CPU seconds"))
	if err != nil {
		return err
	}
	peak, err := meter.Int64ObservableGauge("omniview.process.memory_peak_rss", metric.WithUnit("By"), metric.WithDescription("OS process peak resident memory, not current RSS"))
	if err != nil {
		return err
	}
	pluginCPU, err := meter.Float64ObservableCounter("omniview.plugin.process.cpu_time", metric.WithUnit("s"), metric.WithDescription("Cumulative CPU seconds of a plugin's verified child process"))
	if err != nil {
		return err
	}
	pluginRSS, err := meter.Int64ObservableGauge("omniview.plugin.process.memory_rss", metric.WithUnit("By"), metric.WithDescription("Current resident memory of a plugin's verified child process"))
	if err != nil {
		return err
	}
	_, err = meter.RegisterCallback(func(ctx context.Context, o metric.Observer) error {
		observePluginUsage(ctx, o, pluginCPU, pluginRSS)
		var total PipelineState
		pipelineSources.Lock()
		for _, source := range pipelineSources.sources {
			s := source()
			total.Queued += s.Queued
			total.Inflight += s.Inflight
			total.CatalogInflight += s.CatalogInflight
			total.CatalogWaiters += s.CatalogWaiters
			total.CacheEntries += s.CacheEntries
			total.CacheBytes += s.CacheBytes
			total.Observations += s.Observations
			total.SnapshotBytes += s.SnapshotBytes
		}
		pipelineSources.Unlock()
		for _, point := range []struct {
			name  string
			value int64
		}{
			{"queued", total.Queued}, {"inflight", total.Inflight}, {"catalog_inflight", total.CatalogInflight}, {"catalog_waiters", total.CatalogWaiters},
			{"cache_entries", total.CacheEntries}, {"observations", total.Observations},
		} {
			o.ObserveInt64(state, point.value, metric.WithAttributes(attribute.String("state", point.name)))
		}
		o.ObserveInt64(goroutines, int64(runtime.NumGoroutine()))
		o.ObserveInt64(stateBytes, total.CacheBytes, metric.WithAttributes(attribute.String("state", "cache")))
		o.ObserveInt64(stateBytes, total.SnapshotBytes, metric.WithAttributes(attribute.String("state", "snapshots")))
		memory := [1]runtimemetrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
		runtimemetrics.Read(memory[:])
		if memory[0].Value.Kind() == runtimemetrics.KindUint64 {
			o.ObserveInt64(heap, int64(memory[0].Value.Uint64()))
		}
		if user, system, rss, ok := processUsage(); ok {
			o.ObserveFloat64(cpu, user, metric.WithAttributes(attribute.String("state", "user")))
			o.ObserveFloat64(cpu, system, metric.WithAttributes(attribute.String("state", "system")))
			o.ObserveInt64(peak, rss)
		}
		return nil
	}, state, stateBytes, goroutines, heap, cpu, peak, pluginCPU, pluginRSS)
	return err
}
