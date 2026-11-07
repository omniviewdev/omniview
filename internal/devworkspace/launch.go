package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devbaseline"
	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// LaunchOptions is persisted privately so up/restart use the same explicit
// source trust, tooling and mode. No credentials are copied into this record.
type LaunchOptions struct {
	Mode         string `json:"mode"`
	MCP          bool   `json:"mcp"`
	Watch        bool   `json:"watch"`
	LiveFrontend bool   `json:"liveFrontend"`
	// PluginRuntime selects how selected plugins reach the host: managed
	// source links (default) or installed static archives built from the
	// same selected sources. Empty means managed.
	PluginRuntime   string               `json:"pluginRuntime,omitempty"`
	LinkEvidence    LinkProtocolEvidence `json:"linkEvidence"`
	BaselineSource  string               `json:"baselineSource,omitempty"`
	BaselineVersion string               `json:"baselineVersion,omitempty"`
	Timeout         time.Duration        `json:"timeout"`
}

// Plugin runtime selections.
const (
	PluginRuntimeManaged = "managed"
	PluginRuntimeArchive = "archive"
)

// archiveRuntime reports whether selected plugins are published as installed
// archives instead of being linked as managed sources.
func (o LaunchOptions) archiveRuntime() bool { return o.PluginRuntime == PluginRuntimeArchive }

func (o LaunchOptions) validate() error {
	if o.Mode != "browser" && o.Mode != "native" {
		return devcontract.Fail(2, "invalid_mode", "mode must be browser or native")
	}
	if o.MCP && o.Mode != "native" {
		return devcontract.Fail(2, "invalid_mcp_mode", "native MCP requires --mode native")
	}
	return o.validatePluginRuntime()
}

func (o LaunchOptions) validatePluginRuntime() error {
	switch o.PluginRuntime {
	case "", PluginRuntimeManaged:
	case PluginRuntimeArchive:
		if o.Mode != "browser" || o.Watch || o.LiveFrontend {
			return devcontract.Fail(2, "archive_runtime_options", "--plugin-runtime archive requires --mode browser --watch=false --live-frontend=false")
		}
	default:
		return devcontract.Fail(2, "invalid_plugin_runtime", "plugin runtime must be managed or archive")
	}
	return nil
}

// Validate checks launch selection before creating worktrees or starting tools.
func (o LaunchOptions) Validate() error { return o.validate() }

func LoadLaunchOptions(w Workspace) (LaunchOptions, error) {
	var o LaunchOptions
	err := readLaunchJSON(launchPath(w, "launch.json"), &o)
	return o, err
}

const (
	goFlagsEnv  = "GOFLAGS"
	goWorkEnv   = "GOWORK"
	nodePathEnv = "NODE_PATH"
	// sdkSourceEnv is the variable the Taskfile reads to replace the SDK with a
	// local checkout. Only the selected workspace SDK may set it.
	sdkSourceEnv         = "SDK_SOURCE"
	bindingsNode         = "bindings"
	buildingPhase        = "building"
	buildFailureExitCode = 5
)

const supervisorGenerationEnvironment = "OMNIVIEW_SUPERVISOR_GENERATION"

