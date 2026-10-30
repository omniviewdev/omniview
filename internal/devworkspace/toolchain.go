package devworkspace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcompose"
)

type pnpmLauncherFile struct {
	Name string
	Data []byte
	Mode os.FileMode
}
type pnpmToolchain struct {
	directory, node, script string
	files                   []pnpmLauncherFile
}

// PNPMCommand preserves the consumer's argv and actual cwd. Its private Node
// launcher dispatches only exact native12 and sets the validated aggregate root.
func (g *BuildGraph) PNPMCommand(ctx context.Context, pin string, args ...string) (string, []string, error) {
	tool, err := g.preparePNPMToolchain(ctx, pin)
	if err != nil {
		return "", nil, err
	}
	argv := make([]string, 1, len(args)+1)
	argv[0] = tool.script
	argv = append(argv, args...)
	return tool.node, argv, nil
}

func (g *BuildGraph) preparePNPMToolchain(ctx context.Context, pin string) (pnpmToolchain, error) {
	var empty pnpmToolchain
	if g.plan.Composition == nil {
		return empty, fmt.Errorf("pnpm requires a selected feature composition")
	}
	if err := devcompose.Validate(g.workspace.ResolvedWorkspace, *g.plan.Composition); err != nil {
		return empty, err
	}
	selected := false
	for _, root := range g.plan.Roots {
		if root.Version == pin {
			selected = true
			break
		}
	}
	if !selected || !supportedPNPMVersion(pin) {
		return empty, fmt.Errorf("pnpm pin is not an attested selected-root version: %q", pin)
	}
	if g.options.Generation == "" {
		return empty, fmt.Errorf("pinned toolchain requires the current owned generation")
	}
	g.toolchainMu.Lock()
	defer g.toolchainMu.Unlock()
	if cached, ok := g.toolchains[pin]; ok {
		if err := verifyPNPMToolchain(cached); err != nil {
			return empty, err
		}
		return cached, nil
	}
	node, err := exec.LookPath("node")
	if err == nil {
		var raw []byte
		raw, err = g.command(ctx, g.workspace.Root, node, "-p", "require('node:fs').realpathSync(process.execPath)")
		node = strings.TrimSpace(string(raw))
		if err == nil && !filepath.IsAbs(node) {
			err = fmt.Errorf("Node returned a nonabsolute executable path")
		}
	}
	if err != nil {
		return empty, fmt.Errorf("selected pnpm scripts require Node: %w", err)
	}
	manager, err := g.resolveNativePNPM(ctx, pin)
	if err != nil {
		return empty, err
	}
	files, err := nativePNPMLauncherFiles(node, manager, pin, g.plan.Composition.Root)
	if err != nil {
		return empty, err
	}
	prepared, err := PrepareGeneratedTree(g.workspace, filepath.Join("toolchains", "pnpm-"+pin), g.options.Generation)
	if err != nil {
		return empty, err
	}
	var writeErr error
	for _, file := range files {
		path := filepath.Join(prepared.Directory, file.Name)
		if writeErr = os.WriteFile(path, file.Data, file.Mode); writeErr != nil {
			break
		}
		if writeErr = os.Chmod(path, file.Mode); writeErr != nil {
			break
		}
	}
	if err = errors.Join(writeErr, RecordGeneratedTree(prepared)); err != nil {
		return empty, err
	}
	tool := pnpmToolchain{directory: prepared.Destination, node: node, script: filepath.Join(prepared.Destination, "pnpm.cjs"), files: files}
	if err = verifyPNPMToolchain(tool); err != nil {
		return empty, err
	}
	if g.toolchains == nil {
		g.toolchains = map[string]pnpmToolchain{}
	}
	g.toolchains[pin] = tool
	return tool, nil
}

func verifyPNPMToolchain(tool pnpmToolchain) error {
	for _, file := range tool.files {
		path := filepath.Join(tool.directory, file.Name)
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm() != file.Mode.Perm()) {
			return fmt.Errorf("owned pnpm launcher was replaced or changed: %s", path)
		}
		actual, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if !bytes.Equal(actual, file.Data) {
			return fmt.Errorf("owned pnpm launcher was edited outside its recorded writer: %s", path)
		}
	}
	return nil
}

