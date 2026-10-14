package telemetry

import "slices"

// Accepted log level names.
const (
	levelDebug = "debug"
	levelInfo  = "info"
	levelWarn  = "warn"
	levelError = "error"
)

// validLogLevels returns the single canonical, ordered list of accepted log levels.
func validLogLevels() []string {
	return []string{levelDebug, levelInfo, levelWarn, levelError}
}

// GetValidLogLevels returns a copy of the accepted log level strings.
func GetValidLogLevels() []string {
	return validLogLevels()
}

// IsValidLogLevel reports whether s is a recognized log level.
func IsValidLogLevel(s string) bool {
	return slices.Contains(validLogLevels(), s)
}

// Build-time defaults injected via ldflags (e.g. -X ...buildOTLPEndpoint=...).
var (
	buildOTLPEndpoint      string // e.g. "https://otlp-gateway-prod-us-east-2.grafana.net/otlp"
	buildPyroscopeEndpoint string // e.g. "https://profiles-prod-001.grafana.net"
)

// Config holds all telemetry-related configuration.
// AuthHeader/AuthValue are set at runtime via the settings UI, never at build time.
type Config struct {
	Enabled           bool
	Traces            bool
	Metrics           bool
	LogsShip          bool
	LogsShipLevel     string
	Profiling         bool
	OTLPEndpoint      string
	PyroscopeEndpoint string
	AuthHeader        string
	AuthValue         string
}

// orDefault returns s if non-empty, otherwise fallback.
func orDefault(s, fallback string) string {
	if s != "" {
		return s
	}
	return fallback
}

// DefaultConfig returns sensible defaults based on whether the app is running
// in development mode or production mode.
func DefaultConfig(isDev bool) Config {
	if isDev {
		return Config{
			Enabled:           false,
			Traces:            true,
			Metrics:           true,
			LogsShip:          true,
			LogsShipLevel:     levelDebug,
			Profiling:         true,
			OTLPEndpoint:      orDefault(buildOTLPEndpoint, "localhost:4318"),
			PyroscopeEndpoint: orDefault(buildPyroscopeEndpoint, "localhost:4040"),
			AuthHeader:        "",
			AuthValue:         "",
		}
	}
	return Config{
		Enabled:           false,
		Traces:            true,
		Metrics:           true,
		LogsShip:          true,
		LogsShipLevel:     levelWarn,
		Profiling:         false,
		OTLPEndpoint:      buildOTLPEndpoint,
		PyroscopeEndpoint: buildPyroscopeEndpoint,
		AuthHeader:        "",
		AuthValue:         "",
	}
}

// WithSettings returns a copy of c with the values of the "telemetry" settings
// category overlaid. Keys that are missing or have the wrong type are ignored.
func (c Config) WithSettings(vals map[string]any) Config {
	if v, ok := vals["enabled"].(bool); ok {
		c.Enabled = v
	}
	if v, ok := vals["traces"].(bool); ok {
		c.Traces = v
	}
	if v, ok := vals["metrics"].(bool); ok {
		c.Metrics = v
	}
	if v, ok := vals["logs_ship"].(bool); ok {
		c.LogsShip = v
	}
	if v, ok := vals["logs_ship_level"].(string); ok {
		c.LogsShipLevel = v
	}
	if v, ok := vals["profiling"].(bool); ok {
		c.Profiling = v
	}
	if v, ok := vals["endpoint_otlp"].(string); ok {
		c.OTLPEndpoint = v
	}
	if v, ok := vals["endpoint_pyroscope"].(string); ok {
		c.PyroscopeEndpoint = v
	}
	if v, ok := vals["auth_header"].(string); ok {
		c.AuthHeader = v
	}
	if v, ok := vals["auth_value"].(string); ok {
		c.AuthValue = v
	}
	return c
}
