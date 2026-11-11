package telemetry

import (
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

func TestFrontendSpansPreserveIdentityAndSettings(t *testing.T) {
	var bodies [][]byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/traces", r.URL.Path)
		assert.Equal(t, "Bearer test", r.Header.Get("Authorization"))
		body, err := io.ReadAll(r.Body)
		if !assert.NoError(t, err) {
			http.Error(w, "failed to read request", http.StatusBadRequest)
			return
		}
		bodies = append(bodies, body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	svc := &Service{
		cfg: Config{Enabled: true, Traces: true, OTLPEndpoint: server.URL,
			AuthHeader: "Authorization", AuthValue: "Bearer test"}, version: "test",
	}
	binding := NewTelemetryBinding(svc)
	now := time.Now().Unix()
	payload := fmt.Sprintf(`{"spans":[{"name":"frontend.interaction",`+
		`"traceId":"0123456789abcdef0123456789abcdef","spanId":"0123456789abcdef",`+
		`"parentSpanId":"abcdef0123456789","start":[%d,123],"end":[%d,456]}]}`, now, now)
	require.NoError(t, binding.IngestFrontendSignals(payload))
	require.Len(t, bodies, 1)
	var request collectortrace.ExportTraceServiceRequest
	require.NoError(t, proto.Unmarshal(bodies[0], &request))
	resources := request.GetResourceSpans()
	require.Len(t, resources, 1)
	scopes := resources[0].GetScopeSpans()
	require.Len(t, scopes, 1)
	spans := scopes[0].GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]
	require.Equal(t, "0123456789abcdef0123456789abcdef", hex.EncodeToString(span.GetTraceId()))
	require.Equal(t, "0123456789abcdef", hex.EncodeToString(span.GetSpanId()))
	require.Equal(t, "abcdef0123456789", hex.EncodeToString(span.GetParentSpanId()))
	require.Equal(t, uint64(now)*1e9+123, span.GetStartTimeUnixNano())
	require.Equal(t, uint64(now)*1e9+456, span.GetEndTimeUnixNano())
	require.Empty(t, span.GetAttributes())
	svc.cfg.Traces = false
	require.NoError(t, binding.IngestFrontendSignals(payload))
	svc.cfg.Traces = true
	svc.cfg.Enabled = false
	require.NoError(t, binding.IngestFrontendSignals(payload))
	require.Len(t, bodies, 1)
	svc.cfg.Enabled = true
	require.NoError(t, binding.IngestFrontendSignals(payload))
	require.Len(t, bodies, 2)
}

func TestFrontendSpansRejectUntrustedInput(t *testing.T) {
	binding := NewTelemetryBinding(&Service{cfg: Config{Enabled: true, Traces: true, OTLPEndpoint: "collector"}})
	require.Error(t, binding.IngestFrontendSignals(strings.Repeat("x", maxFrontendPayload+1)))
	require.Error(t, binding.IngestFrontendSignals(`{"spans":[]}`))
	require.Error(t, binding.IngestFrontendSignals(`{"spans":[{"name":"secret"}]}`))
	now := time.Now().Unix()
	payload := fmt.Sprintf(`{"spans":[{"name":"frontend.interaction",`+
		`"traceId":"0123456789abcdef0123456789abcdef","spanId":"0123456789abcdef",`+
		`"start":[%d,0],"end":[%d,0],"attributes":{"secret":"never export"}}]}`, now, now)
	require.Error(t, binding.IngestFrontendSignals(payload))
	require.Error(t, binding.IngestFrontendSignals(`{"spans":[{"name":"frontend.startup","traceId":"invalid"}]}`))
}

func TestFrontendSpansUseStartupClientID(t *testing.T) {
	for _, clientID := range []string{"", "installation-a"} {
		t.Run(clientID, func(t *testing.T) {
			received := make(chan *collectortrace.ExportTraceServiceRequest, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, err := io.ReadAll(r.Body)
				if !assert.NoError(t, err) {
					http.Error(w, "invalid body", http.StatusBadRequest)
					return
				}
				var request collectortrace.ExportTraceServiceRequest
				if !assert.NoError(t, proto.Unmarshal(body, &request)) {
					http.Error(w, "invalid traces", http.StatusBadRequest)
					return
				}
				received <- &request
			}))
			defer server.Close()
			svc := &Service{
				cfg:      Config{Enabled: true, Traces: true, OTLPEndpoint: server.URL},
				resource: resource.NewSchemaless(attribute.String("omniview.client.id", clientID)),
			}
			now := time.Now().Unix()
			payload := fmt.Sprintf(`{"spans":[{"name":"frontend.startup",`+
				`"traceId":"0123456789abcdef0123456789abcdef","spanId":"0123456789abcdef",`+
				`"start":[%d,0],"end":[%d,1]}]}`, now, now)
			require.NoError(t, NewTelemetryBinding(svc).IngestFrontendSignals(payload))
			request := <-received
			require.Len(t, request.GetResourceSpans(), 1)
			var ids []string
			for _, attr := range request.GetResourceSpans()[0].GetResource().GetAttributes() {
				if attr.GetKey() == "omniview.client.id" {
					ids = append(ids, attr.GetValue().GetStringValue())
				}
			}
			if clientID == "" {
				require.Empty(t, ids)
			} else {
				require.Equal(t, []string{clientID}, ids)
			}
		})
	}
}
