package telemetry

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
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
