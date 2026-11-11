package telemetry

import (
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func observedService() (*Service, *observer.ObservedLogs) {
	core, logs := observer.New(zapcore.DebugLevel)
	return &Service{zapLogger: zap.New(core)}, logs
}

func TestEndpointHostDropsCredentialsAndPaths(t *testing.T) {
	require.Equal(t, "collector.example:4318",
		endpointHost("https://user:pw-secret@collector.example:4318/v1/traces?key=q-secret"))
	require.Equal(t, "collector.example:4318", endpointHost("collector.example:4318"))
	require.Empty(t, endpointHost(""))
}

func TestExporterConfigChangeLogsHostOnly(t *testing.T) {
	svc, logs := observedService()
	svc.logConfigChange(Config{
		Enabled: true, Traces: true, OTLPEndpoint: "https://user:pw-secret@otel.example:4318/path",
		AuthHeader: "Authorization", AuthValue: "auth-secret",
		LogsShip: true, LogFormat: "loki", LokiEndpoint: "https://loki.example/loki/api/v1/push",
		LokiAuthValue: "loki-secret",
	}, true, false, true)

	entries := logs.All()
	require.Len(t, entries, 2)
	require.Equal(t, zapcore.InfoLevel, entries[0].Level)
	require.Equal(t, "trace", entries[0].ContextMap()["signal"])
	require.Equal(t, "otel.example:4318", entries[0].ContextMap()["endpointHost"])
	require.Equal(t, "loki", entries[1].ContextMap()["mode"])
	require.Equal(t, true, entries[1].ContextMap()["enabled"])
	for _, e := range entries {
		for _, v := range e.ContextMap() {
			require.NotContains(t, fmt.Sprint(v), "secret")
		}
	}
}

func TestExporterShutdownFailureWarnsWithoutErrorText(t *testing.T) {
	svc, logs := observedService()
	svc.warnExporterShutdown("trace", errors.New("dial https://u:pw-secret@host token=abc123"))
	svc.warnReleaseUnapplied("profiler", errors.New("token=abc123"))

	entries := logs.All()
	require.Len(t, entries, 2)
	for _, e := range entries {
		require.Equal(t, zapcore.WarnLevel, e.Level)
		for _, v := range e.ContextMap() {
			if s, ok := v.(string); ok {
				require.NotContains(t, s, "abc123")
				require.NotContains(t, s, "secret")
			}
		}
	}
}

func TestLoggerBeforeInitIsSafe(t *testing.T) {
	svc := &Service{}
	require.NotPanics(t, func() { svc.warnExporterShutdown("log", errors.New("x")) })
}
