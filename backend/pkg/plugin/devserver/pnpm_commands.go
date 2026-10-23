package devserver

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

// PNPMCommand is a concrete native program plus an owned pnpm runner prefix,
// bound to one canonical plugin source. Args excludes the task arguments.
type PNPMCommand struct {
	Program       string   `json:"program"`
	Args          []string `json:"args"`
	Source        string   `json:"source"`
	WorkspaceRoot string   `json:"workspaceRoot"`
	Version       string   `json:"version"`
}

// ConfigurePNPMCommands runs after ConfigureWorkspace and before managed starts.
// The launcher supplies one exact packageManager runner for each selected UI
// plugin; no global pin, shell command string or devworkspace import is needed.
func (manager *DevServerManager) ConfigurePNPMCommands(commands map[string]PNPMCommand) error {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.workspace == nil {
		return fmt.Errorf("configure pnpm commands after the resolved workspace")
	}
	if len(manager.instances) != 0 {
		return fmt.Errorf("configure pnpm commands before starting managed plugins")
	}
	configured := make(map[string]PNPMCommand, len(commands))
	for id, command := range commands {
		if strings.TrimSpace(id) == "" || !filepath.IsAbs(command.Source) || !filepath.IsAbs(command.Program) || len(command.Args) == 0 {
			return fmt.Errorf("plugin %s requires an absolute source/native program and pnpm argument prefix", id)
		}
		root, err := devcontract.CanonicalPath(command.WorkspaceRoot)
		if err != nil || root != command.WorkspaceRoot || root != manager.workspace.Root || command.Version != devcompose.Version {
			return fmt.Errorf("plugin %s requires the exact selected native12 composition context", id)
		}
		source, err := filepath.EvalSymlinks(command.Source)
		if err != nil {
			return fmt.Errorf("plugin %s pnpm source: %w", id, err)
		}
		selected := false
		for _, plugin := range manager.workspace.Manifest.Plugins {
			if plugin.ID != id {
				continue
			}
			expected, err := manager.workspace.RepositoryPath(plugin.RepositoryID)
			if err != nil {
				return err
			}
			selected = source == expected && source == command.Source
			break
		}
		if !selected {
			return fmt.Errorf("plugin %s pnpm source is not the exact selected repository; reconfigure workspace", id)
		}
		program, err := exec.LookPath(command.Program)
		if err != nil {
			return fmt.Errorf("plugin %s pnpm native program: %w", id, err)
		}
		extension := filepath.Ext(program)
		if strings.EqualFold(extension, ".cmd") || strings.EqualFold(extension, ".bat") {
			return fmt.Errorf("plugin %s pnpm program must be a native executable, not a shell wrapper", id)
		}
		for _, argument := range command.Args {
			if strings.ContainsRune(argument, '\x00') {
				return fmt.Errorf("plugin %s pnpm argument contains NUL", id)
			}
		}
		command.Program, command.Source = program, source
		command.Args = slices.Clone(command.Args)
		configured[id] = command
	}
	manager.pnpmCommands = configured
	return nil
}

// applyPNPMCommand requires manager.mu or startup-only ownership; source is
// already canonicalized by startDevServer. Explicit Node overrides are retained.
func (manager *DevServerManager) applyPNPMCommand(id, source string, options *BuildOpts) error {
	if manager.workspace != nil {
		command, exists := manager.pnpmCommands[id]
		if !exists || command.Source != source || command.WorkspaceRoot != manager.workspace.Root || command.Version != devcompose.Version {
			return fmt.Errorf("plugin %s source has no matching selected native12 composition command; reconfigure workspace before starting or rebinding", id)
		}
		if options.ExplicitPnpmPath != "" {
			return fmt.Errorf("managed plugins require the owned pnpm launcher; select native12 through OMNIVIEW_PNPM_EXECUTABLE when starting the workspace instead of developer.pnpmpath")
		}
		options.PnpmPath = command.Program
		options.PnpmArgs = slices.Clone(command.Args)
		if options.ExplicitNodePath != "" {
			options.PnpmPath = options.ExplicitNodePath
		} else {
			options.NodePath = command.Program
		}
	}
	if options.ExplicitPnpmPath != "" {
		options.PnpmPath = options.ExplicitPnpmPath
		options.PnpmArgs = nil
	}
	return nil
}

func compositionEnvironment(environment []string, root string) []string {
	result := make([]string, 0, len(environment)+1)
	for _, entry := range environment {
		key, _, _ := strings.Cut(entry, "=")
		if strings.EqualFold(key, "PNPM_CONFIG_WORKSPACE_DIR") || strings.EqualFold(key, "NPM_CONFIG_WORKSPACE_DIR") || strings.EqualFold(key, "OMNIVIEW_PNPM_NODE_PATH") {
			continue
		}
		result = append(result, entry)
	}
	return append(result, devcompose.RootEnvironment+"="+root)
}