// Native installs replace pnpm's extensionless npm bin with a real executable.
// Never pass that bin to Node or ask Corepack to install another manager.
// Explicit configuration names one executable, not a shell command or shim.
func (g *BuildGraph) resolveNativePNPM(ctx context.Context, pin string) (string, error) {
	selected := os.Getenv("OMNIVIEW_PNPM_EXECUTABLE")
	explicit := selected != ""
	if !explicit {
		var err error
		selected, err = exec.LookPath("pnpm")
		if err != nil {
			return "", fmt.Errorf("pnpm %s requires its installed native executable; set OMNIVIEW_PNPM_EXECUTABLE: %w", pin, err)
		}
	}
	if explicit && !filepath.IsAbs(selected) {
		return "", fmt.Errorf("OMNIVIEW_PNPM_EXECUTABLE must be one canonical absolute native executable")
	}
	absolute, err := filepath.Abs(selected)
	if err != nil {
		return "", err
	}
	actual, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	if explicit && actual != selected {
		return "", fmt.Errorf("OMNIVIEW_PNPM_EXECUTABLE must name the canonical actual native executable, not an alias")
	}
	info, err := os.Stat(actual)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0111 == 0) {
		return "", fmt.Errorf("selected pnpm is not an executable file: %s", actual)
	}
	file, err := os.Open(actual)
	if err != nil {
		return "", err
	}
	var magic [4]byte
	_, readErr := file.ReadAt(magic[:], 0)
	err = errors.Join(readErr, file.Close())
	if err != nil {
		return "", err
	}
	// ELF, PE and both endian/universal Mach-O headers. Shell, Corepack and
	// script placeholders are refused instead of relying on a shell fallback.
	header := string(magic[:])
	if header != "\x7fELF" && !strings.HasPrefix(header, "MZ") &&
		header != "\xfe\xed\xfa\xce" && header != "\xce\xfa\xed\xfe" &&
		header != "\xfe\xed\xfa\xcf" && header != "\xcf\xfa\xed\xfe" &&
		header != "\xca\xfe\xba\xbe" && header != "\xbe\xba\xfe\xca" &&
		header != "\xca\xfe\xba\xbf" && header != "\xbf\xba\xfe\xca" {
		return "", fmt.Errorf("selected pnpm must be its native executable, not a script or Corepack shim: %s", actual)
	}
	raw, err := g.commandWithEnvironment(ctx, g.workspace.Root, []string{"pnpm_config_pm_on_fail=error"}, actual, "--version")
	if err != nil {
		return "", fmt.Errorf("cannot attest installed native pnpm %s: %w", pin, err)
	}
	if strings.TrimSpace(string(raw)) != pin {
		return "", fmt.Errorf("native pnpm version mismatch: selected %s (untrusted executable output withheld)", pin)
	}
	return actual, nil
}

func workspaceRootEnvironment(key string) bool {
	key = strings.ToLower(key)
	return key == "pnpm_config_workspace_dir" || key == "npm_config_workspace_dir"
}

// compositionInstallEnvironment authorizes dependency-changing pnpm commands in
// the managed launcher. Only the recorded composition install sets it.
const compositionInstallEnvironment = "OMNIVIEW_PNPM_COMPOSITION_INSTALL"

// launcherDependencyWriteGuard refuses pnpm commands that rewrite the
// composition's node_modules. The launcher pins PNPM_CONFIG_WORKSPACE_DIR to the
// workspace root, so such a command from any directory replaces the trees the
// output journal owns, and every later lifecycle command refuses them.
const launcherDependencyWriteGuard = `const dependencyWriteCommands = new Set(['add', 'approve-builds', 'ci', 'clean-install', 'dedupe', 'deploy', 'fetch', 'i', 'import', 'install', 'install-test', 'it', 'link', 'ln', 'patch-commit', 'patch-remove', 'prune', 'rb', 'rebuild', 'remove', 'rm', 'un', 'uni', 'uninstall', 'unlink', 'up', 'update', 'upgrade']);
const optionsWithValues = new Set(['-C', '--dir', '-F', '--filter', '--filter-prod', '--reporter', '--loglevel', '--test-pattern', '--changed-files-ignore-pattern', '--workspace-concurrency']);
const requestedArgs = process.argv.slice(2);
let requestedCommand;
for (let i = 0; i < requestedArgs.length; i++) {
  if (optionsWithValues.has(requestedArgs[i])) { i++; continue; }
  if (requestedArgs[i].startsWith('-')) continue;
  requestedCommand = requestedArgs[i];
  break;
}
if (dependencyWriteCommands.has(requestedCommand) && env.` + compositionInstallEnvironment + ` !== '1') {
  console.error('pnpm ' + requestedCommand + ' would rewrite node_modules that the Omniview workspace supervisor owns in ' + workspaceRoot + '. Change dependencies through the workspace lifecycle (omniview-dev workspace refresh), and run tools from node_modules/.bin.');
  process.exit(1);
}
`

