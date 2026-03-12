package telemetry

// validLogLevels is the canonical set of accepted log level strings.
var validLogLevels = map[string]struct{}{
	"debug": {},
	"info":  {},
	"warn":  {},
	"error": {},
}

// GetValidLogLevels returns a copy of the accepted log level strings.
func GetValidLogLevels() []string {
	return []string{"debug", "info", "warn", "error"}
}

// IsValidLogLevel reports whether s is a recognized log level.
func IsValidLogLevel(s string) bool {
	_, ok := validLogLevels[s]
	return ok
}

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
			Enabled:           true,
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
		Enabled:       false,
		Traces:        true,
		Metrics:       true,
		LogsShip:      true,
		LogsShipLevel: "warn",
		Profiling:     false,
	}
}