func workspaceEnvironment(base []string, w Workspace, generation string, o LaunchOptions) []string {
	env := make([]string, 0, len(base)+12)
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if strings.EqualFold(key, "PNPM_CONFIG_WORKSPACE_DIR") || strings.EqualFold(key, "NPM_CONFIG_WORKSPACE_DIR") {
			continue
		}
		if strings.EqualFold(key, viteFeedbackEnvironment) {
			continue
		}
		if strings.HasPrefix(key, "OMNIVIEW_PROCESS_BRIDGE_") || key == "OMNIVIEW_NATIVE_PURGE_LOCK_FDS" || key == "OMNIVIEW_NATIVE_ORIGINAL_XDG" || key == "OMNIVIEW_PNPM_NODE_PATH" {
			continue
		}
		switch key {
		case goWorkEnv, goFlagsEnv, "GO_MODFILE", "GOROOT", nodePathEnv, sdkSourceEnv, "OMNIVIEW_PLUGIN_PNPM_COMMANDS", "OMNIVIEW_VITE_ALLOWED_ROOTS", "WAILS_VITE_PORT", "FORCE_COLOR", "NO_COLOR", "OMNIVIEW_WORKSPACE_FILE", "OMNIVIEW_STATE_DIR", "OMNIVIEW_INSTANCE_ID", "OMNIVIEW_GENERATION", supervisorGenerationEnvironment, "OMNIVIEW_WORKSPACE_GRAPH_WATCH", "FRONTEND_DEVSERVER_URL", "WAILS_SERVER_HOST", "WAILS_SERVER_PORT", "WAILS_MCP_HOST", "WAILS_MCP_PORT", "WAILS_MCP_TOKEN", "WAILS_MCP", "OMNIVIEW_CHANNEL":
			continue
		}
		env = append(env, entry)
	}
	env = append(env, goWorkEnv+"=off", goFlagsEnv+"=", "FORCE_COLOR=0", "NO_COLOR=1", "OMNIVIEW_CHANNEL=local",
		"OMNIVIEW_WORKSPACE_FILE="+w.ManifestPath, "OMNIVIEW_STATE_DIR="+w.StateRoot,
		"OMNIVIEW_INSTANCE_ID="+w.Manifest.WorkspaceID, "OMNIVIEW_GENERATION="+generation)
	if selection, err := devsdk.SelectionOf(w.ResolvedWorkspace); err == nil {
		if directory, ok := selection.Directory(); ok {
			env = append(env, sdkSourceEnv+"="+directory)
		}
	}
	if o.Watch {
		env = append(env, "OMNIVIEW_WORKSPACE_GRAPH_WATCH=1")
	}
	return env
}

// Start creates a persistent, authenticated supervisor using this exact CLI
// executable. The short-lived caller never adopts or kills a recorded PID.
func (m *Manager) Start(ctx context.Context, name string, o LaunchOptions, executable string, diagnostics io.Writer) (Status, error) {
	return m.startGeneration(ctx, name, o, executable, diagnostics, "")
}

