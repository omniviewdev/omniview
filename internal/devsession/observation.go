package devsession

import (
	"fmt"
	"path/filepath"
)

// ProcessObservation identifies one sampled process lifetime. It carries no
// ownership provenance and never authorizes lifecycle operations or signaling.
type ProcessObservation struct {
	PID           int    `json:"pid"`
	StartIdentity string `json:"startIdentity"`
	Executable    string `json:"executable"`
}

// ObserveProcess reads kernel identity without adopting the process as owned.
// The platform reader fences executable lookup with process-start observations.
func ObserveProcess(pid int) (ProcessObservation, error) {
	if pid <= 0 {
		return ProcessObservation{}, fmt.Errorf("%w: process PID must be positive", ErrUnsupportedIdentity)
	}
	start, executable, err := inspectProcess(pid)
	if err != nil {
		return ProcessObservation{}, err
	}
	if start == "" || !filepath.IsAbs(executable) {
		return ProcessObservation{}, fmt.Errorf("%w: incomplete kernel identity", ErrUnsupportedIdentity)
	}
	return ProcessObservation{PID: pid, StartIdentity: start, Executable: executable}, nil
}
