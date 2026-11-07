//go:build !darwin && !linux

package telemetry

// readProcessUsage is unavailable on this platform: plugins report no process
// usage rather than zero.
func readProcessUsage([]int) map[int]pluginUsage { return nil }
