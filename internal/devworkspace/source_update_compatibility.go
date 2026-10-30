package devworkspace

import "github.com/omniviewdev/omniview/internal/devcontract"

// requireSourceUpdateSupervisor accepts capability evidence only from the live
// status response. Saved launch history cannot authorize a source mutation.
func (m *Manager) requireSourceUpdateSupervisor(w Workspace, status Status) error {
	switch status.Phase {
	case "", "created", sourceUpdateStopped, refreshCrashed:
		return nil
	}
	if status.SourceUpdateSupported {
		return nil
	}
	// Restart loads the complete saved LaunchOptions itself. Supplying launch
	// flags here could override saved explicit false values or trust settings.
	argv := []string{"omniview-dev", "workspace", "restart", w.Manifest.WorkspaceID, "--root", m.Root}
	command := shellCommand(argv)
	err := devcontract.Fail(sourceUpdateConflictExitCode, "supervisor_upgrade_required",
		"running supervisor does not support source updates; "+
			"restart it with the current omniview-dev CLI using saved launch options, then retry: "+command)
	err.Details = map[string]any{"nextArgv": argv, "nextCommand": command}
	return err
}
