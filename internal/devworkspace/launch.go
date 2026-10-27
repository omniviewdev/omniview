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
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devsource"
)

// LaunchOptions is persisted privately so up/restart use the same explicit
// source trust, tooling and mode. No credentials are copied into this record.
type LaunchOptions struct {
	Mode                        string               `json:"mode"`
	MCP                         bool                 `json:"mcp"`
	Watch                       bool                 `json:"watch"`
	LiveFrontend                bool                 `json:"liveFrontend"`
	ReviewedSDKRevision         string               `json:"reviewedSDKRevision"`
	AllowIsolationSourceChanges bool                 `json:"allowIsolationSourceChanges"`
	LinkEvidence                LinkProtocolEvidence `json:"linkEvidence"`
	BaselineSource              string               `json:"baselineSource,omitempty"`
	BaselineVersion             string               `json:"baselineVersion,omitempty"`
	Timeout                     time.Duration        `json:"timeout"`
}

func (o LaunchOptions) validate() error {
	if o.Mode != "browser" && o.Mode != "native" {
		return devcontract.Fail(2, "invalid_mode", "mode must be browser or native")
	}
	if !reviewedSDKRevision.MatchString(o.ReviewedSDKRevision) {
		return devcontract.Fail(2, "reviewed_sdk_required", "supply an independently reviewed full SDK commit with --reviewed-sdk-revision")
	}
	if o.MCP && o.Mode != "native" {
		return devcontract.Fail(2, "invalid_mcp_mode", "native MCP requires --mode native")
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
		case "GOWORK", "GOFLAGS", "GO_MODFILE", "GOROOT", "NODE_PATH", "SDK_SOURCE", "OMNIVIEW_PLUGIN_PNPM_COMMANDS", "OMNIVIEW_VITE_ALLOWED_ROOTS", "WAILS_VITE_PORT", "FORCE_COLOR", "NO_COLOR", "OMNIVIEW_WORKSPACE_FILE", "OMNIVIEW_STATE_DIR", "OMNIVIEW_INSTANCE_ID", "OMNIVIEW_GENERATION", "OMNIVIEW_EXPECTED_SDK_REVISION", "OMNIVIEW_FIXED_SDK_REVISION", "OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES", "OMNIVIEW_WORKSPACE_GRAPH_WATCH", "FRONTEND_DEVSERVER_URL", "WAILS_SERVER_HOST", "WAILS_SERVER_PORT", "WAILS_MCP_HOST", "WAILS_MCP_PORT", "WAILS_MCP_TOKEN", "WAILS_MCP", "OMNIVIEW_CHANNEL":
			continue
		}
		env = append(env, entry)
	}
	env = append(env, "GOWORK=off", "GOFLAGS=", "FORCE_COLOR=0", "NO_COLOR=1", "OMNIVIEW_CHANNEL=local", "OMNIVIEW_WORKSPACE_FILE="+w.ManifestPath, "OMNIVIEW_STATE_DIR="+w.StateRoot, "OMNIVIEW_INSTANCE_ID="+w.Manifest.WorkspaceID, "OMNIVIEW_GENERATION="+generation, "OMNIVIEW_EXPECTED_SDK_REVISION="+o.ReviewedSDKRevision)
	if w.Manifest.Links.SDKRepositoryID != nil {
		for _, repository := range w.Manifest.Repositories {
			if repository.ID == *w.Manifest.Links.SDKRepositoryID {
				env = append(env, "SDK_SOURCE="+filepath.Join(w.Root, repository.Directory))
				break
			}
		}
	}
	if o.Watch {
		env = append(env, "OMNIVIEW_WORKSPACE_GRAPH_WATCH=1")
	}
	if o.AllowIsolationSourceChanges {
		env = append(env, "OMNIVIEW_ALLOW_ISOLATION_SOURCE_CHANGES=1")
	}
	return env
}

