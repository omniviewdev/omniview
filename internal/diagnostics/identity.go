package diagnostics

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"runtime/debug"
)

const configScope = "telemetry enablement/metrics/tracing/profiling toggles, remote export cadence, and local collection interval/history/metric/series/byte bounds; not application settings or workload fingerprint"

// SourceState reports build-time VCS evidence, never the current working tree.
// An unknown result means the binary contains no vcs.modified build setting.
func SourceState() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, setting := range info.Settings {
		if setting.Key != "vcs.modified" {
			continue
		}
		switch setting.Value {
		case "true":
			return "modified"
		case "false":
			return "clean"
		}
	}
	return "unknown"
}
func (s *Service) configIdentity(id string) string {
	return fmt.Sprintf("%s:interval_ns=%d:remote_interval_ns=%d:history=%d:metrics=128:series=16:sample_bytes=262144", id, s.opts.Interval.Nanoseconds(), s.opts.RemoteInterval.Nanoseconds(), s.opts.HistoryLimit)
}

func newSessionID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}
