package metric

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

func TestMetricQueryAdmissionSpanClassifiesWithoutProviderMessage(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := tracer
	tracer = provider.Tracer("test")
	t.Cleanup(func() { tracer = previous; _ = provider.Shutdown(context.Background()) })
	ctrl, ok := NewController(logging.NewNop(), nil, finiteTestConnections{}).(*controller)
	require.True(t, ok)
	ctrl.SetUIReferenceAdmitter(func(
		ctx context.Context, _, _ string, _ resourcev2.AccessRoute, _ resourcev2.ResourceReference,
	) (context.Context, error) {
		return ctx, resourcev2.NewError("FORBIDDEN", "token=abc123")
	})
	_, err := ctrl.Query(context.Background(), "plugin", "connection", sdkmetric.QueryRequest{
		Reference: &resourcev2.ResourceReference{}, Route: &resourcev2.AccessRoute{Connection: "connection"},
	})
	require.Error(t, err)
	spans := recorder.Ended()
	require.Len(t, spans, 1)
	require.Equal(t, "metric.Query", spans[0].Name())
	text := fmt.Sprint(spans[0].Attributes(), spans[0].Events(), spans[0].Status())
	require.Contains(t, text, "failure")
	require.Contains(t, text, "FORBIDDEN")
	require.NotContains(t, text, "abc123")
}

func TestMetricsObservationTokenExcludedFromSpans(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := tracer
	tracer = provider.Tracer("test")
	t.Cleanup(func() { tracer = previous; _ = provider.Shutdown(context.Background()) })

	wrapper := &ServiceWrapper{}
	token := "token=abc123"
	require.Error(t, wrapper.AttachMetricsObservation(context.Background(), token))
	require.Error(t, wrapper.CloseMetricsObservation(context.Background(), token))
	require.Error(t, wrapper.RefreshMetricsObservation(context.Background(), token))

	spans := recorder.Ended()
	require.Len(t, spans, 3)
	for _, span := range spans {
		text := fmt.Sprint(span.Attributes(), span.Events(), span.Status())
		require.NotContains(t, text, token)
	}
}

type metricAuditBadJSON struct{}

func (metricAuditBadJSON) MarshalJSON() ([]byte, error) {
	return nil, errors.New("token=abc123")
}

func TestMetricConfigurationMarshalFailureIsClassified(t *testing.T) {
	sink := &logtest.RecordingSink{}
	previous := logging.Default()
	logging.SetDefault(logging.New(logging.Config{
		Backend: logging.NewSinkBackend(sink),
		Level:   logging.NewLevelController(logging.LevelDebug),
	}))
	t.Cleanup(func() { logging.SetDefault(previous) })

	copyJSON(metricAuditBadJSON{})
	metricDigest(metricAuditBadJSON{})

	records := sink.Records()
	require.Len(t, records, 2)
	for i, operation := range []string{"copy_marshal", "digest_marshal"} {
		require.Equal(t, logging.LevelDebug, records[i].Level)
		fields := fmt.Sprint(records[i].Fields)
		require.Contains(t, fields, operation)
		require.Contains(t, fields, "errorClass")
		require.NotContains(t, fields, "abc123")
	}
}
