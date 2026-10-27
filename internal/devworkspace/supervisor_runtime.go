package devworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type childOutput struct {
	mu     sync.Mutex
	text   string
	output io.Writer
}

func (w *childOutput) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.text += string(p)
	if len(w.text) > 128<<10 {
		w.text = w.text[len(w.text)-(128<<10):]
	}
	if w.output != nil {
		return w.output.Write(p)
	}
	return len(p), nil
}
func (w *childOutput) contains(value string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return strings.Contains(w.text, value)
}

var errOwnedBindFailure = errors.New("owned listener reported its exact assigned port bind failure")

func (w *childOutput) failedBind(port int) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	needle := strconv.Itoa(port)
	for _, line := range strings.Split(strings.ToLower(w.text), "\n") {
		failure := strings.Contains(line, "address already in use") || strings.Contains(line, "eaddrinuse") || strings.Contains(line, "already in use")
		if !failure {
			continue
		}
		for _, field := range strings.FieldsFunc(line, func(r rune) bool { return r < '0' || r > '9' }) {
			if field == needle {
				return true
			}
		}
	}
	return false
}

func (s *workspaceSupervisor) reserve(ctx context.Context, role string) (devsession.Lease, error) {
	if lease, ok := s.leases[role]; ok {
		return lease, nil
	}
	key := devsession.ServiceKey{WorkspaceID: s.workspace.Manifest.WorkspaceID, Role: role}
	lease, err := s.registry.Reserve(ctx, devsession.LeaseRequest{Key: key, Owner: s.owner, Strict: s.workspace.Manifest.Ports.Policy == "strict", Override: s.workspace.Manifest.Ports.Overrides[role]})
	if err == nil {
		s.leases[role] = lease
	}
	return lease, err
}
func (s *workspaceSupervisor) retryBind(ctx context.Context, role string, lease devsession.Lease) (devsession.Lease, error) {
	if err := s.registry.BindFailed(ctx, lease.Key, s.generation, lease.Port); err != nil {
		return lease, err
	}
	next, err := s.registry.Reallocate(ctx, lease.Key, s.generation)
	if err == nil {
		s.leases[role] = next
	}
	return next, err
}
func (s *workspaceSupervisor) addChild(role string, child *ownedChild) {
	s.mu.Lock()
	s.children[role] = child
	if role == "host" {
		s.lastHost = child
		if s.hostCaptureReady != nil {
			close(s.hostCaptureReady)
		}
	}
	s.mu.Unlock()
}
func (s *workspaceSupervisor) launch(ctx context.Context) error {
	deadline, cancel := context.WithTimeout(ctx, s.options.Timeout)
	defer cancel()
	cache, err := prepareWorkspaceBuildCache(deadline, s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return err
	}
	s.goBuildCache = cache
	initialChange := WatchChange{Nodes: []string{"host-backend"}}
	if err := s.beginFeedback(deadline, initialChange); err != nil {
		return err
	}
	// Seeding precedes A11's stopped-profile root lock, which may create .lock.
	// Never remove an existing lock inode or replace initialized state to seed.
	if err := s.seed(deadline); err != nil {
		return err
	}
	s.setPhase("linking", nil)
	graph, err := s.graph(deadline)
	if err != nil {
		return err
	}
	s.graphInstance = graph
	graph.rebuildEmbeddedFrontend = !s.options.LiveFrontend
	s.setPhase("building", nil)
	if err = graph.Bootstrap(deadline); err != nil {
		return err
	}
	hostSource, err := s.workspace.RepositoryPath("omniview")
	if err != nil {
		return err
	}
	if _, err = devcompose.Installed(s.workspace.ResolvedWorkspace, hostSource); err != nil {
		return fmt.Errorf("supervisor preparation did not complete the aggregate install and recursive peer transaction: %w", err)
	}
	if s.options.LiveFrontend {
		s.setPhase("starting-frontend", nil)
		if err = s.startVite(deadline); err != nil {
			return err
		}
	}
	s.setPhase("starting-host", nil)
	if err = s.startHost(deadline); err != nil {
		return err
	}
	s.setPhase("starting-plugins", nil)
	if err = s.startPlugins(deadline); err != nil {
		return err
	}
	client, descriptor, err := ConnectWorkspaceControl(deadline, s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return err
	}
	client.Close()
	s.mu.Lock()
	s.status.Instance = &descriptor
	s.mu.Unlock()
	if err := s.commitFeedback(deadline, initialChange); err != nil {
		return err
	}
	if s.options.Watch {
		done := make(chan struct{})
		s.mu.Lock()
		s.watchDone = done
		s.mu.Unlock()
		go func() {
			defer close(done)
			err := graph.Watch(ctx, s.watchHooks())
			if err != nil && ctx.Err() == nil {
				s.failed(err)
			}
		}()
	}
	s.monitorChildren(ctx)
	return nil
}

