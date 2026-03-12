package telemetry

import "encoding/base64"

// basicAuth returns the base64 encoding of "user:password".
func basicAuth(user, password string) string {
	return base64.StdEncoding.EncodeToString([]byte(user + ":" + password))
}

// validLogLevelList is the single canonical, ordered list of accepted log levels.
var validLogLevelList = []string{"debug", "info", "warn", "error"}

// validLogLevelSet is derived from validLogLevelList for O(1) lookups.
var validLogLevelSet map[string]struct{}

func init() {
	validLogLevelSet = make(map[string]struct{}, len(validLogLevelList))
	for _, l := range validLogLevelList {
		validLogLevelSet[l] = struct{}{}
	}
}

// GetValidLogLevels returns a copy of the accepted log level strings.
func GetValidLogLevels() []string {
	out := make([]string, len(validLogLevelList))
	copy(out, validLogLevelList)
	return out
}

// IsValidLogLevel reports whether s is a recognized log level.
func IsValidLogLevel(s string) bool {
	_, ok := validLogLevelSet[s]
	return ok
}

// Build-time defaults injected via ldflags (e.g. -X ...buildOTLPEndpoint=...).
// These are used as production defaults so that secrets like Grafana Cloud
// credentials never appear in source.
//
// Note: ldflags values cannot contain spaces, so we store the base64-encoded
// credentials (instanceID:token) separately and construct "Basic <creds>" at
// runtime.
var (
	buildOTLPEndpoint      string // e.g. "https://otlp-gateway-prod-us-east-2.grafana.net/otlp"
	buildPyroscopeEndpoint string // e.g. "https://profiles-prod-001.grafana.net"
	buildGrafanaUser       string // e.g. "1538466"
	buildGrafanaToken      string // e.g. "glc_eyJ..."
)

// TelemetryConfig holds all telemetry-related configuration.
type TelemetryConfig struct {
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
	// GrafanaUser and GrafanaToken are used for Pyroscope basic auth
	// (Grafana Cloud requires instanceID + API token). These are also
	// used to derive the OTLP Authorization header when set via build flags.
	GrafanaUser  string
	GrafanaToken string
}

// DefaultConfig returns sensible defaults based on whether the app is running
// in development mode or production mode.
func DefaultConfig(isDev bool) TelemetryConfig {
	if isDev {
		return TelemetryConfig{
			Enabled:           false,
			Traces:            true,
			Metrics:           true,
			LogsShip:          true,
			LogsShipLevel:     "debug",
			Profiling:         true,
			OTLPEndpoint:      "localhost:4318",
			PyroscopeEndpoint: "localhost:4040",
		}
	}
	cfg := TelemetryConfig{
		Enabled:           false,
		Traces:            true,
		Metrics:           true,
		LogsShip:          true,
		LogsShipLevel:     "warn",
		Profiling:         false,
		OTLPEndpoint:      buildOTLPEndpoint,
		PyroscopeEndpoint: buildPyroscopeEndpoint,
	}
	if buildGrafanaUser != "" && buildGrafanaToken != "" {
		cfg.GrafanaUser = buildGrafanaUser
		cfg.GrafanaToken = buildGrafanaToken
		cfg.AuthHeader = "Authorization"
		cfg.AuthValue = "Basic " + basicAuth(buildGrafanaUser, buildGrafanaToken)
	}
	return cfg
}
