package telemetry

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	collectorlogs "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	"google.golang.org/protobuf/proto"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog"
)

func TestPluginLogsReachOTLPCollector(t *testing.T) {
	t.Cleanup(resetGlobalOTel)
	requests := make(chan *collectorlogs.ExportLogsServiceRequest, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil || r.URL.Path != "/otlp/v1/logs" {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		var request collectorlogs.ExportLogsServiceRequest
		if unmarshalErr := proto.Unmarshal(body, &request); unmarshalErr != nil {
			http.Error(w, "invalid protobuf", http.StatusBadRequest)
			return
		}
		select {
		case requests <- &request:
		default:
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	ctx := context.Background()
	svc := New(Config{Enabled: true, LogsShip: true, LogsShipLevel: "warn", OTLPEndpoint: server.URL + "/otlp"},
		"test", "commit", "date", false, t.TempDir())
	require.NoError(t, svc.Init(ctx))
	defer func() { _ = svc.Shutdown(ctx) }()
	manager, err := pluginlog.NewManager(t.TempDir(), pluginlog.DefaultRotation())
	require.NoError(t, err)
	defer func() { _ = manager.Close() }()
	manager.OnRemote(pluginlog.RemoteSink(svc.LoggerProvider().Logger("plugin"), func() (bool, string) {
		cfg := svc.Config()
		return cfg.Enabled && cfg.LogsShip, cfg.LogsShipLevel
	}))
	_, err = io.WriteString(manager.Stream("example"), "2026-01-01T00:00:00Z [ERROR] plugin failure\n")
	require.NoError(t, err)
	require.NoError(t, svc.LoggerProvider().ForceFlush(ctx))
	require.True(t, hasPluginLog(<-requests), "plugin record and identity were not exported")
}

func hasPluginLog(request *collectorlogs.ExportLogsServiceRequest) bool {
	for _, resource := range request.GetResourceLogs() {
		for _, scope := range resource.GetScopeLogs() {
			for _, record := range scope.GetLogRecords() {
				if record.GetBody().GetStringValue() != "plugin failure" {
					continue
				}
				for _, attr := range record.GetAttributes() {
					if attr.GetKey() == "plugin.id" && attr.GetValue().GetStringValue() == "example" {
						return true
					}
				}
			}
		}
	}
	return false
}