func nativePNPMLauncherFiles(node, executable, pin, root string) ([]pnpmLauncherFile, error) {
	if strings.ContainsAny(node, "\x00\r\n\"") || strings.ContainsAny(executable, "\x00\r\n") || !filepath.IsAbs(root) {
		return nil, fmt.Errorf("tool paths and composition root must be canonical absolute paths")
	}
	nodeJSON, _ := json.Marshal(node)
	executableJSON, _ := json.Marshal(executable)
	versionJSON, _ := json.Marshal(pin)
	rootJSON, _ := json.Marshal(root)
	dispatch := launcherDependencyWriteGuard +
		"for (const key of Object.keys(env)) if (key.toLowerCase() === 'pnpm_config_pm_on_fail') delete env[key];\n" +
		"env.pnpm_config_pm_on_fail = 'error';\n" +
		"const executable = " + string(executableJSON) + ";\n" +
		"const version = spawnSync(executable, ['--version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });\n" +
		"if (version.error || version.status !== 0 || version.stdout.trim() !== " + string(versionJSON) + ") throw new Error('selected native pnpm version could not be attested');\n" +
		"const args = process.argv.slice(2);\n" +
		"args.unshift('--config.verify-deps-before-run=error');\n" +
		"const result = spawnSync(executable, args, { env, stdio: 'inherit', windowsHide: true });\n"
	script := "const { spawnSync } = require('node:child_process');\nconst path = require('node:path');\nconst fs = require('node:fs');\n" +
		"const env = { ...process.env };\n" +
		"for (const key of Object.keys(env)) if (['pnpm_config_workspace_dir','npm_config_workspace_dir'].includes(key.toLowerCase())) delete env[key];\n" +
		"const workspaceRoot = " + string(rootJSON) + ";\n" +
		"if (fs.realpathSync(workspaceRoot) !== workspaceRoot || !fs.statSync(workspaceRoot).isDirectory()) throw new Error('selected composition root was redirected');\n" +
		"env.PNPM_CONFIG_WORKSPACE_DIR = workspaceRoot;\n" +
		"const selectedNode = env.OMNIVIEW_PNPM_NODE_PATH || " + string(nodeJSON) + ";\n" +
		"if (env.OMNIVIEW_PNPM_NODE_PATH) {\n" +
		"  if (!path.isAbsolute(selectedNode) || fs.realpathSync(selectedNode) !== path.resolve(selectedNode) || !fs.statSync(selectedNode).isFile()) throw new Error('OMNIVIEW_PNPM_NODE_PATH must be one canonical absolute executable');\n" +
		"  fs.accessSync(selectedNode, fs.constants.X_OK);\n" +
		"}\n" +
		"const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';\n" +
		"env[pathKey] = __dirname + path.delimiter + path.dirname(selectedNode) + path.delimiter + (env[pathKey] || '');\n" +
		dispatch +
		"if (result.error) { console.error('selected native pnpm command could not start'); process.exit(1); }\n" +
		"if (result.signal) { process.kill(process.pid, result.signal); }\n" +
		"process.exit(result.status ?? 1);\n"
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }
	posix := "#!/bin/sh\nscript_dir=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd) || exit 1\nexec " + quote(node) + " \"$script_dir/pnpm.cjs\" \"$@\"\n"
	windows := "@ECHO off\r\nSETLOCAL DisableDelayedExpansion\r\n\"" + strings.ReplaceAll(node, "%", "%%") + "\" \"%~dp0pnpm.cjs\" %*\r\n"
	nodePosix := "#!/bin/sh\n" + `if [ -n "${OMNIVIEW_PNPM_NODE_PATH:-}" ]; then
  case "$OMNIVIEW_PNPM_NODE_PATH" in
    /*|[A-Za-z]:/*|[A-Za-z]:\\*|\\\\*) ;;
    *) printf '%s\n' 'OMNIVIEW_PNPM_NODE_PATH must be absolute' >&2; exit 1 ;;
  esac
  if [ "$OMNIVIEW_PNPM_NODE_PATH" = "$0" ] || [ ! -f "$OMNIVIEW_PNPM_NODE_PATH" ] || [ ! -x "$OMNIVIEW_PNPM_NODE_PATH" ]; then
    printf '%s\n' 'OMNIVIEW_PNPM_NODE_PATH must name the actual executable, not its private forwarding alias' >&2
    exit 1
  fi
  exec "$OMNIVIEW_PNPM_NODE_PATH" "$@"
fi
exec ` + quote(node) + ` "$@"
`
	nodeWindows := strings.ReplaceAll(`@ECHO off
SETLOCAL EnableExtensions DisableDelayedExpansion
IF NOT DEFINED OMNIVIEW_PNPM_NODE_PATH GOTO default_node
IF /I "%OMNIVIEW_PNPM_NODE_PATH%"=="%~f0" EXIT /b 1
IF "%OMNIVIEW_PNPM_NODE_PATH:~1,2%"==":\" GOTO explicit_node
IF "%OMNIVIEW_PNPM_NODE_PATH:~1,2%"==":/" GOTO explicit_node
IF "%OMNIVIEW_PNPM_NODE_PATH:~0,2%"=="\\" GOTO explicit_node
ECHO OMNIVIEW_PNPM_NODE_PATH must be absolute 1>&2
EXIT /b 1
:explicit_node
IF NOT EXIST "%OMNIVIEW_PNPM_NODE_PATH%" EXIT /b 1
"%OMNIVIEW_PNPM_NODE_PATH%" %*
EXIT /b %ERRORLEVEL%
:default_node
"`+strings.ReplaceAll(node, "%", "%%")+`" %*
`, "\n", "\r\n")
	return []pnpmLauncherFile{{Name: "pnpm.cjs", Data: []byte(script), Mode: 0644}, {Name: "pnpm", Data: []byte(posix), Mode: 0755}, {Name: "pnpm.cmd", Data: []byte(windows), Mode: 0644}, {Name: "node", Data: []byte(nodePosix), Mode: 0755}, {Name: "node.cmd", Data: []byte(nodeWindows), Mode: 0644}}, nil
}