func (m *Manager) startGeneration(ctx context.Context, name string, o LaunchOptions, executable string, diagnostics io.Writer, generation string) (Status, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return Status{}, err
	}
	if err = o.validate(); err != nil {
		return Status{}, err
	}
	if o.Timeout <= 0 {
		o.Timeout = 20 * time.Minute
	}
	ctx, cancelStart := context.WithTimeout(ctx, o.Timeout)
	defer cancelStart()
	operationUnlock, err := withWorkspaceOperation(ctx, w)
	if err != nil {
		return Status{}, err
	}
	defer operationUnlock()
	if w.Phase != "complete" {
		w, err = m.Resume(ctx, w.Manifest.WorkspaceID)
		if err != nil {
			return Status{}, err
		}
		name = w.Manifest.WorkspaceID
	}
	if err = ReconcileGeneratedRoot(w); err != nil {
		return Status{}, err
	}
	status, err := m.Status(ctx, name)
	if err != nil {
		return status, err
	}
	if status.Phase != "stopped" && status.Phase != "crashed" {
		recovery := workspaceRecoveryCommand(w, "restart")
		if status.RecoveryCommand != "" {
			recovery = status.RecoveryCommand
		} else if status.Phase == "error" {
			recovery = workspaceRecoveryCommand(w, "refresh")
		}
		return status, devcontract.Fail(4, "workspace_running", fmt.Sprintf("workspace has an owned supervisor in launch phase %q; recover with: %s", status.Phase, recovery))
	}
	if w.Manifest.Links.SDKRepositoryID == nil {
		return Status{}, sdkSourceRequired(ctx, "select the plugin-sdk repository before launching", workspaceSDKProbes(w), editAddSDKCommand(w))
	}
	if err = ResumeGeneratedPublication(w); err != nil {
		return Status{}, err
	}
	if err = saveLaunchJSON(launchPath(w, "launch.json"), o); err != nil {
		return Status{}, err
	}
	if executable == "" {
		executable, err = m.supervisorExecutable()
		if err != nil {
			return Status{}, err
		}
	}
	command := exec.Command(executable, "workspace", "supervise", "--root", m.Root, "--workspace", w.Root)
	command.Env = workspaceEnvironment(os.Environ(), w, "", o)
	if generation != "" {
		command.Env = append(command.Env, supervisorGenerationEnvironment+"="+generation)
	}
	detachSupervisor(command)
	if err = command.Start(); err != nil {
		return Status{}, err
	}
	if generation != "" {
		// Keep the native child handle unreaped until its identity is captured:
		// a recycled PID must never receive this operation's authorization.
		owner := devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root}
		launched := launchedExecutable(command)
		process, captureErr := captureExecutedProcess(ctx, launched, supervisorExecutable(), execCaptureTimeout, func() (devcontract.ProcessIdentity, error) {
			return devsession.CaptureProcess(command.Process.Pid, owner)
		})
		if captureErr == nil {
			actualExecutable := process.Executable
			if resolved, resolveErr := filepath.EvalSymlinks(actualExecutable); resolveErr == nil {
				actualExecutable = resolved
			}
			if actualExecutable != launched {
				failure := devcontract.Fail(4, "launch_authorization_invalid", "retained supervisor launch did not execute the selected native controller")
				failure.Details = map[string]any{"selectedExecutable": launched, "actualExecutable": process.Executable}
				captureErr = failure
			}
		}
		if captureErr == nil {
			captureErr = m.authorizeSupervisorLaunch(ctx, w, generation, process)
		}
		if captureErr != nil {
			// An unauthorized child cannot publish a supervisor record and
			// exits after its bounded handoff wait. Reap only our own handle.
			go func() { _ = command.Wait() }()
			return Status{}, captureErr
		}
	}
	// Reap only our own supervisor handle if it exits during startup. This does
	// not signal it when the short CLI returns or grant detached PID ownership.
	supervisorExited := make(chan error, 1)
	go func() { supervisorExited <- command.Wait() }()
	deadline, cancel := context.WithTimeout(ctx, o.Timeout)
	defer cancel()
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		current, statusErr := m.Status(deadline, name)
		if statusErr == nil && current.Generation != "" && current.Generation != status.Generation {
			if generation != "" && current.Generation != generation {
				return current, devcontract.Fail(4, "stale_target", "a different supervisor generation appeared during the retained launch")
			}
			switch current.Phase {
			case "ready":
				return current, nil
			case "error", "crashed":
				if current.LastError != nil {
					return current, workspaceOwnershipError(current.LastError, w)
				}
				return current, devcontract.Fail(5, "launch_failed", "supervisor failed; inspect private supervisor.log")
			}
		}
		select {
		case <-supervisorExited:
			return current, devcontract.Fail(5, "supervisor_exited", "owned supervisor exited before readiness; inspect private supervisor.log")
		case <-deadline.Done():
			return current, devcontract.Fail(7, "timeout", "workspace launch did not become ready before the deadline; supervisor state is retained for inspect/down")
		case <-ticker.C:
		}
	}
}

func (m *Manager) Down(ctx context.Context, name string) (Status, error) {
	return m.down(ctx, name, true)
}

func (m *Manager) down(ctx context.Context, name string, fence bool) (Status, error) {
	return m.downSupervisor(ctx, name, fence, "", nil)
}

func (m *Manager) downAuthorizedGeneration(ctx context.Context, name string, process devcontract.ProcessIdentity) (Status, error) {
	return m.downSupervisor(ctx, name, false, process.Generation, &process)
}