// Start creates a persistent, authenticated supervisor using this exact CLI
// executable. The short-lived caller never adopts or kills a recorded PID.
func (m *Manager) Start(ctx context.Context, name string, o LaunchOptions, executable string, diagnostics io.Writer) (Status, error) {
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
	if o.AllowIsolationSourceChanges {
		if _, err = fmt.Fprintln(diagnostics, "WARNING: this workspace explicitly permits unreviewed SDK isolation-boundary edits. Its source-built plugins may bypass profile isolation. This is not a sandbox."); err != nil {
			return Status{}, err
		}
	}
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
		return status, devcontract.Fail(4, "workspace_running", "workspace already has an owned supervisor; use restart")
	}
	if w.Manifest.Links.SDKRepositoryID == nil {
		return Status{}, devcontract.Fail(2, "sdk_source_required", "select the plugin-sdk repository before launching")
	}
	if err = ResumeGeneratedPublication(w); err != nil {
		return Status{}, err
	}
	if err = saveLaunchJSON(launchPath(w, "launch.json"), o); err != nil {
		return Status{}, err
	}
	if executable == "" {
		executable, err = os.Executable()
		if err != nil {
			return Status{}, err
		}
	}
	command := exec.Command(executable, "workspace", "supervise", "--root", m.Root, "--workspace", w.Root)
	command.Env = workspaceEnvironment(os.Environ(), w, "", o)
	detachSupervisor(command)
	if err = command.Start(); err != nil {
		return Status{}, err
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
			switch current.Phase {
			case "ready":
				return current, nil
			case "error", "crashed":
				if current.LastError != nil {
					return current, workspaceError(current.LastError)
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
	status, err := m.supervisorCommand(ctx, name, "stop")
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
	stopped, err := m.supervisorCommand(ctx, name, "restart")
	if err != nil {
		return stopped, err
	}
	if runtime.GOOS == "darwin" {
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
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return Status{}, err
	}
	var record supervisorRecord
	if err = readLaunchJSON(launchPath(w, "supervisor.json"), &record); err != nil {
		if os.IsNotExist(err) && command == "stop" {
			return Status{Workspace: w, Phase: "stopped"}, nil
		}
		return Status{}, err
	}
	if err = verifySupervisor(record, w); err != nil {
		if errors.Is(err, devsession.ErrProcessGone) && command == "stop" {
			return Status{Workspace: w, Generation: record.Generation, Phase: "crashed"}, nil
		}
		return Status{}, err
	}
	token, err := readSupervisorToken(w, record)
	if err != nil {
		return Status{}, err
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

func (s *workspaceSupervisor) graph(ctx context.Context) (*BuildGraph, error) {
	o := s.options
	if err := compatibilityPreflight(ctx, s.workspace, o); err != nil {
		return nil, err
	}
	report, err := s.manager.Link(ctx, s.workspace.Manifest.WorkspaceID, LinkOptions{Evidence: o.LinkEvidence})
	if err != nil {
		var typed *devcontract.Error
		if !errors.As(err, &typed) || typed.Code != "link_resolution_failed" || report.Phase != "linked" {
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
	verify := func(ctx context.Context, directory, revision string) (devsource.Identity, error) {
		identity, err := devsource.VerifyWithOptions(ctx, directory, revision, devsource.VerifyOptions{AllowIsolationCoreChanges: o.AllowIsolationSourceChanges})
		if err != nil {
			return identity, devcontract.Fail(4, "sdk_source_untrusted", err.Error())
		}
		return identity, nil
	}
	return s.manager.NewBuildGraph(ctx, s.workspace.Manifest.WorkspaceID, BuildOptions{Generation: s.generation, GoBuildCacheDirectory: s.goBuildCache, ExpectedSDKRevision: o.ReviewedSDKRevision, VerifySDKSource: verify, HostBuild: s.buildHost, Bindings: func(ctx context.Context, host, outputDirectory string) (resultErr error) {
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
		args := []string{"bindings", "DEV=true", "EXTRA_TAGS=devcontrol", "BINDINGS_OUTPUT_DIRECTORY=" + outputDirectory, "HOST_MOD_OUTPUT_DIRECTORY=" + hostModOutput.Directory, "GO_BUILD_CACHE_DIRECTORY=" + s.goBuildCache}
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
		if event.Phase == "building" {
			s.status.Phase = "building"
			s.status.LastError = nil
		} else if event.Phase == "error" || event.Phase == "invalidated" {
			s.status.Phase = "build-error"
			s.status.FailedStage = event.Node
			s.status.RecoveryCommand = "omniview-dev workspace refresh " + s.workspace.Manifest.WorkspaceID
			s.status.LastError = devcontract.Fail(5, "build_failed", safeCompilerDiagnostic(event.Error, s.workspace.Root))
		}
		s.mu.Unlock()
		s.persist()
	}})
}

func (s *workspaceSupervisor) buildHost(ctx context.Context, request HostBuildRequest) (resultErr error) {
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
	raw, err := s.runLaunchCommand(ctx, host, env, s.output, "go", "run", "./scripts/hostmod/main.go", "--root", host, "--output-directory", hostModOutput.Directory, "--sdk-source", request.SDKDirectory, "--format", "json")
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
	raw, err = s.runLaunchCommand(ctx, host, env, nil, "go", "list", "-modfile="+hostModule.Modfile, "-m", "-json", linkedSDK)
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
	if module.Path != linkedSDK || module.Replace == nil || module.Replace.Version != "" {
		return fmt.Errorf("effective native host graph has no selected local SDK replacement")
	}
	actual, err := devcontract.CanonicalPath(module.Replace.Dir)
	if err != nil {
		return err
	}
	if actual != request.SDKDirectory {
		return fmt.Errorf("effective native host graph changed selected SDK source")
	}
	before, err := devsource.VerifyWithOptions(ctx, actual, request.ExpectedSDKRevision, devsource.VerifyOptions{AllowIsolationCoreChanges: s.options.AllowIsolationSourceChanges})
	if err != nil {
		return err
	}
	if before != request.SDKSource {
		return fmt.Errorf("SDK source changed before native host build")
	}
	prepared, err := PrepareGeneratedTree(s.workspace, filepath.Join("bin", s.options.Mode), s.generation)
	if err != nil {
		return err
	}
	bin := prepared.Directory
	tags := "devcontrol"
	binary := filepath.Join(bin, "Omniview")
	if s.options.Mode == "browser" {
		tags = "server," + tags
		binary += "-server"
	}
	if s.options.MCP {
		tags += ",mcp"
	}
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	defer func() {
		if errors.Is(resultErr, errOwnedCommandUncertain) {
			_ = prepared.stageFile.Close()
			return
		}
		recordErr := RecordGeneratedTree(prepared)
		resultErr = errors.Join(resultErr, recordErr)
		if resultErr == nil {
			relative, err := filepath.Rel(prepared.Directory, binary)
			if err != nil {
				resultErr = err
				return
			}
			s.mu.Lock()
			s.binary = filepath.Join(prepared.Destination, relative)
			s.mu.Unlock()
		}
	}()
	if _, err = s.runLaunchCommand(ctx, host, env, s.output, "go", "build", "-modfile="+hostModule.Modfile, "-tags="+tags, "-buildvcs=false", "-ldflags=-X github.com/omniviewdev/omniview/internal/instance.buildChannel=local", "-o", binary, "."); err != nil {
		return err
	}
	after, err := devsource.VerifyWithOptions(ctx, actual, request.ExpectedSDKRevision, devsource.VerifyOptions{AllowIsolationCoreChanges: s.options.AllowIsolationSourceChanges})
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
		binary = filepath.Join(bin, "Omniview.dev.app", "Contents", "MacOS", "Omniview")
	}
	return nil
}

func (s *workspaceSupervisor) seed(ctx context.Context) error {
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
		return nil
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
	expected, err := json.Marshal(intent.Baseline)
	if err != nil {
		return err
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
		normalized, err := json.Marshal(actual)
		if err != nil {
			return err
		}
		if string(normalized) != string(expected) {
			return devcontract.Fail(4, "baseline_conflict", "existing initialized profile does not match the recorded seed intent")
		}
	} else if !os.IsNotExist(statErr) {
		return statErr
	} else {
		if _, err = devbaseline.Import(ctx, intent.Baseline, devbaseline.ImportOptions{Destination: profile, Home: s.manager.options.Home}); err != nil {
			return err
		}
	}
	return saveLaunchJSON(marker, seedRecord{Source: s.options.BaselineSource, Digest: digestGenerated(expected)})
}

func NewGeneration() string { return uuid.NewString() }
