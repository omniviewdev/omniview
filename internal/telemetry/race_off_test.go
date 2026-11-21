//go:build !race

package telemetry

import "testing"

// skipAllocationCountsUnderTheRaceDetector does nothing in a normal run (race_on_test.go).
func skipAllocationCountsUnderTheRaceDetector(t *testing.T) {
	t.Helper()
}
