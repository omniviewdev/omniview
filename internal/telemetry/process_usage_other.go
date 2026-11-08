//go:build !darwin && !linux

package telemetry

// Unsupported platforms omit OS observations rather than inventing zero usage.
func processUsage() (user, system float64, peakRSS int64, ok bool) {
	return 0, 0, 0, false
}
