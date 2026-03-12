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
