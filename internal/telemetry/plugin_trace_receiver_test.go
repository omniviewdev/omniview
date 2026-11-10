package telemetry

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"

	sdktelemetry "github.com/omniviewdev/plugin-sdk/pkg/telemetry"
)

func TestPluginTraceReceiverRealExporter(t *testing.T) {
	received := make(chan *collectortrace.ExportTraceServiceRequest, 2)
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !assert.Equal(t, "/otlp/v1/traces", r.URL.Path) ||
			!assert.Equal(t, "Bearer host-secret", r.Header.Get("Authorization")) {
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		body, err := io.ReadAll(r.Body)
		if !assert.NoError(t, err) {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		var traces collectortrace.ExportTraceServiceRequest
		if !assert.NoError(t, proto.Unmarshal(body, &traces)) {
			http.Error(w, "invalid traces", http.StatusBadRequest)
			return
		}
		received <- &traces
		w.Header().Set("Content-Type", "application/x-protobuf")
	}))
	defer collector.Close()
	svc := New(Config{
		Enabled: true, Traces: true, OTLPEndpoint: collector.URL + "/otlp",
		AuthHeader: "Authorization", AuthValue: "Bearer host-secret",
	}, "", "", "", false, t.TempDir())
	endpoint, token, closeReceiver, err := svc.StartPluginTraceReceiver("kubernetes")
	require.NoError(t, err)
	defer closeReceiver()
	bad, err := http.Post(endpoint, "application/x-protobuf", bytes.NewReader(nil))
	require.NoError(t, err)
	require.Equal(t, http.StatusForbidden, bad.StatusCode)
	bad.Body.Close()
	t.Setenv("OMNIVIEW_TELEMETRY_ENABLED", "true")
	t.Setenv("OMNIVIEW_TELEMETRY_OTLP_ENDPOINT", endpoint)
	t.Setenv("OMNIVIEW_TELEMETRY_AUTH_HEADER", "Authorization")
	t.Setenv("OMNIVIEW_TELEMETRY_AUTH_VALUE", token)
	t.Setenv("OMNIVIEW_TELEMETRY_PROFILING", "false")
	t.Setenv("OMNIVIEW_PLUGIN_ID", "kubernetes")
	previousProvider, previousPropagator := otel.GetTracerProvider(), otel.GetTextMapPropagator()
	defer otel.SetTracerProvider(previousProvider)
	defer otel.SetTextMapPropagator(previousPropagator)
	provider, err := sdktelemetry.InitFromEnv()
	require.NoError(t, err)
	require.NotNil(t, provider)
	_, span := otel.Tracer("test").Start(context.Background(), "operation")
	identity := span.SpanContext()
	span.End()
	require.NoError(t, provider.Shutdown(context.Background()))
	select {
	case traces := <-received:
		got := traces.GetResourceSpans()[0].GetScopeSpans()[0].GetSpans()[0]
		traceID, spanID := identity.TraceID(), identity.SpanID()
		require.Equal(t, traceID[:], got.GetTraceId())
		require.Equal(t, spanID[:], got.GetSpanId())
	case <-time.After(time.Second):
		t.Fatal("missing export")
	}
	closeReceiver()
	_, err = http.Post(endpoint, "application/x-protobuf", bytes.NewReader(nil))
	require.Error(t, err)
}
