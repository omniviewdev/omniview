package categories

import (
	"strings"

	"github.com/omniviewdev/omniview/internal/telemetry"
	"github.com/omniviewdev/plugin-sdk/settings"
)

// buildTelemetrySettings derives the UI and runtime defaults from the same
// mode-specific telemetry configuration.
func buildTelemetrySettings(isDev bool) map[string]settings.Setting {
	defaults := telemetry.DefaultConfig(isDev)

	validLevels := telemetry.GetValidLogLevels()
	logLevelOptions := make([]settings.SettingOption, 0, len(validLevels))
	for _, lvl := range validLevels {
		logLevelOptions = append(logLevelOptions, settings.SettingOption{
			Value:       lvl,
			Label:       lvl,
			Description: "",
		})
	}

	return map[string]settings.Setting{
		"enabled": {
			ID:          "enabled",
			Label:       "Enable Telemetry",
			Description: "Master switch for all telemetry export. When off, no data is shipped externally.",
			Type:        settings.Toggle,
			Default:     defaults.Enabled,
		},
		"traces": {
			ID:          "traces",
			Label:       "Traces",
			Description: "Enable distributed tracing via OpenTelemetry",
			Type:        settings.Toggle,
			Default:     defaults.Traces,
		},
		"metrics": {
			ID:          "metrics",
			Label:       "Metrics",
			Description: "Enable metrics collection via OpenTelemetry",
			Type:        settings.Toggle,
			Default:     defaults.Metrics,
		},
		"logs_ship": {
			ID:          "logs_ship",
			Label:       "Ship Logs",
			Description: "Ship logs to Grafana via OTLP (local log files are always written regardless)",
			Type:        settings.Toggle,
			Default:     defaults.LogsShip,
		},
		"logs_ship_level": {
			ID:          "logs_ship_level",
			Label:       "Log Ship Level",
			Description: "Minimum log level to ship externally",
			Type:        settings.Text,
			Default:     defaults.LogsShipLevel,
			Options:     logLevelOptions,
			Validator: func(v any) settings.ValidationResult {
				s, ok := v.(string)
				if !ok {
					return settings.ValidationResult{Code: "log_level_type", Message: "Choose a log level from the available options."}
				}
				if !telemetry.IsValidLogLevel(s) {
					return settings.ValidationResult{Code: "log_level", Message: "Choose a log level: " + strings.Join(validLevels, ", ") + "."}
				}
				return settings.ValidationResult{Valid: true, Code: "log_level", Message: "Log level is valid."}
			},
		},
		"profiling": {
			ID:          "profiling",
			Label:       "Continuous Profiling",
			Description: "Enable continuous profiling via Pyroscope (CPU, memory, goroutines)",
			Type:        settings.Toggle,
			Default:     defaults.Profiling,
		},
		"endpoint_otlp": {
			ID:          "endpoint_otlp",
			Label:       "OTLP Endpoint",
			Description: "OTLP HTTP endpoint for traces, metrics, and logs (e.g., localhost:4318)",
			Type:        settings.Text,
			Default:     defaults.OTLPEndpoint,
			DevOnly:     true,
		},
		"endpoint_pyroscope": {
			ID:          "endpoint_pyroscope",
			Label:       "Pyroscope Endpoint",
			Description: "Pyroscope endpoint for continuous profiling (e.g., localhost:4040)",
			Type:        settings.Text,
			Default:     defaults.PyroscopeEndpoint,
			DevOnly:     true,
		},
		"auth_header": {
			ID:          "auth_header",
			Label:       "Auth Header",
			Description: "HTTP header name for authentication (e.g., Authorization for Grafana Cloud)",
			Type:        settings.Text,
			Default:     defaults.AuthHeader,
			DevOnly:     true,
		},
		"auth_value": {
			ID:          "auth_value",
			Label:       "Auth Value",
			Description: "HTTP header value for authentication (e.g., Basic <base64>)",
			Type:        settings.Password,
			Default:     defaults.AuthValue,
			Sensitive:   true,
			DevOnly:     true,
		},
	}
}

//nolint:gochecknoglobals // we're providing this as a package level variable
var Telemetry = settings.Category{
	ID:          "telemetry",
	Label:       "Telemetry",
	Description: "Configure observability, logging, tracing, metrics, and profiling",
	Icon:        "LuActivity",
	Settings:    buildTelemetrySettings(false),
}
