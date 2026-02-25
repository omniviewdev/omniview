package lifecycle

import (
	"slices"
	"time"
)

// PluginPhase represents the current lifecycle state of a plugin.
type PluginPhase string

const (
	PhaseUninstalled PluginPhase = "Uninstalled"
	PhaseInstalling  PluginPhase = "Installing"
	PhaseInstalled   PluginPhase = "Installed"
	PhaseBuilding    PluginPhase = "Building"    // dev only: initial go build
	PhaseBuildFailed PluginPhase = "BuildFailed" // dev only: build error
	PhaseValidating  PluginPhase = "Validating"
	PhaseStarting    PluginPhase = "Starting"
	PhaseRunning     PluginPhase = "Running"
	PhaseDegraded    PluginPhase = "Degraded"
	PhaseRecovering  PluginPhase = "Recovering"
	PhaseStopping    PluginPhase = "Stopping"
	PhaseStopped     PluginPhase = "Stopped"
	PhaseFailed      PluginPhase = "Failed"
	PhaseUninstalling PluginPhase = "Uninstalling"
)

// Transition records a state change for audit/debugging.
type Transition struct {
	From      PluginPhase `json:"from"`
	To        PluginPhase `json:"to"`
	Reason    string      `json:"reason"`
	Timestamp time.Time   `json:"timestamp"`
}

// validTransitions defines which phase changes are allowed.
var validTransitions = map[PluginPhase][]PluginPhase{
	PhaseUninstalled: {PhaseInstalling},
	PhaseInstalling:  {PhaseInstalled, PhaseFailed},
	PhaseInstalled:   {PhaseBuilding, PhaseValidating, PhaseUninstalling, PhaseStopped},
	PhaseBuilding:    {PhaseValidating, PhaseBuildFailed, PhaseFailed},
	PhaseBuildFailed: {PhaseBuilding, PhaseFailed, PhaseUninstalling},
	PhaseValidating:  {PhaseStarting, PhaseFailed, PhaseInstalled},
	PhaseStarting:    {PhaseRunning, PhaseFailed, PhaseDegraded},
	PhaseRunning:     {PhaseStopping, PhaseDegraded, PhaseFailed, PhaseRecovering, PhaseValidating},
	PhaseDegraded:    {PhaseRecovering, PhaseStopping, PhaseFailed},
	PhaseRecovering:  {PhaseValidating, PhaseFailed},
	PhaseStopping:    {PhaseStopped, PhaseFailed},
	PhaseStopped:     {PhaseValidating, PhaseStarting, PhaseUninstalling, PhaseInstalled},
	PhaseFailed:      {PhaseValidating, PhaseBuilding, PhaseUninstalling, PhaseInstalled},
	PhaseUninstalling: {PhaseUninstalled, PhaseFailed},
}

// IsValidTransition checks if moving from 'from' to 'to' is allowed.
func IsValidTransition(from, to PluginPhase) bool {
	allowed, ok := validTransitions[from]
	if !ok {
		return false
	}
	return slices.Contains(allowed, to)
}

// IsTerminal returns true if the phase is a terminal resting state.
func (p PluginPhase) IsTerminal() bool {
	switch p {
	case PhaseRunning, PhaseStopped, PhaseFailed, PhaseBuildFailed, PhaseUninstalled:
		return true
	default:
		return false
	}
}

// IsActive returns true if the plugin process should be running.
func (p PluginPhase) IsActive() bool {
	switch p {
	case PhaseRunning, PhaseDegraded:
		return true
	default:
		return false
	}
}
