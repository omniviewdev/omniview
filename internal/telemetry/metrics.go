package telemetry

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// Metrics holds all registered application metrics.
type Metrics struct {
	PluginLoadDuration metric.Float64Histogram
	PluginActive       metric.Int64UpDownCounter
	PluginCrashes      metric.Int64Counter
	PluginQuarantines  metric.Int64Counter

	ResourceOpDuration  metric.Float64Histogram
	ResourceOpErrors    metric.Int64Counter
	ResourceWatchActive metric.Int64UpDownCounter

	WailsCallDuration        metric.Float64Histogram
	OperationCalls           metric.Int64Counter
	OperationActive          metric.Int64UpDownCounter
	ResourceRecords          metric.Int64Counter
	PipelineEvents           metric.Int64Counter
	PipelineQueueDuration    metric.Float64Histogram
	PipelineProviderDuration metric.Float64Histogram
	PipelineWork             metric.Int64Counter
	PipelineResponseBytes    metric.Int64Histogram
	WailsCalls               metric.Int64Counter
}

// NewMetrics registers all application metrics with the given MeterProvider.
func NewMetrics(mp metric.MeterProvider) (*Metrics, error) {
	meter := mp.Meter("omniview")
	var m Metrics
	var err error

	if m.PluginLoadDuration, err = meter.Float64Histogram("omniview.plugin.load_duration",
		metric.WithUnit("ms"),
		metric.WithDescription("Plugin load latency"),
	); err != nil {
		return nil, err
	}
	if m.PluginActive, err = meter.Int64UpDownCounter("omniview.plugin.active",
		metric.WithDescription("Currently loaded plugins"),
	); err != nil {
		return nil, err
	}
	if m.PluginCrashes, err = meter.Int64Counter("omniview.plugin.crashes",
		metric.WithDescription("Plugin crash count"),
	); err != nil {
		return nil, err
	}
	if m.PluginQuarantines, err = meter.Int64Counter("omniview.plugin.quarantines",
		metric.WithDescription("Plugin quarantine events"),
	); err != nil {
		return nil, err
	}
	if m.ResourceOpDuration, err = meter.Float64Histogram("omniview.resource.op_duration",
		metric.WithUnit("ms"),
		metric.WithDescription("Resource operation latency"),
	); err != nil {
		return nil, err
	}
	if m.ResourceOpErrors, err = meter.Int64Counter("omniview.resource.op_errors",
		metric.WithDescription("Failed resource operations"),
	); err != nil {
		return nil, err
	}
	if m.ResourceWatchActive, err = meter.Int64UpDownCounter("omniview.resource.watches_active",
		metric.WithDescription("Active watch streams"),
	); err != nil {
		return nil, err
	}
	if m.WailsCallDuration, err = meter.Float64Histogram("omniview.wails.call_duration",
		metric.WithUnit("ms"),
		metric.WithDescription("Wails binding call latency"),
	); err != nil {
		return nil, err
	}
	if m.WailsCalls, err = meter.Int64Counter("omniview.wails.calls",
		metric.WithDescription("Wails binding call count"),
	); err != nil {
		return nil, err
	}
	if err = registerMeasurements(meter, &m); err != nil {
		return nil, err
	}
	// Fresh sessions must distinguish zero cancellations from missing coverage.
	for _, event := range [...]string{"cancel_interest", "cancel_provider"} {
		m.PipelineEvents.Add(context.Background(), 0, metric.WithAttributes(attribute.String("event", event)))
	}
	activeMetrics.Store(&m)

	return &m, nil
}