func (s *workspaceSupervisor) monitorChildren(ctx context.Context) {
	s.mu.Lock()
	children := map[string]*ownedChild{}
	for role, child := range s.children {
		children[role] = child
	}
	s.mu.Unlock()
	for role, child := range children {
		role, child := role, child
		child.monitorOnce.Do(func() {
			go func() {
				select {
				case <-ctx.Done():
					return
				case <-child.done:
				}
				s.mu.Lock()
				current := s.children[role] == child
				s.mu.Unlock()
				child.mu.Lock()
				stopping := child.stopping
				child.mu.Unlock()
				if !current || stopping {
					return
				}
				s.failed(child.failure())
				s.sessionCancel()
				s.runMu.Lock()
				_ = s.stopChildren(context.Background())
				s.runMu.Unlock()
			}()
		})
	}
}

func (s *workspaceSupervisor) startVite(ctx context.Context) error {
	if err := s.checkFeedback(); err != nil {
		return err
	}
	host, err := s.workspace.RepositoryPath("omniview")
	if err != nil {
		return err
	}
	composition, err := devcompose.Installed(s.workspace.ResolvedWorkspace, host)
	if err != nil {
		return err
	}
	node, script, err := resolveViteCommand(host)
	if err != nil {
		return err
	}
	lease, err := s.reserve(ctx, "vite")
	if err != nil {
		return err
	}
	allowed, err := s.graphInstance.ViteEnvironment()
	if err != nil {
		return err
	}
	for {
		writer, err := devoutputs.BeginVite(ctx, s.workspace.ResolvedWorkspace, host)
		if err != nil {
			return err
		}
		env := append(s.environment(), allowed...)
		env = append(env, devcompose.RootEnvironment+"="+composition.Root, "WAILS_VITE_PORT="+strconv.Itoa(lease.Port))
		env = append(env, writer.Environment...)
		output := &childOutput{output: s.output}
		child, err := startOwnedChild(s.childContext, host, env, output, devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: "vite", Source: host}, func() error { return writer.Finish(context.WithoutCancel(ctx)) }, node, script, "--host", "127.0.0.1", "--port", strconv.Itoa(lease.Port), "--strictPort")
		if child != nil {
			s.addChild("vite", child)
		}
		if err != nil {
			return err
		}
		address := "http://127.0.0.1:" + strconv.Itoa(lease.Port)
		var hmrAddress string
		err = waitForService(ctx, child, func(ctx context.Context) error {
			if output.failedBind(lease.Port) {
				return errOwnedBindFailure
			}
			// The owned strict Vite process must itself acknowledge this exact URL.
			if !output.contains(address) {
				return fmt.Errorf("owned Vite has not acknowledged its assigned URL")
			}
			hmrAddress, err = devsession.ProbeViteHMR(ctx, address)
			if err != nil {
				return err
			}
			observed, err := url.Parse(hmrAddress)
			if err != nil || observed.Host != "127.0.0.1:"+strconv.Itoa(lease.Port) {
				return fmt.Errorf("actual HMR listener differs from the owned assigned Vite port")
			}
			return nil
		})
		if err == nil {
			if err = s.registry.ConfirmBound(ctx, lease.Key, s.generation, lease.Port, child.identity); err != nil {
				return err
			}
			s.mu.Lock()
			if s.status.Services == nil {
				s.status.Services = map[string]ServiceStatus{}
			}
			s.status.Services["vite"] = ServiceStatus{URL: address, HMR: hmrAddress, Process: child.identity, Ready: true}
			s.mu.Unlock()
			s.persist()
			return nil
		}
		if stopErr := child.stop(context.Background()); stopErr != nil {
			return errors.Join(err, stopErr)
		}
		if !output.failedBind(lease.Port) {
			return err
		}
		lease, err = s.retryBind(ctx, "vite", lease)
		if err != nil {
			return err
		}
	}
}