func (m *Manager) downSupervisor(ctx context.Context, name string, fence bool, generation string, process *devcontract.ProcessIdentity) (Status, error) {
	if fence {
		if err := m.fenceFollow(ctx, name); err != nil {
			return Status{}, err
		}
		release, err := m.waitUpdateAuthority(ctx, name)
		if err != nil {
			return Status{}, err
		}
		defer release()
	}
	status, err := m.supervisorTargetCommand(ctx, name, supervisorStopCommand, generation, process)
	if err != nil || status.Generation == "" || runtime.GOOS == "darwin" {
		return status, err
	}
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return status, err
	}
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		var record supervisorRecord
		if err = readLaunchJSON(launchPath(w, "supervisor.json"), &record); err != nil {
			return status, err
		}
		if record.Generation != status.Generation {
			return status, devcontract.Fail(4, "stale_target", "workspace generation changed during shutdown")
		}
		if process != nil && record.Process != *process {
			return status, devcontract.Fail(4, "stale_target", "supervisor native invocation changed during shutdown")
		}
		if err = verifySupervisor(record, w); errors.Is(err, devsession.ErrProcessGone) {
			return status, nil
		} else if err != nil {
			return status, err
		}
		select {
		case <-ctx.Done():
			return status, devcontract.Fail(7, "timeout", "owned supervisor did not finish shutdown")
		case <-ticker.C:
		}
	}
}
func (m *Manager) Restart(ctx context.Context, name string) (Status, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return Status{}, err
	}
	options, err := LoadLaunchOptions(w)
	if err != nil {
		return Status{}, err
	}
	// Restart can start an absent or exited generation, but never adopts a
	// foreign live process. Live owners still use authenticated restart.
	stopped, err := m.supervisorCommand(ctx, name, supervisorRestartCommand)
	if err != nil {
		return stopped, err
	}
	if runtime.GOOS == "darwin" || stopped.Generation == "" {
		return m.Start(ctx, name, options, "", io.Discard)
	}
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		var record supervisorRecord
		if err = readLaunchJSON(launchPath(w, "supervisor.json"), &record); err != nil {
			return stopped, err
		}
		if err = verifySupervisor(record, w); errors.Is(err, devsession.ErrProcessGone) {
			break
		} else if err != nil {
			return stopped, err
		}
		select {
		case <-ctx.Done():
			return stopped, devcontract.Fail(7, "timeout", "owned supervisor did not finish shutdown")
		case <-ticker.C:
		}
	}
	return m.Start(ctx, name, options, "", io.Discard)
}
func (m *Manager) supervisorCommand(ctx context.Context, name, command string) (Status, error) {
	return m.supervisorTargetCommand(ctx, name, command, "", nil)
}

func (m *Manager) supervisorTargetCommand(ctx context.Context, name, command, generation string, process *devcontract.ProcessIdentity) (Status, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return Status{}, err
	}
	var record supervisorRecord
	if err = readLaunchJSON(launchPath(w, "supervisor.json"), &record); err != nil {
		if os.IsNotExist(err) && generation != "" {
			return Status{}, devcontract.Fail(4, "stale_target", "selected supervisor generation disappeared before shutdown")
		}
		if os.IsNotExist(err) && (command == supervisorStopCommand || command == supervisorRestartCommand) {
			return Status{Workspace: w, Phase: "stopped"}, nil
		}
		return Status{}, err
	}
	if generation != "" && record.Generation != generation {
		return Status{}, devcontract.Fail(4, "stale_target", "workspace generation changed before shutdown")
	}
	if process != nil && record.Process != *process {
		return Status{}, devcontract.Fail(4, "stale_target", "supervisor native invocation changed before shutdown")
	}
	if err = verifySupervisor(record, w); err != nil {
		if errors.Is(err, devsession.ErrProcessGone) && (command == supervisorStopCommand || command == supervisorRestartCommand) {
			return Status{Workspace: w, Generation: record.Generation, Phase: "crashed"}, nil
		}
		return Status{}, err
	}
	token, err := readSupervisorToken(w, record)
	if err != nil {
		return Status{}, err
	}
	if command != supervisorStopCommand && command != supervisorRestartCommand {
		return callSupervisor(ctx, record, token, command)
	}
	return shutdownSupervisor(ctx, w, record, token, command)
}

