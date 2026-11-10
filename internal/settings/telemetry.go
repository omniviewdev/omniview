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
			Description: "Ship host logs using the selected log format. Local logs are always written.",
			Type:        settings.Toggle,
			Default:     defaults.LogsShip,
		},
		"logs_format": {
			ID:          "logs_format",
			Label:       "Log Export Format",
			Description: "Choose OTLP or the native Loki push API for shipped host logs.",
			Type:        settings.Text,
			Default:     defaults.LogFormat,
			Options: []settings.SettingOption{
				{Value: "otlp", Label: "OpenTelemetry (OTLP)"},
				{Value: "loki", Label: "Loki"},
			},
			Validator: func(v any) settings.ValidationResult {
				s, ok := v.(string)
				if !ok || (s != "otlp" && s != "loki") {
					return settings.ValidationResult{Code: "log_format", Message: "Choose a log export format: otlp or loki."}
				}
				return settings.ValidationResult{Valid: true, Code: "log_format", Message: "Log export format is valid."}
			},
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
			Label:       "OTLP Traces and Metrics Endpoint",
			Description: "OTLP HTTP endpoint for traces and metrics (e.g., localhost:4318). Also used for OTLP logs when the OTLP log endpoint is empty.",
			Type:        settings.Text,
			Default:     defaults.OTLPEndpoint,
		},
		"endpoint_otlp_logs": {
			ID:          "endpoint_otlp_logs",
			Label:       "OTLP Log Endpoint",
			Description: "Optional OTLP HTTP endpoint for logs. When empty, logs reuse the traces and metrics endpoint and authentication.",
			Type:        settings.Text,
			Default:     defaults.OTLPLogEndpoint,
		},
		"otlp_logs_tenant_id": {
			ID:          "otlp_logs_tenant_id",
			Label:       "OTLP Log Tenant ID",
			Description: "Optional X-Scope-OrgID header for OTLP logs.",
			Type:        settings.Text,
			Default:     defaults.OTLPLogTenantID,
		},
		"otlp_logs_auth_header": {
			ID:          "otlp_logs_auth_header",
			Label:       "OTLP Log Auth Header",
			Description: "Optional HTTP authentication header name for a separate OTLP log endpoint.",
			Type:        settings.Text,
			Default:     defaults.OTLPLogAuthHeader,
		},
		"otlp_logs_auth_value": {
			ID:          "otlp_logs_auth_value",
			Label:       "OTLP Log Auth Value",
			Description: "Optional HTTP authentication header value for a separate OTLP log endpoint.",
			Type:        settings.Password,
			Default:     defaults.OTLPLogAuthValue,
			Sensitive:   true,
		},
		"endpoint_loki": {
			ID:          "endpoint_loki",
			Label:       "Loki Log Endpoint",
			Description: "Full Loki push URL, for example https://loki.example.com/loki/api/v1/push. Required when shipping logs in Loki format.",
			Type:        settings.Text,
			Default:     defaults.LokiEndpoint,
		},
		"loki_tenant_id": {
			ID:          "loki_tenant_id",
			Label:       "Loki Tenant ID",
			Description: "Optional Loki tenant sent in the X-Scope-OrgID header.",
			Type:        settings.Text,
			Default:     defaults.LokiTenantID,
		},
		"loki_auth_header": {
			ID:          "loki_auth_header",
			Label:       "Loki Auth Header",
			Description: "Optional HTTP authentication header name for Loki.",
			Type:        settings.Text,
			Default:     defaults.LokiAuthHeader,
		},
		"loki_auth_value": {
			ID:          "loki_auth_value",
			Label:       "Loki Auth Value",
			Description: "Optional HTTP authentication header value for Loki.",
			Type:        settings.Password,
			Default:     defaults.LokiAuthValue,
			Sensitive:   true,
		},
		"endpoint_pyroscope": {
			ID:          "endpoint_pyroscope",
			Label:       "Pyroscope Endpoint",
			Description: "Pyroscope endpoint for continuous profiling (e.g., localhost:4040)",
			Type:        settings.Text,
			Default:     defaults.PyroscopeEndpoint,
		},
		"auth_header": {
			ID:          "auth_header",
			Label:       "OTLP Traces and Metrics Auth Header",
			Description: "HTTP authentication header name for traces and metrics. Also used for OTLP logs when the OTLP log endpoint is empty.",
			Type:        settings.Text,
			Default:     defaults.AuthHeader,
		},
		"auth_value": {
			ID:          "auth_value",
			Label:       "OTLP Traces and Metrics Auth Value",
			Description: "HTTP authentication header value for traces and metrics. Also used for OTLP logs when the OTLP log endpoint is empty.",
			Type:        settings.Password,
			Default:     defaults.AuthValue,
			Sensitive:   true,
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
