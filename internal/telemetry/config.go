package telemetry

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

// Build-time defaults injected via ldflags (e.g. -X ...config.buildOTLPEndpoint=...).
// These are used as production defaults so that secrets like Grafana Cloud
// credentials never appear in source.
var (
	buildOTLPEndpoint      string // e.g. "https://otlp-gateway-prod-us-central-0.grafana.net/otlp"
	buildPyroscopeEndpoint string // e.g. "https://profiles-prod-us-central-0.grafana.net"
	buildAuthHeader        string // e.g. "Authorization"
	buildAuthValue         string // e.g. "Basic <base64>"
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
	return TelemetryConfig{
		Enabled:           false,
		Traces:            true,
		Metrics:           true,
		LogsShip:          true,
		LogsShipLevel:     "warn",
		Profiling:         false,
		OTLPEndpoint:      buildOTLPEndpoint,
		PyroscopeEndpoint: buildPyroscopeEndpoint,
		AuthHeader:        buildAuthHeader,
		AuthValue:         buildAuthValue,
	}
}