func (s *workspaceSupervisor) runLaunchCommand(ctx context.Context, directory string, environment []string, output io.Writer, program string, args ...string) ([]byte, error) {
	command := exec.Command(program, args...)
	command.Dir = directory
	command.Env = environment
	var stdout strings.Builder
	command.Stdout = &stdout
	stderr := &childOutput{output: output}
	command.Stderr = stderr
	err := RunRepositoryCommand(ctx, command, devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: "build", Source: directory})
	if output != nil && stdout.Len() > 0 {
		_, _ = io.WriteString(output, stdout.String())
	}
	if err != nil {
		if ctx.Err() != nil && !errors.Is(err, errOwnedCommandUncertain) {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%s failed in selected checkout: %w\n%s", program, err, safeCompilerDiagnostic(stdout.String()+"\n"+stderr.text, s.workspace.Root))
	}
	return []byte(stdout.String()), nil
}

// graph links the selected composition and builds the supervisor's build
// graph, wiring the native/server host build, host reuse, bindings adapter and
// launch-status events.
func (s *workspaceSupervisor) graph(ctx context.Context) (*BuildGraph, error) {
	o := s.options
	if err := compatibilityPreflight(ctx, s.workspace, s.sdkVerifier()); err != nil {
		return nil, err
	}
	report, err := s.manager.Link(ctx, s.workspace.Manifest.WorkspaceID, LinkOptions{Evidence: o.LinkEvidence})
	if err != nil {
		var typed *devcontract.Error
		if !errors.As(err, &typed) || typed.Code != linkResolutionFailureCode || report.Phase != "linked" {
			return nil, err
		}
	}
	host, err := s.workspace.RepositoryPath("omniview")
	if err != nil {
		return nil, err
	}
	if _, err = devcompose.Installed(s.workspace.ResolvedWorkspace, host); err != nil {
		return nil, fmt.Errorf("supervisor build requires the completed aggregate install and recursive peer transaction: %w", err)
	}
	return s.manager.NewBuildGraph(ctx, s.workspace.Manifest.WorkspaceID, BuildOptions{
		Generation: s.generation, GoBuildCacheDirectory: s.goBuildCache, VerifySDK: s.sdkVerifier(),
		HostBuild: s.buildHost, HostVariant: s.hostVariant(), HostOutput: s.hostOutput(), ReuseHost: s.reuseHost,
		Bindings: func(ctx context.Context, host, outputDirectory string) (resultErr error) {
			hostModOutput, prepareErr := prepareStableHostModTree(s.workspace, s.generation)
			if prepareErr != nil {
				return prepareErr
			}
			defer func() {
				if errors.Is(resultErr, errOwnedCommandUncertain) {
					_ = hostModOutput.stageFile.Close()
					return
				}
				resultErr = errors.Join(resultErr, recordStableHostModTree(hostModOutput))
			}()
			args := []string{bindingsNode, "DEV=true", "EXTRA_TAGS=devcontrol",
				"BINDINGS_OUTPUT_DIRECTORY=" + outputDirectory, "HOST_MOD_OUTPUT_DIRECTORY=" + hostModOutput.Directory,
				"GO_BUILD_CACHE_DIRECTORY=" + s.goBuildCache}
			if o.Mode == "browser" {
				args = append(args, "SERVER=true")
			}
			if o.MCP {
				args = append(args, "WAILS_MCP=1")
			}
			_, resultErr = s.runLaunchCommand(ctx, host, s.environment(), s.output, "task", args...)
			return resultErr
		}, Output: s.output, OnEvent: func(event BuildEvent) {
			s.mu.Lock()
			s.status.Builds[event.Node] = event
			switch event.Phase {
			case buildingPhase:
				s.status.Phase = buildingPhase
				s.status.LastError = nil
			case "error", "invalidated":
				s.status.Phase = "build-error"
				s.status.FailedStage = event.Node
				s.status.RecoveryCommand = workspaceRecoveryCommand(s.workspace, "refresh")
				s.status.LastError = supervisedBuildError(event, s.workspace)
			}
			s.mu.Unlock()
			s.persist()
		},
	})
}

