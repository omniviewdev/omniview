package categories

import "github.com/omniviewdev/plugin-sdk/settings"

//nolint:gochecknoglobals // we're providing this as a package level variable
var Telemetry = settings.Category{
	ID:          "telemetry",
	Label:       "Telemetry",
	Description: "Configure observability, logging, tracing, metrics, and profiling",
	Icon:        "LuActivity",
	Settings: map[string]settings.Setting{
		"enabled": {
			ID:          "enabled",
			Label:       "Enable Telemetry",
			Description: "Master switch for all telemetry export. When off, no data is shipped externally.",
			Type:        settings.Toggle,
			Default:     false,
		},
		"traces": {
			ID:          "traces",
			Label:       "Traces",
			Description: "Enable distributed tracing via OpenTelemetry",
			Type:        settings.Toggle,
			Default:     true,
		},
		"metrics": {
			ID:          "metrics",
			Label:       "Metrics",
			Description: "Enable metrics collection via OpenTelemetry",
			Type:        settings.Toggle,
			Default:     true,
		},
		"logs_ship": {
			ID:          "logs_ship",
			Label:       "Ship Logs",
			Description: "Ship logs to Grafana via OTLP (local log files are always written regardless)",
			Type:        settings.Toggle,
			Default:     true,
		},
		"logs_ship_level": {
			ID:          "logs_ship_level",
			Label:       "Log Ship Level",
			Description: "Minimum log level to ship externally (debug, info, warn, error)",
			Type:        settings.Text,
			Default:     "warn",
		},
		"profiling": {
			ID:          "profiling",
			Label:       "Continuous Profiling",
			Description: "Enable continuous profiling via Pyroscope (CPU, memory, goroutines)",
			Type:        settings.Toggle,
			Default:     false,
		},
		"endpoint_otlp": {
			ID:          "endpoint_otlp",
			Label:       "OTLP Endpoint",
			Description: "OTLP HTTP endpoint for traces, metrics, and logs (e.g., localhost:4318)",
			Type:        settings.Text,
			Default:     "",
		},
		"endpoint_pyroscope": {
			ID:          "endpoint_pyroscope",
			Label:       "Pyroscope Endpoint",
			Description: "Pyroscope endpoint for continuous profiling (e.g., localhost:4040)",
			Type:        settings.Text,
			Default:     "",
		},
		"auth_header": {
			ID:          "auth_header",
			Label:       "Auth Header",
			Description: "HTTP header name for authentication (e.g., Authorization for Grafana Cloud)",
			Type:        settings.Text,
			Default:     "",
		},
		"auth_value": {
			ID:          "auth_value",
			Label:       "Auth Value",
			Description: "HTTP header value for authentication (e.g., Basic <base64>)",
			Type:        settings.Text,
			Default:     "",
		},
	},
}
