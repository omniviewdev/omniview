package devserver

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func explicitPNPMSettings(program string) pkgsettings.Provider {
	return pkgsettings.NewProvider(pkgsettings.ProviderOpts{
		Logger: nil, PluginID: "",
		PluginSettings: []pkgsettings.Category{{
			ID: "developer",
			Settings: map[string]pkgsettings.Setting{
				"pnpmpath": {ID: "pnpmpath", Type: pkgsettings.Text, Default: program, Value: program},
			},
		}},
	})
}

func commandWorkspace(t *testing.T) (*DevServerManager, PNPMCommand) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	source := filepath.Join(root, "plugin")
	require.NoError(t, os.Mkdir(source, 0700))
	executable, err := os.Executable()
	require.NoError(t, err)
	manager := newTestManager(t)
	manager.workspace = &devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{Repositories: []devcontract.Repository{{ID: "plugin", Directory: "plugin"}}, Plugins: []devcontract.Plugin{{ID: "same", RepositoryID: "plugin"}}}}
	return manager, PNPMCommand{Source: source, Program: executable, Args: []string{"pnpm.cjs"}, WorkspaceRoot: root, Version: "12.14.0"}
}

func TestConfiguredPNPMCommandsRejectReboundSourceEvenWithExplicitOverride(t *testing.T) {
	manager, command := commandWorkspace(t)
	require.NoError(t, manager.ConfigurePNPMCommands(map[string]PNPMCommand{"same": command}))
	second := managedSourceFixture(t, "same")
	options := manager.resolveBuildOpts()
	require.ErrorContains(t, manager.applyPNPMCommand("same", second, &options), "reconfigure")
	require.ErrorContains(t, manager.applyPNPMCommand("missing", second, &options), "reconfigure")
	manager.settingsProvider = explicitPNPMSettings(command.Program)
	options = manager.resolveBuildOpts()
	require.ErrorContains(t, manager.applyPNPMCommand("same", second, &options), "reconfigure")
}

func TestManagedPNPMRejectsExecutableOverrideThatBypassesOwnedContext(t *testing.T) {
	manager, command := commandWorkspace(t)
	require.NoError(t, manager.ConfigurePNPMCommands(map[string]PNPMCommand{"same": command}))
	manager.settingsProvider = explicitPNPMSettings(command.Program)
	options := manager.resolveBuildOpts()
	require.ErrorContains(t, manager.applyPNPMCommand("same", command.Source, &options), "OMNIVIEW_PNPM_EXECUTABLE")
}

func TestConfiguredPNPMCommandsRejectPartialOrForeignCompositionContext(t *testing.T) {
	for _, mutate := range []func(*PNPMCommand){
		func(c *PNPMCommand) { c.WorkspaceRoot = "" },
		func(c *PNPMCommand) { c.WorkspaceRoot = t.TempDir() },
		func(c *PNPMCommand) { c.Version = "10.34.7" },
		func(c *PNPMCommand) { c.Version = "" },
		func(c *PNPMCommand) { c.Source = t.TempDir() },
		func(c *PNPMCommand) { c.Program = "relative-node" },
		func(c *PNPMCommand) { c.Args = nil },
	} {
		manager, command := commandWorkspace(t)
		mutate(&command)
		require.Error(t, manager.ConfigurePNPMCommands(map[string]PNPMCommand{"same": command}))
		require.Empty(t, manager.pnpmCommands, "invalid context must not partially publish commands")
	}
}

func TestConfiguredPNPMCommandsRequireStartup(t *testing.T) {
	manager, command := commandWorkspace(t)
	instance, _, _ := newTestInstance(t, "active")
	manager.instances["active"] = instance
	require.ErrorContains(t, manager.ConfigurePNPMCommands(map[string]PNPMCommand{"same": command}), "before")
}