// sdkVerifier is the verifier every SDK observation of this supervisor shares,
// built under the manager's injected policy.
func (s *workspaceSupervisor) sdkVerifier() devsdk.Verifier {
	return devsdk.NewVerifier(s.manager.options.SDKPolicy)
}

// buildHost compiles the selected host against the owned host modfile into a
// generated bin tree and adopts it as the launch binary once published.
func (s *workspaceSupervisor) buildHost(ctx context.Context, request HostBuildRequest) (resultErr error) {
	selected, isSource := request.SDK.Source()
	if !isSource {
		return fmt.Errorf("native host build requires a verified source SDK identity")
	}
	host, err := request.Workspace.RepositoryPath("omniview")
	if err != nil {
		return err
	}
	hostModOutput, err := prepareStableHostModTree(s.workspace, s.generation)
	if err != nil {
		return err
	}
	defer func() {
		if errors.Is(resultErr, errOwnedCommandUncertain) {
			_ = hostModOutput.stageFile.Close()
			return
		}
		resultErr = errors.Join(resultErr, recordStableHostModTree(hostModOutput))
	}()
	env := s.environment()
	raw, err := s.runLaunchCommand(ctx, host, env, s.output, "go", "run", "./scripts/hostmod/main.go", "--root", host, "--output-directory", hostModOutput.Directory, "--sdk-source", selected.Directory, "--format", "json")
	if err != nil {
		return err
	}
	var hostModule struct {
		Modfile string `json:"modfile"`
	}
	if err = json.Unmarshal(raw, &hostModule); err != nil {
		return err
	}
	if hostModule.Modfile != filepath.Join(hostModOutput.Directory, "host.mod") {
		return fmt.Errorf("host module preparation returned no owned effective modfile")
	}
	// Inspect the exact alternate host graph, not just the source go.mod.
	raw, err = s.runLaunchCommand(ctx, host, env, nil, "go", "list", "-modfile="+hostModule.Modfile, "-m", "-json", devsdk.Module)
	if err != nil {
		return err
	}
	var module struct {
		Path, Dir string
		Replace   *struct{ Dir, Version string }
	}
	if err = json.Unmarshal(raw, &module); err != nil {
		return err
	}
	if module.Path != devsdk.Module || module.Replace == nil || module.Replace.Version != "" {
		return fmt.Errorf("effective native host graph has no selected local SDK replacement")
	}
	actual, err := devcontract.CanonicalPath(module.Replace.Dir)
	if err != nil {
		return err
	}
	if actual != selected.Directory {
		return fmt.Errorf("effective native host graph changed selected SDK source")
	}
	checkout, err := devsdk.SourceSelection(actual)
	if err != nil {
		return err
	}
	verify := s.sdkVerifier()
	before, err := verify(ctx, checkout)
	if err != nil {
		return err
	}
	if before != request.SDK {
		return fmt.Errorf("SDK source changed before native host build")
	}
	prepared, err := PrepareGeneratedTree(s.workspace, s.hostOutput(), s.generation)
	if err != nil {
		return err
	}
	bin := prepared.Directory
	tags := "devcontrol"
	if s.options.Mode == "browser" {
		tags = "server," + tags
	}
	if s.options.MCP {
		tags += ",mcp"
	}
	binary := filepath.Join(bin, s.hostExecutable())
	defer func() {
		if errors.Is(resultErr, errOwnedCommandUncertain) {
			_ = prepared.stageFile.Close()
			return
		}
		recordErr := RecordGeneratedTree(prepared)
		resultErr = errors.Join(resultErr, recordErr)
		if resultErr == nil {
			s.mu.Lock()
			s.binary = filepath.Join(prepared.Destination, s.hostLaunchRelative())
			s.mu.Unlock()
		}
	}()
	if _, err = s.runLaunchCommand(ctx, host, env, s.output, "go", "build", "-modfile="+hostModule.Modfile, "-tags="+tags, "-buildvcs=false", "-ldflags=-X github.com/omniviewdev/omniview/internal/instance.buildChannel=local", "-o", binary, "."); err != nil {
		return err
	}
	after, err := verify(ctx, checkout)
	if err != nil {
		return err
	}
	if before != after {
		return fmt.Errorf("SDK source changed during native host build")
	}
	if s.options.Mode == "native" && runtime.GOOS == "darwin" {
		if _, err = s.runLaunchCommand(ctx, host, env, s.output, "task", "darwin:create:dev:app:bundle", "BIN_DIR="+bin, "HOST_MOD_OUTPUT_DIRECTORY="+hostModOutput.Directory, "GO_BUILD_CACHE_DIRECTORY="+s.goBuildCache); err != nil {
			return err
		}
	}
	return nil
}

