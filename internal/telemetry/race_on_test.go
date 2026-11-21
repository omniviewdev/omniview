//go:build race

package telemetry

import "testing"

// skipAllocationCountsUnderTheRaceDetector skips a test that counts allocations: under
// the race detector sync.Pool discards a quarter of what is put in it, and the pools of
// zap and of encoding/json, which a log call goes through, are not what they are in a
// normal run.
func skipAllocationCountsUnderTheRaceDetector(t *testing.T) {
	t.Helper()
	t.Skip("sync.Pool discards items under the race detector, so allocation counts are not those of a normal run")
}
