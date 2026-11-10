package telemetry

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

func TestPluginTraceReceiverLiveConfigAndIdentity(t *testing.T) {
	calls := make(chan string, 4)
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls <- r.Header.Get("X-Collector-Token")
		w.Header().Set("Content-Type", "application/x-protobuf")
	}))
	defer collector.Close()
	otherCalls := make(chan string, 1)
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		otherCalls <- r.Header.Get("X-Collector-Token")
		w.Header().Set("Content-Type", "application/x-protobuf")
	}))
	defer other.Close()
	svc := New(Config{
		Enabled: true, Traces: true, OTLPEndpoint: collector.URL,
		AuthHeader: "X-Collector-Token", AuthValue: "old",
	}, "", "", "", false, t.TempDir())
	endpoint, token, cleanup, err := svc.StartPluginTraceReceiver("kubernetes")
	require.NoError(t, err)
	defer cleanup()
	value := func(s string) *commonpb.AnyValue {
		return &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: s}}
	}
	request := &collectortrace.ExportTraceServiceRequest{
		ResourceSpans: []*tracepb.ResourceSpans{{
			Resource: &resourcepb.Resource{Attributes: []*commonpb.KeyValue{
				{Key: "service.name", Value: value("omniview.plugin.kubernetes")},
				{Key: "omniview.plugin.id", Value: value("kubernetes")},
			}},
		}},
	}
	send := func() int {
		data, marshalErr := proto.Marshal(request)
		require.NoError(t, marshalErr)
		req, requestErr := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(data))
		require.NoError(t, requestErr)
		req.Header.Set("Content-Type", "application/x-protobuf")
		req.Header.Set("Authorization", token)
		resp, sendErr := http.DefaultClient.Do(req)
		require.NoError(t, sendErr)
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		return resp.StatusCode
	}
	svc.mu.Lock()
	svc.cfg.AuthValue = "new"
	svc.mu.Unlock()
	require.Equal(t, http.StatusOK, send())
	require.Equal(t, "new", <-calls)
	svc.mu.Lock()
	svc.cfg.OTLPEndpoint = other.URL
	svc.mu.Unlock()
	require.Equal(t, http.StatusOK, send())
	require.Equal(t, "new", <-otherCalls)
	request.GetResourceSpans()[0].GetResource().GetAttributes()[1].Value = value("different")
	require.Equal(t, http.StatusBadRequest, send())
	select {
	case <-otherCalls:
		t.Fatal("foreign identity forwarded")
	default:
	}
	request.GetResourceSpans()[0].GetResource().GetAttributes()[1].Value = value("kubernetes")
	require.NoError(t, svc.ApplyConfig(context.Background(), Config{}))
	svc.mu.Lock()
	svc.cfg = Config{Enabled: true, Traces: true, OTLPEndpoint: other.URL}
	svc.mu.Unlock()
	require.Equal(t, http.StatusOK, send())
	select {
	case <-otherCalls:
		t.Fatal("receiver forwarded buffered spans after disable")
	default:
	}
	endpoint, token, restartCleanup, err := svc.StartPluginTraceReceiver("kubernetes")
	require.NoError(t, err)
	defer restartCleanup()
	require.Equal(t, http.StatusOK, send())
	oversize, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(make([]byte, pluginTraceLimit+1)))
	require.NoError(t, err)
	oversize.Header.Set("Content-Type", "application/x-protobuf")
	oversize.Header.Set("Authorization", token)
	oversizeResp, err := http.DefaultClient.Do(oversize)
	require.NoError(t, err)
	require.Equal(t, http.StatusBadRequest, oversizeResp.StatusCode)
	_ = oversizeResp.Body.Close()
	require.Empty(t, <-otherCalls)
	require.NoError(t, svc.ApplyConfig(context.Background(), Config{}))
	endpoint, token, disabledCleanup, err := svc.StartPluginTraceReceiver("kubernetes")
	require.NoError(t, err)
	defer disabledCleanup()
	svc.mu.Lock()
	svc.cfg = Config{Enabled: true, Traces: true, OTLPEndpoint: other.URL}
	svc.mu.Unlock()
	require.Equal(t, http.StatusOK, send())
	select {
	case <-otherCalls:
		t.Fatal("receiver started disabled forwarded traces")
	default:
	}
}