// hostOutput is the generated tree buildHost publishes for this mode.
func (s *workspaceSupervisor) hostOutput() string { return filepath.Join("bin", s.options.Mode) }

// hostVariant names every host build setting that is not a source file.
func (s *workspaceSupervisor) hostVariant() string {
	runtimeKind := s.options.PluginRuntime
	if runtimeKind == "" {
		runtimeKind = PluginRuntimeManaged
	}
	return fmt.Sprintf("mode=%s mcp=%t plugins=%s platform=%s/%s", s.options.Mode, s.options.MCP, runtimeKind, runtime.GOOS, runtime.GOARCH)
}

// hostExecutable is the go build output name inside the host output tree.
func (s *workspaceSupervisor) hostExecutable() string {
	name := "Omniview"
	if s.options.Mode == "browser" {
		name += "-server"
	}
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

// hostLaunchRelative is the launched executable inside the host output tree.
func (s *workspaceSupervisor) hostLaunchRelative() string {
	if s.options.Mode == "native" && runtime.GOOS == "darwin" {
		return filepath.Join("Omniview.dev.app", "Contents", "MacOS", "Omniview")
	}
	return s.hostExecutable()
}

// reuseHost adopts the published host from an unchanged previous build. The
// graph has already verified the whole output tree against its ledger record.
func (s *workspaceSupervisor) reuseHost(context.Context) error {
	destination, err := generatedPath(s.workspace, s.hostOutput())
	if err != nil {
		return err
	}
	binary := filepath.Join(destination, s.hostLaunchRelative())
	info, err := os.Lstat(binary)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("published host executable is not a regular file")
	}
	s.mu.Lock()
	s.binary = binary
	s.mu.Unlock()
	return nil
}

