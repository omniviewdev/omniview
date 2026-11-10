package categories

import (
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/telemetry"
	"github.com/omniviewdev/plugin-sdk/settings"
)

func TestDefinitionsUseModeSpecificTelemetryDefaults(t *testing.T) {
	for _, isDev := range []bool{false, true} {
		var definition settings.Category
		categories := Definitions(isDev)
		require.Len(t, categories, 6)
		for _, category := range categories {
			if category.ID == "telemetry" {
				definition = category
			}
		}
		defaults := telemetry.DefaultConfig(isDev)
		for id, expected := range map[string]any{
			"enabled": defaults.Enabled, "traces": defaults.Traces,
			"metrics": defaults.Metrics, "logs_ship": defaults.LogsShip,
			"logs_ship_level": defaults.LogsShipLevel, "profiling": defaults.Profiling,
			"endpoint_otlp": defaults.OTLPEndpoint, "endpoint_pyroscope": defaults.PyroscopeEndpoint,
			"auth_header": defaults.AuthHeader, "auth_value": defaults.AuthValue,
			"logs_format": defaults.LogFormat, "endpoint_otlp_logs": defaults.OTLPLogEndpoint,
			"otlp_logs_auth_header": defaults.OTLPLogAuthHeader, "otlp_logs_auth_value": defaults.OTLPLogAuthValue,
			"otlp_logs_tenant_id": defaults.OTLPLogTenantID, "endpoint_loki": defaults.LokiEndpoint,
			"loki_auth_header": defaults.LokiAuthHeader, "loki_auth_value": defaults.LokiAuthValue,
			"loki_tenant_id": defaults.LokiTenantID,
		} {
			assert.Equal(t, expected, definition.Settings[id].Default, "mode=%v, setting=%s", isDev, id)
		}
	}
	// Mode selection never mutates the legacy production category global.
	assert.Equal(t, telemetry.DefaultConfig(false).LogsShipLevel, Telemetry.Settings["logs_ship_level"].Default)
}

func TestTelemetryConnectionSettingsRemainVisible(t *testing.T) {
	for _, isDev := range []bool{false, true} {
		for _, category := range Definitions(isDev) {
			if category.ID != "telemetry" {
				continue
			}
			for _, id := range []string{
				"logs_format", "endpoint_otlp", "endpoint_otlp_logs", "endpoint_loki", "endpoint_pyroscope",
				"auth_header", "auth_value", "otlp_logs_auth_header", "otlp_logs_auth_value", "otlp_logs_tenant_id",
				"loki_auth_header", "loki_auth_value", "loki_tenant_id",
			} {
				setting, ok := category.Settings[id]
				require.True(t, ok, "missing %s", id)
				assert.False(t, setting.DevOnly, "mode=%v setting=%s", isDev, id)
			}
			assert.True(t, category.Settings["auth_value"].Sensitive)
			assert.True(t, category.Settings["otlp_logs_auth_value"].Sensitive)
			assert.Equal(t, settings.Password, category.Settings["otlp_logs_auth_value"].Type)
			assert.True(t, category.Settings["loki_auth_value"].Sensitive)
		}
	}
}

func TestTelemetryLogFormatValidation(t *testing.T) {
	setting := Telemetry.Settings["logs_format"]
	assert.Equal(t, settings.Text, setting.Type)
	assert.Equal(t, "otlp", setting.Default)
	require.Len(t, setting.Options, 2)
	assert.Equal(t, "otlp", setting.Options[0].Value)
	assert.Equal(t, "loki", setting.Options[1].Value)
	assert.Equal(t, "OpenTelemetry (OTLP)", setting.Options[0].Label)
	assert.Equal(t, "Loki", setting.Options[1].Label)
	for _, value := range []any{"otlp", "loki"} {
		assert.True(t, setting.Validation(value).Valid, "expected valid: %v", value)
	}
	for _, value := range []any{"", "OTLP", "other", true, nil} {
		assert.False(t, setting.Validation(value).Valid, "expected invalid: %v", value)
	}
}

func TestTelemetryClientIDSetting(t *testing.T) {
	setting := Telemetry.Settings["client_id"]
	assert.Equal(t, settings.Text, setting.Type)
	assert.Empty(t, setting.Default)
	assert.True(t, setting.RequiresRestart)
	for _, value := range []any{"", "site-A_1.example", strings.Repeat("a", 64)} {
		assert.True(t, setting.Validation(value).Valid, "expected valid: %v", value)
	}
	for _, value := range []any{nil, true, "with space", "bad/label", "é", strings.Repeat("a", 65)} {
		assert.False(t, setting.Validation(value).Valid, "expected invalid: %v", value)
	}
}

func TestLokiSettingsValidation(t *testing.T) {
	cases := []struct {
		id      string
		valid   []any
		invalid []any
	}{
		{"endpoint_loki", []any{"", "https://loki.example.test/loki/api/v1/push"}, []any{"loki.example.test", "ftp://loki.example.test", "https://user:pass@example.test", true}},
		{"loki_tenant_id", []any{"", "cluster"}, []any{"cluster\nsecret", true}},
		{"loki_auth_header", []any{"", "Authorization"}, []any{"Bad Header", "Content-Type", "x-scope-orgid", true}},
		{"loki_auth_value", []any{"", "Bearer secret"}, []any{"secret\nvalue", true}},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			setting := Telemetry.Settings[tc.id]
			for _, value := range tc.valid {
				assert.True(t, setting.Validation(value).Valid)
			}
			for _, value := range tc.invalid {
				result := setting.Validation(value)
				assert.False(t, result.Valid)
				assert.NotContains(t, result.Message, "secret")
			}
		})
	}
}

func TestProfilingDefinitionsRemainVisibleInEveryBuild(t *testing.T) {
	for _, isDev := range []bool{false, true} {
		var developer settings.Category
		for _, category := range Definitions(isDev) {
			if category.ID == "developer" {
				developer = category
			}
		}
		enabled := developer.Settings["pprof_enabled"]
		assert.Equal(t, settings.Toggle, enabled.Type)
		assert.Equal(t, false, enabled.Default)
		assert.False(t, enabled.DevOnly)
		assert.True(t, enabled.RequiresRestart)
		pluginEnabled := developer.Settings["plugin_pprof_enabled"]
		assert.Equal(t, settings.Toggle, pluginEnabled.Type)
		assert.Equal(t, false, pluginEnabled.Default)
		assert.False(t, pluginEnabled.DevOnly)
		assert.True(t, pluginEnabled.RequiresRestart)
		port := developer.Settings["pprof_port"]
		assert.Equal(t, settings.Integer, port.Type)
		assert.Equal(t, 6060, port.Default)
		assert.False(t, port.DevOnly)
		assert.True(t, port.RequiresRestart)
	}
}

func TestProfilingPortValidation(t *testing.T) {
	port := Developer.Settings["pprof_port"]
	for _, value := range []any{0, 6060, 65535, float64(0), float64(6060), float64(65535)} {
		assert.True(t, port.Validation(value).Valid, "expected valid: %v", value)
	}
	for _, value := range []any{-1, 65536, -0.5, 6060.5, math.NaN(), math.Inf(1), math.Inf(-1), "6060", true, nil} {
		assert.False(t, port.Validation(value).Valid, "expected invalid: %v", value)
	}
}