func waitForService(ctx context.Context, child *ownedChild, probe func(context.Context) error) error {
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	var last error
	for {
		select {
		case <-child.done:
			return child.failure()
		default:
		}
		probeContext, cancel := context.WithTimeout(ctx, 3*time.Second)
		last = probe(probeContext)
		cancel()
		if errors.Is(last, errOwnedBindFailure) {
			return last
		}
		if last == nil {
			select {
			case <-child.done:
				return child.failure()
			default:
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("service readiness deadline: %w (last identity probe: %v)", ctx.Err(), last)
		case <-child.done:
			return child.failure()
		case <-ticker.C:
		}
	}
}

func (s *workspaceSupervisor) startHost(ctx context.Context) error {
	if err := s.checkFeedback(); err != nil {
		return err
	}
	host, err := s.workspace.RepositoryPath("omniview")
	if err != nil {
		return err
	}
	profile, err := profileFor(s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return err
	}
	if s.unixSocketDirectory == nil {
		// Retain even a partial creation handle. Its durable intent must not
		// be adopted or discarded if publication or filesystem sync fails.
		s.unixSocketDirectory, err = devsession.CreateUnixSocketDirectory(profile.RuntimeRoot, s.owner)
		if err != nil {
			return err
		}
	} else if _, err := devsession.ReadUnixSocketDirectory(profile.RuntimeRoot, s.workspace.Manifest.WorkspaceID, s.generation, s.workspace.Root); err != nil {
		return err
	}
	browser := devsession.Lease{}
	mcp := devsession.Lease{}
	if s.options.Mode == "browser" {
		browser, err = s.reserve(ctx, "browser")
		if err != nil {
			return err
		}
	}
	if s.options.MCP {
		mcp, err = s.reserve(ctx, "mcp")
		if err != nil {
			return err
		}
	}
	for {
		s.processMu.Lock()
		s.managedClosing = false
		s.processMu.Unlock()
		s.mu.Lock()
		s.hostCaptureReady = make(chan struct{})
		s.mu.Unlock()
		env := s.environment()
		env = append(env, "OMNIVIEW_PROCESS_BRIDGE_ENDPOINT="+strings.TrimSuffix(s.record.Endpoint, "/v1/supervisor")+"/v1/process", "OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE="+s.record.TokenFile)
		allowed, err := s.graphInstance.ViteEnvironment()
		if err != nil {
			return err
		}
		env = append(env, allowed...)
		pluginTools, err := s.pluginPNPMEnvironment(ctx)
		if err != nil {
			return err
		}
		env = append(env, pluginTools)
		if s.options.Mode == "browser" {
			env = append(env, "WAILS_SERVER_HOST=127.0.0.1", "WAILS_SERVER_PORT="+strconv.Itoa(browser.Port))
		}
		if s.options.LiveFrontend {
			vite := s.leases["vite"]
			env = append(env, "FRONTEND_DEVSERVER_URL=http://127.0.0.1:"+strconv.Itoa(vite.Port), "WAILS_VITE_PORT="+strconv.Itoa(vite.Port))
		}
		if s.options.MCP {
			token, err := devsession.GenerateToken()
			if err != nil {
				return err
			}
			path := launchPath(s.workspace, "mcp-"+s.generation+".secret")
			if err = writeLaunchSecret(path, token); err != nil {
				if !os.IsExist(err) {
					return err
				}
				token, err = os.ReadFile(path)
				if err != nil {
					return err
				}
			}
			env = append(env, "WAILS_MCP_HOST=127.0.0.1", "WAILS_MCP_PORT="+strconv.Itoa(mcp.Port), "WAILS_MCP_TOKEN="+string(token))
		}
		if s.options.Mode == "native" && runtime.GOOS == "darwin" {
			relative, err := filepath.Rel(launchPath(s.workspace, "bin"), s.binary)
			if err != nil {
				return err
			}
			if err = saveLaunchJSON(launchPath(s.workspace, "native-profile.json"), nativeProfileUse{WorkspaceID: s.workspace.Manifest.WorkspaceID, Binary: filepath.Join("bin", relative), Generation: s.generation}); err != nil {
				return err
			}
		}
		output := &childOutput{output: s.output}
		if s.options.Mode == "native" && runtime.GOOS == "darwin" {
			if _, err = prepareNativeSnapshot(s.workspace); err != nil {
				return err
			}
		}
		if s.options.Mode == "native" && runtime.GOOS == "linux" {
			env, err = profile.NativeHostEnvironment(env)
			if err != nil {
				return err
			}
		}
		child, err := startOwnedChild(s.childContext, host, env, output, devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: "host", Source: host}, nil, s.binary)
		if child != nil {
			s.addChild("host", child)
		}
		if err != nil {
			return err
		}
		target := devcontract.InstanceDescriptor{WorkspaceID: s.workspace.Manifest.WorkspaceID, InstanceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, StateRoot: s.workspace.StateRoot}
		err = waitForService(ctx, child, func(ctx context.Context) error {
			if s.options.Mode == "browser" && output.failedBind(browser.Port) || s.options.MCP && output.failedBind(mcp.Port) {
				return errOwnedBindFailure
			}
			client, descriptor, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation)
			if err != nil {
				return err
			}
			defer client.Close()
			if descriptor.Process != child.identity {
				return devcontract.Fail(4, "stale_target", "ready descriptor is not the exact captured host child")
			}
			if s.options.Mode == "browser" && descriptor.Readiness == "backend-ready" {
				if descriptor.WorkspaceID != target.WorkspaceID || descriptor.InstanceID != target.InstanceID || descriptor.Generation != target.Generation || descriptor.StateRoot != target.StateRoot {
					return devcontract.Fail(4, "stale_target", "host startup identity differs")
				}
			} else if err = hostDescriptorReady(descriptor, target); err != nil {
				return err
			}
			if s.options.Mode == "browser" {
				expected := "http://127.0.0.1:" + strconv.Itoa(browser.Port)
				if descriptor.Endpoints.Browser == nil || strings.TrimSuffix(*descriptor.Endpoints.Browser, "/") != expected {
					return fmt.Errorf("host has not confirmed its actual assigned browser endpoint")
				}
				if err = probeBrowser(ctx, expected, descriptor.BootIdentity()); err != nil {
					return err
				}
			}
			if s.options.MCP {
				expected := "http://127.0.0.1:" + strconv.Itoa(mcp.Port) + "/mcp"
				if descriptor.Endpoints.MCP == nil || *descriptor.Endpoints.MCP != expected {
					return fmt.Errorf("host has not confirmed authenticated assigned native MCP endpoint")
				}
			}
			s.mu.Lock()
			s.status.Instance = &descriptor
			s.mu.Unlock()
			return nil
		})
		if err == nil {
			if s.options.Mode == "browser" {
				if err = s.registry.ConfirmBound(ctx, browser.Key, s.generation, browser.Port, serviceIdentity(child, "browser")); err != nil {
					return err
				}
			}
			if s.options.MCP {
				if err = s.registry.ConfirmBound(ctx, mcp.Key, s.generation, mcp.Port, serviceIdentity(child, "mcp")); err != nil {
					return err
				}
			}
			return nil
		}
		if stopErr := child.stop(context.Background()); stopErr != nil {
			return errors.Join(err, stopErr)
		}
		if cleanupErr := s.stopManagedProcesses(ctx); cleanupErr != nil {
			return cleanupErr
		}
		// Retry only the actual failed listener reported by the owned host. A generic
		// startup/controller failure never consumes a guessed alternative port.
		if s.options.Mode == "browser" && output.failedBind(browser.Port) {
			browser, err = s.retryBind(ctx, "browser", browser)
		} else if s.options.MCP && output.failedBind(mcp.Port) {
			mcp, err = s.retryBind(ctx, "mcp", mcp)
		} else {
			return err
		}
		if err != nil {
			return err
		}
		if profile, e := profileFor(s.workspace, s.manager.options.Home, s.generation); e == nil {
			if store, e := devsession.OpenDiscoveryStore(profile.RuntimeRoot); e == nil {
				_ = store.Remove(ctx, s.workspace.Manifest.WorkspaceID, s.generation)
			}
		}
	}
}
func serviceIdentity(child *ownedChild, role string) devcontract.ProcessIdentity {
	identity := child.identity
	identity.Role = role
	return identity
}
func probeBrowser(ctx context.Context, address string, expected devcontract.BootIdentity) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"/", nil)
	if err != nil {
		return err
	}
	transport := &http.Transport{Proxy: nil}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return err
	}
	document := string(body)
	marker := "window.__OMNIVIEW_INSTANCE__="
	start := strings.Index(document, marker)
	if response.StatusCode != 200 || start < 0 {
		return fmt.Errorf("browser document has no actual boot identity")
	}
	start += len(marker)
	end := strings.Index(document[start:], ";</script>")
	var actual devcontract.BootIdentity
	if end < 0 || json.Unmarshal([]byte(document[start:start+end]), &actual) != nil || actual != expected {
		return fmt.Errorf("browser document boot identity differs from selected workspace generation")
	}
	return nil
}
func controlMutation(ctx context.Context, client *devcontrol.Client, operation string, params any, timeout time.Duration) (devcontract.Response, error) {
	response, err := client.Call(ctx, operation, params)
	if err != nil {
		return response, err
	}
	if response.Status == "accepted" || response.Status == "running" {
		if response.OperationID == "" {
			return response, fmt.Errorf("accepted operation has no operation identity")
		}
		return client.Wait(ctx, response.OperationID, timeout)
	}
	return response, nil
}
func (s *workspaceSupervisor) startPlugins(ctx context.Context) error {
	client, _, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return err
	}
	defer client.Close()
	for _, plugin := range s.workspace.Manifest.Plugins {
		path, err := s.workspace.RepositoryPath(plugin.RepositoryID)
		if err != nil {
			return err
		}
		if _, err = controlMutation(ctx, client, "plugin.dev.link", devcontrol.PathParams{Path: path}, s.options.Timeout); err != nil {
			return fmt.Errorf("managed plugin %s: %w", plugin.ID, err)
		}
		if err = s.waitPluginReady(ctx, plugin.ID, ""); err != nil {
			return err
		}
	}
	s.mu.Lock()
	s.hostFrontendPort = s.leases["vite"].Port
	s.hostReplacementPending = false
	s.mu.Unlock()
	return nil
}
func (s *workspaceSupervisor) pluginState(ctx context.Context, id string) (devcontrol.DevState, error) {
	client, _, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return devcontrol.DevState{}, err
	}
	defer client.Close()
	return readPluginState(ctx, client, id)
}