func (s *workspaceSupervisor) seed(ctx context.Context) error {
	s.mu.Lock()
	s.status.Seed = nil
	s.mu.Unlock()
	if s.options.BaselineSource == "" {
		return nil
	}
	profile, err := profileFor(s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return err
	}
	marker := launchPath(s.workspace, "baseline-seeded.json")
	type seedRecord struct {
		Source string `json:"source"`
		Digest string `json:"digest"`
	}
	var prior seedRecord
	if err = readLaunchJSON(marker, &prior); err == nil {
		if prior.Source != s.options.BaselineSource {
			return devcontract.Fail(4, "baseline_conflict", "workspace was already seeded from another explicit source")
		}
		raw, err := os.ReadFile(filepath.Join(s.workspace.StateRoot, "baseline.json"))
		if err != nil {
			return err
		}
		var saved devbaseline.Baseline
		if err = json.Unmarshal(raw, &saved); err != nil {
			return err
		}
		normalized, err := json.Marshal(saved)
		if err != nil {
			return err
		}
		if digestGenerated(normalized) != prior.Digest {
			return devcontract.Fail(4, "baseline_conflict", "seeded baseline receipt changed or disappeared")
		}
		return s.recordSeed(ctx, false)
	} else if !os.IsNotExist(err) {
		return err
	}
	intentPath := launchPath(s.workspace, "baseline-intent.json")
	var intent struct {
		Source   string                `json:"source"`
		Baseline *devbaseline.Baseline `json:"baseline"`
	}
	if err = readLaunchJSON(intentPath, &intent); os.IsNotExist(err) {
		intent.Source = s.options.BaselineSource
		intent.Baseline, err = devbaseline.Snapshot(ctx, devbaseline.SnapshotOptions{SourceRoot: s.options.BaselineSource, SourceVersion: s.options.BaselineVersion})
		if err != nil {
			return err
		}
		if err = saveLaunchJSON(intentPath, intent); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if intent.Source != s.options.BaselineSource || intent.Baseline == nil {
		return devcontract.Fail(4, "baseline_conflict", "pending baseline intent belongs to another explicit source")
	}
	destinationManifest := filepath.Join(s.workspace.StateRoot, "baseline.json")
	if info, statErr := os.Lstat(destinationManifest); statErr == nil {
		if !info.Mode().IsRegular() {
			return devcontract.Fail(4, "baseline_conflict", "published baseline is not a regular file")
		}
		raw, err := os.ReadFile(destinationManifest)
		if err != nil {
			return err
		}
		var actual devbaseline.Baseline
		if err = json.Unmarshal(raw, &actual); err != nil {
			return err
		}
		matches, err := devbaseline.SameContent(&actual, intent.Baseline)
		if err != nil {
			return err
		}
		if !matches {
			return devcontract.Fail(4, "baseline_conflict", "existing initialized profile does not match the recorded seed intent")
		}
	} else if !os.IsNotExist(statErr) {
		return statErr
	} else {
		result, importErr := devbaseline.Import(ctx, intent.Baseline, devbaseline.ImportOptions{Destination: profile, Home: s.manager.options.Home})
		if importErr != nil {
			return importErr
		}
		s.mu.Lock()
		s.status.Seed = &result
		s.mu.Unlock()
	}
	if err := s.recordSeed(ctx, true); err != nil {
		return err
	}
	raw, err := os.ReadFile(destinationManifest)
	if err != nil {
		return err
	}
	var published devbaseline.Baseline
	if err := json.Unmarshal(raw, &published); err != nil {
		return err
	}
	receipt, err := json.Marshal(published)
	if err != nil {
		return err
	}
	return saveLaunchJSON(marker, seedRecord{Source: s.options.BaselineSource, Digest: digestGenerated(receipt)})
}

func (s *workspaceSupervisor) recordSeed(ctx context.Context, initial bool) error {
	result, err := devbaseline.InspectImport(ctx, s.workspace.StateRoot, initial)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.status.Seed = &result
	s.mu.Unlock()
	return nil
}

func inspectWorkspaceSeed(ctx context.Context, w Workspace) (devbaseline.Result, error) {
	var marker struct {
		Source string `json:"source"`
		Digest string `json:"digest"`
	}
	if err := readLaunchJSON(launchPath(w, "baseline-seeded.json"), &marker); err != nil {
		return devbaseline.Result{}, err
	}
	raw, err := os.ReadFile(filepath.Join(w.StateRoot, "baseline.json"))
	if err != nil {
		return devbaseline.Result{}, err
	}
	var saved devbaseline.Baseline
	if err := json.Unmarshal(raw, &saved); err != nil {
		return devbaseline.Result{}, err
	}
	normalized, err := json.Marshal(saved)
	if err != nil {
		return devbaseline.Result{}, err
	}
	if digestGenerated(normalized) != marker.Digest {
		return devbaseline.Result{}, devcontract.Fail(4, "baseline_conflict", "seeded baseline receipt changed or disappeared")
	}
	return devbaseline.InspectImport(ctx, w.StateRoot, false)
}

func NewGeneration() string { return uuid.NewString() }

// supervisorExecutable resolves the CLI executable that hosts a new supervisor
// when Start or Restart receive none: the manager's injected resolver, or this
// process's own executable.
func (m *Manager) supervisorExecutable() (string, error) {
	if m.options.Executable != nil {
		return m.options.Executable()
	}
	return os.Executable()
}
