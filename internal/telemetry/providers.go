package telemetry

import (
	"context"
	"slices"

	"go.opentelemetry.io/otel/attribute"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// NewTracerProvider creates a TracerProvider with a batching span exporter.
func NewTracerProvider(res *resource.Resource, exp sdktrace.SpanExporter) *sdktrace.TracerProvider {
	return sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(exp),
	)
}

// NewMeterProvider creates a MeterProvider with a periodic reader wrapping the given exporter.
func NewMeterProvider(res *resource.Resource, exp sdkmetric.Exporter) *sdkmetric.MeterProvider {
	return sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithCardinalityLimit(metricCardinalityLimit),
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exp)),
	)
}

// NewLoggerProvider creates a LoggerProvider with a batching log processor.
func NewLoggerProvider(res *resource.Resource, exp sdklog.Exporter) *sdklog.LoggerProvider {
	return sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exp)),
	)
}

// clientIDMetricExporter adds the installation label only on the remote path.
// The diagnostics collector can retain the original, unmodified measurements.
type clientIDMetricExporter struct {
	sdkmetric.Exporter
	id string
}

func withClientIDMetrics(exp sdkmetric.Exporter, id string) sdkmetric.Exporter {
	if id == "" {
		return exp
	}
	return &clientIDMetricExporter{Exporter: exp, id: id}
}

func clientIDAttributes(set attribute.Set, id string) attribute.Set {
	attrs := set.ToSlice()
	attrs = append(attrs, attribute.String("omniview_client_id", id))
	return attribute.NewSet(attrs...)
}

func labelPoints[N int64 | float64](points []metricdata.DataPoint[N], id string) []metricdata.DataPoint[N] {
	points = slices.Clone(points)
	for i := range points {
		points[i].Attributes = clientIDAttributes(points[i].Attributes, id)
	}
	return points
}

func labelHistograms[N int64 | float64](
	points []metricdata.HistogramDataPoint[N], id string,
) []metricdata.HistogramDataPoint[N] {
	points = slices.Clone(points)
	for i := range points {
		points[i].Attributes = clientIDAttributes(points[i].Attributes, id)
	}
	return points
}

func labelExponentialHistograms[N int64 | float64](
	points []metricdata.ExponentialHistogramDataPoint[N], id string,
) []metricdata.ExponentialHistogramDataPoint[N] {
	points = slices.Clone(points)
	for i := range points {
		points[i].Attributes = clientIDAttributes(points[i].Attributes, id)
	}
	return points
}

func (e *clientIDMetricExporter) Export(ctx context.Context, original *metricdata.ResourceMetrics) error {
	rm := *original
	rm.ScopeMetrics = slices.Clone(original.ScopeMetrics)
	for i := range rm.ScopeMetrics {
		scope := &rm.ScopeMetrics[i]
		scope.Metrics = slices.Clone(scope.Metrics)
		for j := range scope.Metrics {
			metric := &scope.Metrics[j]
			switch data := metric.Data.(type) {
			case metricdata.Gauge[int64]:
				data.DataPoints = labelPoints(data.DataPoints, e.id)
				metric.Data = data
			case metricdata.Gauge[float64]:
				data.DataPoints = labelPoints(data.DataPoints, e.id)
				metric.Data = data
			case metricdata.Sum[int64]:
				data.DataPoints = labelPoints(data.DataPoints, e.id)
				metric.Data = data
			case metricdata.Sum[float64]:
				data.DataPoints = labelPoints(data.DataPoints, e.id)
				metric.Data = data
			case metricdata.Histogram[int64]:
				data.DataPoints = labelHistograms(data.DataPoints, e.id)
				metric.Data = data
			case metricdata.Histogram[float64]:
				data.DataPoints = labelHistograms(data.DataPoints, e.id)
				metric.Data = data
			case metricdata.ExponentialHistogram[int64]:
				data.DataPoints = labelExponentialHistograms(data.DataPoints, e.id)
				metric.Data = data
			case metricdata.ExponentialHistogram[float64]:
				data.DataPoints = labelExponentialHistograms(data.DataPoints, e.id)
				metric.Data = data
			case metricdata.Summary:
				data.DataPoints = slices.Clone(data.DataPoints)
				for k := range data.DataPoints {
					data.DataPoints[k].Attributes = clientIDAttributes(data.DataPoints[k].Attributes, e.id)
				}
				metric.Data = data
			}
		}
	}
	return e.Exporter.Export(ctx, &rm)
}
