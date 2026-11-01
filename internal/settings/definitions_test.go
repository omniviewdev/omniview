package categories

import (
	"math"
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
		} {
			assert.Equal(t, expected, definition.Settings[id].Default, "mode=%v, setting=%s", isDev, id)
		}
	}
	// Mode selection never mutates the legacy production category global.
	assert.Equal(t, telemetry.DefaultConfig(false).LogsShipLevel, Telemetry.Settings["logs_ship_level"].Default)
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