func readPluginState(ctx context.Context, client *devcontrol.Client, id string) (devcontrol.DevState, error) {
	var state devcontrol.DevState
	response, err := client.Call(ctx, "plugin.dev.status", devcontrol.PluginParams{ID: id})
	if err != nil {
		return state, err
	}
	err = json.Unmarshal(response.Result, &state)
	return state, err
}
func (s *workspaceSupervisor) waitPluginReady(ctx context.Context, id, generation string) error {
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		state, err := s.pluginState(ctx, id)
		if err != nil {
			return err
		}
		if generation != "" && state.Generation != generation {
			return devcontract.Fail(4, "stale_target", "managed plugin generation changed during readiness wait")
		}
		if stage := devcontract.FailedReadinessStage(state.BuildStatus, state.ViteStatus, state.RPCStatus, state.ControllerStatus); state.LastError != nil || stage != "" {
			return devcontract.Fail(5, "plugin_not_ready", fmt.Sprintf("managed plugin reported a failed readiness stage: build=%s Vite=%s RPC=%s controllers=%s", state.BuildStatus, state.ViteStatus, state.RPCStatus, state.ControllerStatus))
		}
		if state.Ready && state.Generation != "" {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

type remoteManagedBuild struct{ s *workspaceSupervisor }

func (r remoteManagedBuild) SetDependencyWatching(id, generation string, enabled bool) error {
	ctx, cancel := context.WithTimeout(r.s.sessionContext, 30*time.Second)
	defer cancel()
	client, _, err := ConnectWorkspaceControl(ctx, r.s.workspace, r.s.manager.options.Home, r.s.generation)
	if err != nil {
		return err
	}
	defer client.Close()
	_, err = controlMutation(ctx, client, "plugin.dev.dependencies", devcontrol.DependenciesParams{ID: id, Generation: generation, Enabled: enabled}, 30*time.Second)
	return err
}
func (r remoteManagedBuild) RebuildPluginGeneration(ctx context.Context, id, generation string) error {
	client, _, err := ConnectWorkspaceControl(ctx, r.s.workspace, r.s.manager.options.Home, r.s.generation)
	if err != nil {
		return err
	}
	defer client.Close()
	_, err = controlMutation(ctx, client, "plugin.dev.rebuild", devcontrol.RebuildParams{ID: id, Generation: generation}, r.s.options.Timeout)
	return err
}
func (s *workspaceSupervisor) watchHooks() WatchHooks {
	return WatchHooks{BeginFeedback: s.beginFeedback, CommitFeedback: s.commitFeedback, Managed: remoteManagedBuild{s: s}, Generations: func(ctx context.Context) (map[string]string, error) {
		generations := map[string]string{}
		for _, plugin := range s.workspace.Manifest.Plugins {
			state, err := s.pluginState(ctx, plugin.ID)
			if err != nil {
				return nil, err
			}
			// A08 has no Go watcher for frontend-only or stopped instances.
			// Keep capability readiness separate from dependency ownership.
			if state.Mode != "managed" || state.BuildStatus == "n/a" {
				continue
			}
			if state.Generation == "" {
				return nil, fmt.Errorf("managed plugin has no current generation")
			}
			generations[plugin.ID] = state.Generation
		}
		return generations, nil
	}, WaitPluginReady: s.waitPluginReady, HostRebuildAndWait: func(ctx context.Context, request HostBuildRequest) (map[string]bool, error) {
		s.runMu.Lock()
		defer s.runMu.Unlock()
		if err := s.replaceHost(ctx, &request); err != nil {
			return nil, err
		}
		s.monitorChildren(s.sessionContext)
		ready := map[string]bool{}
		for _, plugin := range s.workspace.Manifest.Plugins {
			ready[plugin.ID] = true
		}
		return ready, nil
	}, RefreshConsumers: func(ctx context.Context, change WatchChange) error {
		s.runMu.Lock()
		defer s.runMu.Unlock()
		hostRebuilt := feedbackReplacesHost(change)
		if !hostRebuilt && !feedbackRestartsConsumers(change) {
			// Source-only host/plugin components and CSS retain their existing
			// Vite document and Fast Refresh state; no Node restart is needed.
			return nil
		}
		s.mu.Lock()
		hostFrontendPort := s.hostFrontendPort
		hostReplacementPending := s.hostReplacementPending
		s.mu.Unlock()
		frontendRebindPending := s.options.LiveFrontend && (hostReplacementPending || hostFrontendPort != s.leases["vite"].Port)
		// Embedded host replacement already restarted the selected plugins and
		// awaited their actual readiness. Do not restart those consumers twice.
		// Pending replacements own plugin startup and may have no live host
		// control endpoint after an earlier failed launch.
		if !frontendRebindPending && (s.options.LiveFrontend || !hostRebuilt) {
			if err := s.refreshManagedConsumers(ctx, change); err != nil {
				return err
			}
		}
		if s.options.LiveFrontend {
			s.mu.Lock()
			old := s.children["vite"]
			s.mu.Unlock()
			if old != nil {
				if err := old.stop(ctx); err != nil {
					return err
				}
			}
			s.mu.Lock()
			if s.children["vite"] == old {
				delete(s.children, "vite")
			}
			s.mu.Unlock()
			if err := s.releaseRole(ctx, "vite"); err != nil {
				return err
			}
			if err := s.startVite(ctx); err != nil {
				return err
			}
			if hostReplacementPending || s.leases["vite"].Port != hostFrontendPort {
				if err := s.replaceHost(ctx, nil); err != nil {
					return err
				}
			}
		}
		s.monitorChildren(s.sessionContext)
		client, descriptor, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation)
		if err != nil {
			return err
		}
		client.Close()
		s.mu.Lock()
		s.status.Instance = &descriptor
		s.mu.Unlock()
		return nil
	}}
}

// replaceHost runs under runMu. Both compiled replacements and frontend
// rebindings retain the same disposal, lease, discovery, and readiness ordering.
func (s *workspaceSupervisor) replaceHost(ctx context.Context, build *HostBuildRequest) error {
	s.mu.Lock()
	s.hostReplacementPending = true
	s.mu.Unlock()
	if err := s.stopManagedPlugins(ctx); err != nil {
		return err
	}
	if err := s.stopManagedProcesses(ctx); err != nil {
		return err
	}
	s.mu.Lock()
	old := s.children["host"]
	s.status.Instance = nil
	s.mu.Unlock()
	if old != nil {
		if err := old.stop(ctx); err != nil {
			return err
		}
	}
	s.mu.Lock()
	if s.children["host"] == old {
		delete(s.children, "host")
	}
	s.mu.Unlock()
	if err := s.stopManagedProcesses(ctx); err != nil {
		return err
	}
	if err := s.releaseRole(ctx, "browser"); err != nil {
		return err
	}
	if err := s.releaseRole(ctx, "mcp"); err != nil {
		return err
	}
	if err := s.clearHostDiscovery(ctx); err != nil {
		return err
	}
	if build != nil {
		if err := s.buildHost(ctx, *build); err != nil {
			return err
		}
	}
	if err := s.startHost(ctx); err != nil {
		return err
	}
	return s.startPlugins(ctx)
}

func (s *workspaceSupervisor) releaseRole(ctx context.Context, role string) error {
	lease, exists := s.leases[role]
	if !exists {
		return nil
	}
	if err := s.registry.Release(ctx, lease.Key, s.generation); err != nil {
		return err
	}
	delete(s.leases, role)
	return nil
}

func (s *workspaceSupervisor) clearHostDiscovery(ctx context.Context) error {
	profile, err := profileFor(s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return err
	}
	store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
	if err != nil {
		return err
	}
	return store.Remove(ctx, s.workspace.Manifest.WorkspaceID, s.generation)
}

func (s *workspaceSupervisor) refreshManagedConsumers(ctx context.Context, change WatchChange) error {
	if !feedbackRestartsConsumers(change) {
		return nil
	}
	client, _, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return err
	}
	defer client.Close()
	for _, plugin := range s.workspace.Manifest.Plugins {
		if _, err = controlMutation(ctx, client, "plugin.dev.restart", devcontrol.PluginParams{ID: plugin.ID}, s.options.Timeout); err != nil {
			return err
		}
		if err = s.waitPluginReady(ctx, plugin.ID, ""); err != nil {
			return err
		}
	}
	return nil
}

