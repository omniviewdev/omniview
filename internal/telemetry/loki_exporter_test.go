package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	otellog "go.opentelemetry.io/otel/log"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
)

type lokiRecordCapture struct{ records []sdklog.Record }

func (*lokiRecordCapture) Enabled(context.Context, sdklog.EnabledParameters) bool { return true }
func (p *lokiRecordCapture) OnEmit(_ context.Context, r *sdklog.Record) error {
	p.records = append(p.records, r.Clone())
	return nil
}
func (*lokiRecordCapture) Shutdown(context.Context) error   { return nil }
func (*lokiRecordCapture) ForceFlush(context.Context) error { return nil }

func TestLokiExporterPush(t *testing.T) {
	var payload lokiPush
	var headers http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/loki/api/v1/push", r.URL.Path)
		headers = r.Header.Clone()
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	exp, err := NewLokiLogExporter(server.URL+"/loki/api/v1/push", "tenant-a", "Authorization", "Bearer secret")
	require.NoError(t, err)
	capture := &lokiRecordCapture{}
	provider := sdklog.NewLoggerProvider(sdklog.WithResource(resource.NewWithAttributes("", attribute.String("service.name", "app"), attribute.String("service.instance.id", "instance-1"))), sdklog.WithProcessor(capture))
	logger := provider.Logger("test-scope")
	var rec otellog.Record
	ts := time.Unix(1700000000, 123456789)
	rec.SetTimestamp(ts)
	rec.SetSeverity(otellog.SeverityError)
	rec.SetSeverityText("ERROR")
	rec.SetBody(attribute.StringValue("failure"))
	rec.AddAttributes(attribute.String("request.id", "unique"), attribute.Int("count", 3), attribute.Key("nested").Map(attribute.Bool("ok", true)))
	logger.Emit(context.Background(), rec)
	rec.SetTimestamp(ts.Add(time.Second))
	logger.Emit(context.Background(), rec)
	require.Len(t, capture.records, 2)
	require.NoError(t, exp.Export(context.Background(), capture.records))
	assert.Equal(t, "application/json", headers.Get("Content-Type"))
	assert.Equal(t, "tenant-a", headers.Get("X-Scope-OrgID"))
	assert.Equal(t, "Bearer secret", headers.Get("Authorization"))
	require.Len(t, payload.Streams, 1)
	assert.Equal(t, map[string]string{"job": "omniview"}, payload.Streams[0].Stream)
	require.Len(t, payload.Streams[0].Values, 2)
	assert.Equal(t, strconv.FormatInt(ts.UnixNano(), 10), payload.Streams[0].Values[0][0])
	assert.Equal(t, strconv.FormatInt(ts.Add(time.Second).UnixNano(), 10), payload.Streams[0].Values[1][0])
	var line map[string]any
	require.NoError(t, json.Unmarshal([]byte(payload.Streams[0].Values[0][1]), &line))
	assert.Equal(t, "failure", line["body"])
	assert.Equal(t, "ERROR", line["severity"])
	assert.Equal(t, float64(otellog.SeverityError), line["severity_number"])
	assert.Equal(t, "test-scope", line["scope_name"])
	assert.Equal(t, map[string]any{"request.id": "unique", "count": float64(3), "nested": map[string]any{"ok": true}}, line["attributes"])
	assert.Equal(t, map[string]any{"service.name": "app", "service.instance.id": "instance-1"}, line["resource"])
}

func TestLokiExporterErrorsAndLifecycle(t *testing.T) {
	for _, endpoint := range []string{"", "localhost:3100", "ftp://host/path", "http://user:pass@host/path"} {
		_, err := NewLokiLogExporter(endpoint, "", "", "")
		assert.Error(t, err)
	}
	_, err := NewLokiLogExporter("http://localhost", "bad\nvalue", "", "")
	assert.Error(t, err)
	_, err = NewLokiLogExporter("http://localhost", "", "Bad Header", "x")
	assert.Error(t, err)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "rejected", http.StatusTooManyRequests)
	}))
	defer server.Close()
	exp, err := NewLokiLogExporter(server.URL, "", "", "")
	require.NoError(t, err)
	var rec sdklog.Record
	rec.SetObservedTimestamp(time.Unix(123, 456))
	err = exp.Export(context.Background(), []sdklog.Record{rec})
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "429"))
	assert.False(t, strings.Contains(err.Error(), "rejected"))
	assert.EqualValues(t, 1, calls.Load())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	assert.ErrorIs(t, exp.Export(ctx, []sdklog.Record{rec}), context.Canceled)
	assert.ErrorIs(t, exp.ForceFlush(ctx), context.Canceled)
	assert.NoError(t, exp.Export(context.Background(), nil))
	assert.NoError(t, exp.Shutdown(context.Background()))
	assert.NoError(t, exp.Shutdown(ctx))
	assert.NoError(t, exp.ForceFlush(ctx))
	assert.True(t, errors.Is(exp.Export(context.Background(), nil), sdklog.ErrExporterShutdown))
}

func TestLokiExporterConcurrentLifecycle(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer server.Close()
	exp, err := NewLokiLogExporter(server.URL, "", "", "")
	require.NoError(t, err)
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = exp.Export(context.Background(), []sdklog.Record{{}})
			_ = exp.ForceFlush(context.Background())
			_ = exp.Shutdown(context.Background())
		}()
	}
	wg.Wait()
	assert.ErrorIs(t, exp.Export(context.Background(), []sdklog.Record{{}}), sdklog.ErrExporterShutdown)
}

func TestLokiExporterTimestampFallbackAndRedirect(t *testing.T) {
	var timestamp string
	var redirected atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirected.Store(true)
	}))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload lokiPush
		if err := json.NewDecoder(r.Body).Decode(&payload); err == nil && len(payload.Streams) == 1 && len(payload.Streams[0].Values) == 1 {
			timestamp = payload.Streams[0].Values[0][0]
		}
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	exp, err := NewLokiLogExporter(server.URL, "", "X-Api-Key", "secret")
	require.NoError(t, err)
	var rec sdklog.Record
	observed := time.Unix(123, 456)
	rec.SetObservedTimestamp(observed)
	require.Error(t, exp.Export(context.Background(), []sdklog.Record{rec}))
	assert.Equal(t, strconv.FormatInt(observed.UnixNano(), 10), timestamp)
	assert.False(t, redirected.Load())
}
