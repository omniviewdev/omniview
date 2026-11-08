//go:build darwin || linux

package telemetry

import (
	"runtime"

	"golang.org/x/sys/unix"
)

// getrusage reports actual process CPU consumed, not scheduler capacity.
// Darwin reports ru_maxrss in bytes; Linux reports KiB.
func processUsage() (user, system float64, peakRSS int64, ok bool) {
	var usage unix.Rusage
	if err := unix.Getrusage(unix.RUSAGE_SELF, &usage); err != nil {
		return 0, 0, 0, false
	}
	user = float64(usage.Utime.Sec) + float64(usage.Utime.Usec)/1e6
	system = float64(usage.Stime.Sec) + float64(usage.Stime.Usec)/1e6
	peakRSS = usage.Maxrss
	if runtime.GOOS == "linux" {
		peakRSS *= 1024
	}
	return user, system, peakRSS, true
}