func (s *workspaceSupervisor) pluginPNPMEnvironment(ctx context.Context) (string, error) {
	type command struct {
		Program       string   `json:"program"`
		Args          []string `json:"args"`
		Source        string   `json:"source"`
		WorkspaceRoot string   `json:"workspaceRoot"`
		Version       string   `json:"version"`
	}
	commands := map[string]command{}
	for _, plugin := range s.workspace.Manifest.Plugins {
		for _, node := range s.graphInstance.Nodes {
			if node.ID != "plugin-ui:"+plugin.ID {
				continue
			}
			composition, err := devcompose.Installed(s.workspace.ResolvedWorkspace, node.Directory)
			if err != nil {
				return "", err
			}
			program, args, err := s.graphInstance.PNPMCommand(ctx, node.PNPMVersion)
			if err != nil {
				return "", err
			}
			source, err := s.workspace.RepositoryPath(plugin.RepositoryID)
			if err != nil {
				return "", err
			}
			commands[plugin.ID] = command{Program: program, Args: args, Source: source, WorkspaceRoot: composition.Root, Version: composition.Version}
		}
	}
	encoded, err := json.Marshal(commands)
	if err != nil {
		return "", err
	}
	return "OMNIVIEW_PLUGIN_PNPM_COMMANDS=" + string(encoded), nil
}

func (s *workspaceSupervisor) stopManagedPlugins(ctx context.Context) error {
	s.mu.Lock()
	host := s.children["host"]
	last := s.lastHost
	s.mu.Unlock()
	if host == nil {
		if last != nil {
			select {
			case <-last.done:
				return nil
			default:
			}
		}
		return devcontract.Fail(4, "process_conflict", "no stopped owned host is available for replacement")
	}
	select {
	case <-host.done:
		return nil
	default:
	}
	client, _, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation)
	if err != nil {
		return err
	}
	defer client.Close()
	for _, plugin := range s.workspace.Manifest.Plugins {
		if _, err = controlMutation(ctx, client, "plugin.dev.stop", devcontrol.PluginParams{ID: plugin.ID}, 30*time.Second); err != nil {
			return err
		}
	}
	return nil
}
