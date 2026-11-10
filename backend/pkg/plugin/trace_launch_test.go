package plugin

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

func TestCreateBackendOwnsTraceReceiver(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses a Unix executable wrapper")
	}
	pm := newTestManager(t)
	binary, err := os.Executable()
	require.NoError(t, err)
	root := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(root, "bin"), 0700))
	wrapper := `#!/bin/sh
printf '%s\n' "$OMNIVIEW_TELEMETRY_ENABLED" "$OMNIVIEW_TELEMETRY_OTLP_ENDPOINT" \
  "$OMNIVIEW_TELEMETRY_AUTH_HEADER" "$OMNIVIEW_TELEMETRY_AUTH_VALUE" \
  "${OTEL_EXPORTER_OTLP_HEADERS-unset}" > "$TRACE_TEST_ENV_FILE"
exec "$TRACE_TEST_BINARY" -test.run='^TestActivityBrokerChildProcess$'
`
	require.NoError(t, os.WriteFile(filepath.Join(root, "bin", "plugin"), []byte(wrapper), 0700))
	file := filepath.Join(t.TempDir(), "environment")
	t.Setenv("TRACE_TEST_ENV_FILE", file)
	t.Setenv("TRACE_TEST_BINARY", binary)
	t.Setenv(activityBrokerChildEnv, "normal")
	t.Setenv("OMNIVIEW_TELEMETRY_AUTH_VALUE", "host-secret")
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=host-secret")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	var cleaned atomic.Bool
	defer server.Close()
	pm.telemetryConfigFn = func(id string) (TelemetryEnvConfig, error) {
		require.Equal(t, "activity-broker-test", id)
		return TelemetryEnvConfig{
			Enabled: true, OTLPEndpoint: server.URL, AuthToken: "local-capability",
			Cleanup: func() { cleaned.Store(true); server.Close() },
		}, nil
	}
	backend, err := pm.createBackend("activity-broker-test", config.PluginMeta{ID: "activity-broker-test"}, root)
	require.NoError(t, err)
	defer backend.Kill()
	data, err := os.ReadFile(file)
	require.NoError(t, err)
	require.Equal(t, []string{"true", server.URL, "Authorization", "local-capability", "unset"},
		strings.Split(strings.TrimSpace(string(data)), "\n"))
	require.False(t, cleaned.Load(), "receiver must survive successful startup")
	resp, err := http.Get(server.URL)
	require.NoError(t, err)
	resp.Body.Close()
	backend.Kill()
	require.True(t, cleaned.Load(), "receiver must close after process exit")
}