func TestPluginTraceReceiverUsesHostClientID(t *testing.T) {
	for _, clientID := range []string{"", "installation-a"} {
		t.Run(clientID, func(t *testing.T) {
			testPluginTraceClientID(t, clientID)
		})
	}
}

func testPluginTraceClientID(t *testing.T, clientID string) {
	t.Helper()
	received := make(chan *collectortrace.ExportTraceServiceRequest, 1)
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivePluginTraceForTest(t, w, r, received)
	}))
	defer collector.Close()
	svc := &Service{
		cfg: Config{Enabled: true, Traces: true, OTLPEndpoint: collector.URL,
			AuthHeader: "Authorization", AuthValue: "Bearer host"},
		resource: resource.NewSchemaless(attribute.String("omniview.client.id", clientID)),
	}
	endpoint, token, cleanup, err := svc.StartPluginTraceReceiver("kubernetes")
	require.NoError(t, err)
	defer cleanup()
	body, err := proto.Marshal(&collectortrace.ExportTraceServiceRequest{
		ResourceSpans: []*tracepb.ResourceSpans{spoofedPluginResource(), spoofedPluginResource()},
	})
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.Header.Set("Authorization", token)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode)
	response, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, "collector response", string(response))
	forwarded := <-received
	require.Len(t, forwarded.GetResourceSpans(), 2)
	for _, rs := range forwarded.GetResourceSpans() {
		assertPluginResourceClientID(t, rs, clientID)
	}
}

func receivePluginTraceForTest(
	t *testing.T, w http.ResponseWriter, r *http.Request, received chan<- *collectortrace.ExportTraceServiceRequest,
) {
	t.Helper()
	if !assert.Equal(t, "Bearer host", r.Header.Get("Authorization")) {
		http.Error(w, "invalid authorization", http.StatusBadRequest)
		return
	}
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
	_, _ = w.Write([]byte("collector response"))
}

func spoofedPluginResource() *tracepb.ResourceSpans {
	kv := func(key, value string) *commonpb.KeyValue {
		return &commonpb.KeyValue{Key: key, Value: &commonpb.AnyValue{
			Value: &commonpb.AnyValue_StringValue{StringValue: value},
		}}
	}
	return &tracepb.ResourceSpans{
		Resource: &resourcepb.Resource{Attributes: []*commonpb.KeyValue{
			kv("service.name", "omniview.plugin.kubernetes"),
			kv("omniview.plugin.id", "kubernetes"),
			kv("omniview.client.id", "spoofed"), kv("omniview.client.id", "another"),
		}},
		ScopeSpans: []*tracepb.ScopeSpans{{Spans: []*tracepb.Span{{
			TraceId: []byte("0123456789abcdef"), SpanId: []byte("01234567"),
		}}}},
	}
}

func assertPluginResourceClientID(t *testing.T, rs *tracepb.ResourceSpans, clientID string) {
	t.Helper()
	var ids []string
	for _, attr := range rs.GetResource().GetAttributes() {
		if attr.GetKey() == "omniview.client.id" {
			ids = append(ids, attr.GetValue().GetStringValue())
		}
	}
	if clientID == "" {
		require.Empty(t, ids)
	} else {
		require.Equal(t, []string{clientID}, ids)
	}
	span := rs.GetScopeSpans()[0].GetSpans()[0]
	require.Equal(t, []byte("0123456789abcdef"), span.GetTraceId())
	require.Equal(t, []byte("01234567"), span.GetSpanId())
}
