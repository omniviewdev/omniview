package lifecycle

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsValidTransition_HappyPath(t *testing.T) {
	cases := []struct {
		from, to PluginPhase
	}{
		{PhaseUninstalled, PhaseInstalling},
		{PhaseInstalling, PhaseInstalled},
		{PhaseInstalling, PhaseFailed},
		{PhaseInstalled, PhaseBuilding},
		{PhaseInstalled, PhaseValidating},
		{PhaseBuilding, PhaseValidating},
		{PhaseBuilding, PhaseBuildFailed},
		{PhaseValidating, PhaseStarting},
		{PhaseStarting, PhaseRunning},
		{PhaseStarting, PhaseFailed},
		{PhaseRunning, PhaseStopping},
		{PhaseRunning, PhaseDegraded},
		{PhaseRunning, PhaseRecovering},
		{PhaseDegraded, PhaseRecovering},
		{PhaseRecovering, PhaseValidating},
		{PhaseRecovering, PhaseFailed},
		{PhaseStopping, PhaseStopped},
		{PhaseStopped, PhaseValidating},
		{PhaseStopped, PhaseUninstalling},
		{PhaseFailed, PhaseValidating},
		{PhaseFailed, PhaseBuilding},
		{PhaseFailed, PhaseUninstalling},
		{PhaseUninstalling, PhaseUninstalled},
	}

	for _, tc := range cases {
		assert.True(t, IsValidTransition(tc.from, tc.to),
			"expected %s → %s to be valid", tc.from, tc.to)
	}
}

func TestIsValidTransition_Invalid(t *testing.T) {
	cases := []struct {
		from, to PluginPhase
	}{
		{PhaseRunning, PhaseInstalling},
		{PhaseUninstalled, PhaseRunning},
		{PhaseStopped, PhaseBuilding},
		{PhaseStarting, PhaseInstalled},
		{PhaseBuilding, PhaseRunning}, // must go through Validating
	}

	for _, tc := range cases {
		assert.False(t, IsValidTransition(tc.from, tc.to),
			"expected %s → %s to be invalid", tc.from, tc.to)
	}
}

func TestIsTerminal(t *testing.T) {
	terminals := []PluginPhase{PhaseRunning, PhaseStopped, PhaseFailed, PhaseBuildFailed, PhaseUninstalled}
	nonTerminals := []PluginPhase{PhaseInstalling, PhaseInstalled, PhaseBuilding, PhaseValidating,
		PhaseStarting, PhaseDegraded, PhaseRecovering, PhaseStopping, PhaseUninstalling}

	for _, p := range terminals {
		assert.True(t, p.IsTerminal(), "%s should be terminal", p)
	}
	for _, p := range nonTerminals {
		assert.False(t, p.IsTerminal(), "%s should not be terminal", p)
	}
}

func TestIsActive(t *testing.T) {
	assert.True(t, PhaseRunning.IsActive())
	assert.True(t, PhaseDegraded.IsActive())
	assert.False(t, PhaseStopped.IsActive())
	assert.False(t, PhaseFailed.IsActive())
	assert.False(t, PhaseStarting.IsActive())
}
