package telemetry

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
