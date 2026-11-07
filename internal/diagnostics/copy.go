package diagnostics

import (
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func copyExemplars[N int64 | float64](points []metricdata.Exemplar[N]) []metricdata.Exemplar[N] {
	out := append([]metricdata.Exemplar[N]{}, points...)
	for i := range out {
		out[i].FilteredAttributes = append([]attribute.KeyValue{}, out[i].FilteredAttributes...)
		out[i].SpanID = append([]byte{}, out[i].SpanID...)
		out[i].TraceID = append([]byte{}, out[i].TraceID...)
	}
	return out
}
func copyPoints[N int64 | float64](points []metricdata.DataPoint[N]) []metricdata.DataPoint[N] {
	out := append([]metricdata.DataPoint[N]{}, points...)
	for i := range out {
		out[i].Exemplars = copyExemplars(out[i].Exemplars)
	}
	return out
}
func copyHistograms[N int64 | float64](points []metricdata.HistogramDataPoint[N]) []metricdata.HistogramDataPoint[N] {
	out := append([]metricdata.HistogramDataPoint[N]{}, points...)
	for i := range out {
		out[i].Bounds = append([]float64{}, out[i].Bounds...)
		out[i].BucketCounts = append([]uint64{}, out[i].BucketCounts...)
		out[i].Exemplars = copyExemplars(out[i].Exemplars)
	}
	return out
}
func copyResource(data *metricdata.ResourceMetrics) metricdata.ResourceMetrics {
	out := metricdata.ResourceMetrics{Resource: data.Resource, ScopeMetrics: make([]metricdata.ScopeMetrics, len(data.ScopeMetrics))}
	for i, scope := range data.ScopeMetrics {
		out.ScopeMetrics[i] = metricdata.ScopeMetrics{Scope: scope.Scope, Metrics: make([]metricdata.Metrics, 0, len(scope.Metrics))}
		for _, metric := range scope.Metrics {
			switch d := metric.Data.(type) {
			case metricdata.Gauge[int64]:
				d.DataPoints = copyPoints(d.DataPoints)
				metric.Data = d
			case metricdata.Gauge[float64]:
				d.DataPoints = copyPoints(d.DataPoints)
				metric.Data = d
			case metricdata.Sum[int64]:
				d.DataPoints = copyPoints(d.DataPoints)
				metric.Data = d
			case metricdata.Sum[float64]:
				d.DataPoints = copyPoints(d.DataPoints)
				metric.Data = d
			case metricdata.Histogram[int64]:
				d.DataPoints = copyHistograms(d.DataPoints)
				metric.Data = d
			case metricdata.Histogram[float64]:
				d.DataPoints = copyHistograms(d.DataPoints)
				metric.Data = d
			default:
				continue
			}
			out.ScopeMetrics[i].Metrics = append(out.ScopeMetrics[i].Metrics, metric)
		}
	}
	return out
}
