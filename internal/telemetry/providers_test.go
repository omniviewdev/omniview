package telemetry

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"
	collectormetrics "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	"google.golang.org/protobuf/proto"
)

func TestNewTracerProvider(t *testing.T) {
	res := resource.Default()
	exp := NewNoopTraceExporter()
	tp := NewTracerProvider(res, exp)
	require.NotNil(t, tp)

	tracer := tp.Tracer("test")
	_, span := tracer.Start(context.Background(), "test-span")
	assert.True(t, span.SpanContext().IsValid())
	span.End()

	require.NoError(t, tp.Shutdown(context.Background()))
}

func TestNewMeterProvider(t *testing.T) {
	res := resource.Default()
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(reader),
	)
	require.NotNil(t, mp)

	meter := mp.Meter("test")
	counter, err := meter.Int64Counter("test.counter")
	require.NoError(t, err)
	counter.Add(context.Background(), 1)

	require.NoError(t, mp.Shutdown(context.Background()))
}

func TestNewLoggerProvider(t *testing.T) {
	res := resource.Default()
	lp := sdklog.NewLoggerProvider(sdklog.WithResource(res))
	require.NotNil(t, lp)
	require.NoError(t, lp.Shutdown(context.Background()))
}

func TestClientIDMetricExporterOTLP(t *testing.T) {
	var received collectormetrics.ExportMetricsServiceRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if !assert.NoError(t, err) || !assert.NoError(t, proto.Unmarshal(body, &received)) {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	inner, err := NewMetricExporter(context.Background(), server.URL, "", "")
	require.NoError(t, err)
	defer func() { _ = inner.Shutdown(context.Background()) }()
	res := resourceWithClientID(resource.Empty(), "site-1")
	original := metricdata.ResourceMetrics{
		Resource: res,
		ScopeMetrics: []metricdata.ScopeMetrics{{Metrics: []metricdata.Metrics{{
			Name: "plugin.diagnostic",
			Data: metricdata.Gauge[int64]{DataPoints: []metricdata.DataPoint[int64]{{
				Attributes: attribute.NewSet(
					attribute.String("plugin_id", "plugin-a"),
					attribute.String("omniview_client_id", "spoofed"),
				),
				Value: 1,
			}}},
		}}}},
	}
	require.NoError(t, withClientIDMetrics(inner, "site-1").Export(context.Background(), &original))
	require.Len(t, received.GetResourceMetrics(), 1)
	exported := received.GetResourceMetrics()[0]
	require.Equal(t, "site-1", exported.GetResource().GetAttributes()[0].GetValue().GetStringValue())
	points := exported.GetScopeMetrics()[0].GetMetrics()[0].GetGauge().GetDataPoints()
	require.Len(t, points, 1)
	labels := map[string]string{}
	for _, kv := range points[0].GetAttributes() {
		labels[kv.GetKey()] = kv.GetValue().GetStringValue()
	}
	assert.Equal(t, map[string]string{"plugin_id": "plugin-a", "omniview_client_id": "site-1"}, labels)
	gauge, ok := original.ScopeMetrics[0].Metrics[0].Data.(metricdata.Gauge[int64])
	require.True(t, ok)
	point := gauge.DataPoints[0]
	value, ok := point.Attributes.Value("omniview_client_id")
	require.True(t, ok)
	assert.Equal(t, "spoofed", value.AsString())
}
