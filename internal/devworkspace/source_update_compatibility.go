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
	if status.PluginRuntime == PluginRuntimeArchive {
		// Nothing is captured: stop first, then the stopped-workspace update
		// path applies the same plan without a live supervisor.
		down := []string{"omniview-dev", "workspace", "down", w.Manifest.WorkspaceID, "--root", m.Root}
		err := devcontract.Fail(sourceUpdateConflictExitCode, "archive_runtime_source_update",
			"a running archive plugin runtime cannot apply source updates in place; stop it with: "+shellCommand(down)+
				", repeat the update on the stopped workspace, then run workspace up (saved options keep the archive runtime)")
		err.Details = map[string]any{"nextArgv": down, "nextCommand": shellCommand(down)}
		return err
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
