package devworkspace

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

type supervisorRecord struct {
	WorkspaceID string                      `json:"workspaceID"`
	Generation  string                      `json:"generation"`
	Endpoint    string                      `json:"endpoint"`
	TokenFile   string                      `json:"tokenFile"`
	Process     devcontract.ProcessIdentity `json:"process"`
}

type workspaceSupervisor struct {
	manager          *Manager
	workspace        Workspace
	options          LaunchOptions
	generation       string
	owner            devcontract.ProcessIdentity
	record           supervisorRecord
	registry         *devsession.Registry
	output           io.Writer
	mu               sync.Mutex
	runMu            sync.Mutex
	status           Status
	binary           string
	children         map[string]*ownedChild
	leases           map[string]devsession.Lease
	graphInstance    *BuildGraph
	sessionCancel    context.CancelFunc
	sessionContext   context.Context
	exit             chan struct{}
	exitOnce         sync.Once
	launchDone       chan struct{}
	watchDone        chan struct{}
	childContext     context.Context
	goBuildCache     string
	childCancel      context.CancelFunc
	hostCaptureReady chan struct{}
	lastHost         *ownedChild
	// Committed only after the host and all managed plugins become ready.
	hostFrontendPort int
	// A partial replacement remains owed even if Vite reuses the committed port.
	hostReplacementPending bool
	processStartMu         sync.Mutex
	processMu              sync.Mutex
	managedProcesses       map[string]*managedProcessRecord
	managedKeys            map[string]string
	managedClosing         bool
	unixSocketDirectory    *devsession.UnixSocketDirectory
	feedbackMu             sync.Mutex
	feedback               *viteFeedback
	feedbackShutdownError  error
	ownedCleanupComplete   bool
}

func verifySupervisor(record supervisorRecord, w Workspace) error {
	if record.WorkspaceID != w.Manifest.WorkspaceID || record.Generation == "" {
		return devcontract.Fail(4, "stale_target", "supervisor identity does not match selected workspace")
	}
	endpoint, err := url.Parse(record.Endpoint)
	if err != nil || endpoint.Scheme != "http" || endpoint.Hostname() != "127.0.0.1" || endpoint.Port() == "" || endpoint.User != nil || endpoint.Path != "/v1/supervisor" || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return devcontract.Fail(4, "supervisor_conflict", "invalid private supervisor endpoint")
	}
	if err = devsession.VerifyOwnedProcess(record.Process, devsession.ProcessOwner{WorkspaceID: record.WorkspaceID, Generation: record.Generation, Role: "supervisor", Source: record.Process.Source}); err != nil {
		return err
	}
	if record.Process.Source != w.Root {
		return devcontract.Fail(4, "stale_target", "live supervisor source differs from the selected workspace root")
	}
	return nil
}
func readSupervisorToken(w Workspace, record supervisorRecord) ([]byte, error) {
	if record.TokenFile != launchPath(w, "supervisor-"+record.Generation+".secret") {
		return nil, devcontract.Fail(4, "supervisor_conflict", "supervisor token path differs from its generation")
	}
	if err := devsession.ValidatePrivateFile(record.TokenFile); err != nil {
		return nil, err
	}
	token, err := os.ReadFile(record.TokenFile)
	if err == nil && len(token) < 32 {
		err = devcontract.Fail(4, "supervisor_conflict", "supervisor token is invalid")
	}
	return token, err
}
func callSupervisor(ctx context.Context, record supervisorRecord, token []byte, command string) (Status, error) {
	var status Status
	raw, err := json.Marshal(map[string]string{"workspaceID": record.WorkspaceID, "generation": record.Generation, "command": command})
	if err != nil {
		return status, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, record.Endpoint, bytes.NewReader(raw))
	if err != nil {
		return status, err
	}
	request.Header.Set("Authorization", "Bearer "+string(token))
	request.Header.Set("Content-Type", "application/json")
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return status, err
	}
	defer response.Body.Close()
	var result struct {
		Status Status             `json:"status"`
		Error  *devcontract.Error `json:"error,omitempty"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 4<<20))
	if err = decoder.Decode(&result); err != nil {
		return status, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return status, devcontract.Fail(5, "invalid_response", "supervisor returned multiple JSON values")
	}
	if result.Error != nil {
		return result.Status, workspaceError(result.Error)
	}
	if response.StatusCode != http.StatusOK {
		return result.Status, devcontract.Fail(5, "supervisor_failed", "supervisor request failed")
	}
	if result.Status.Manifest.WorkspaceID != record.WorkspaceID || result.Status.Generation != record.Generation {
		return result.Status, devcontract.Fail(4, "stale_target", "supervisor response identity differs from the exact request")
	}
	return result.Status, nil
}

func supervisorHandler(workspaceID, generation string, token []byte, execute func(context.Context, string) (Status, error)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail := func(code int, err *devcontract.Error) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": err})
		}
		if r.Method != http.MethodPost || r.URL.Path != "/v1/supervisor" || r.URL.RawQuery != "" || r.Header.Get("Origin") != "" {
			fail(400, devcontract.Fail(2, "invalid_request", "supervisor accepts only explicit local POST requests"))
			return
		}
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if host != "127.0.0.1" {
			fail(400, devcontract.Fail(2, "invalid_request", "supervisor requires loopback Host"))
			return
		}
		credential := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(credential) != len(token) || subtle.ConstantTimeCompare([]byte(credential), token) != 1 {
			fail(401, devcontract.Fail(6, "unauthorized", "supervisor token required"))
			return
		}
		if r.Header.Get("Content-Type") != "application/json" {
			fail(400, devcontract.Fail(2, "invalid_request", "JSON request required"))
			return
		}
		var request struct {
			WorkspaceID string `json:"workspaceID"`
			Generation  string `json:"generation"`
			Command     string `json:"command"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF {
			fail(400, devcontract.Fail(2, "invalid_request", "invalid supervisor request"))
			return
		}
		if request.WorkspaceID != workspaceID || request.Generation != generation {
			fail(409, devcontract.Fail(4, "stale_target", "supervisor generation differs"))
			return
		}
		switch request.Command {
		case "status", "stop", "restart":
		default:
			fail(400, devcontract.Fail(2, "invalid_request", "unknown supervisor command"))
			return
		}
		status, err := execute(r.Context(), request.Command)
		w.Header().Set("Content-Type", "application/json")
		failure := workspaceError(err)
		_ = json.NewEncoder(w).Encode(map[string]any{"status": status, "error": failure})
	})
}

// ServeSupervisor is the long-lived hidden CLI entrypoint. It holds real Cmd
// ownership for every host/frontend lifetime; a later CLI only authenticates it.
func (m *Manager) ServeSupervisor(ctx context.Context, name string, output io.Writer) (resultErr error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return err
	}
	lockPath, err := GeneratedLockPath(w, "supervisor")
	if err != nil {
		return err
	}
	lockContext, cancelLock := context.WithTimeout(ctx, 250*time.Millisecond)
	lock, err := devsession.AcquirePrivateLock(lockContext, filepath.Dir(lockPath), filepath.Base(lockPath))
	cancelLock()
	if err != nil {
		return devcontract.Fail(4, "workspace_running", "another supervisor owns this workspace or its lock cannot be acquired")
	}
	defer lock.Unlock()
	log, err := openGeneratedLog(w, "supervisor.log")
	if err != nil {
		return err
	}
	defer log.Close()
	output = log
	defer func() {
		if resultErr != nil {
			_, _ = fmt.Fprintln(log, "supervisor failed:", resultErr)
		}
	}()
	options, err := LoadLaunchOptions(w)
	if err != nil {
		return err
	}
	if err = options.validate(); err != nil {
		return err
	}
	generation := NewGeneration()
	owner, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root})
	if err != nil {
		return err
	}
	registry, err := devsession.OpenRegistry(filepath.Join(m.options.Home, ".omniview-dev", "sessions"), devsession.RegistryOptions{})
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	token, err := devsession.GenerateToken()
	if err != nil {
		return err
	}
	record := supervisorRecord{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Endpoint: "http://" + listener.Addr().String() + "/v1/supervisor", TokenFile: launchPath(w, "supervisor-"+generation+".secret"), Process: owner}
	if err = writeLaunchSecret(record.TokenFile, token); err != nil {
		return err
	}
	// Source mutation guards from the short CLI must not reject this exact owner
	// while it applies the stopped overlay before any host child exists.
	localManager := *m
	s := &workspaceSupervisor{manager: &localManager, workspace: w, options: options, generation: generation, owner: owner, record: record, registry: registry, output: output, status: Status{Workspace: w, Generation: generation, Phase: "starting", Builds: map[string]BuildEvent{}}, children: map[string]*ownedChild{}, leases: map[string]devsession.Lease{}, exit: make(chan struct{})}
	s.sessionContext, s.sessionCancel = context.WithCancel(ctx)
	s.childContext, s.childCancel = context.WithCancel(context.WithoutCancel(ctx))
	defer s.childCancel()
	localManager.options.Stopped = func(ctx context.Context, selected devcontract.ResolvedWorkspace) error {
		if selected.Manifest.WorkspaceID != w.Manifest.WorkspaceID || selected.Root != w.Root {
			return devcontract.Fail(4, "stale_target", "bootstrap guard targets another workspace")
		}
		if err := devsession.VerifyOwnedProcess(owner, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root}); err != nil {
			return err
		}
		s.mu.Lock()
		host := s.children["host"]
		s.mu.Unlock()
		if host != nil {
			select {
			case <-host.done:
				if err := host.terminalStopError(); err != nil {
					return errors.Join(devcontract.Fail(4, "workspace_running", "owned host disposal is unresolved"), err)
				}
			default:
				return devcontract.Fail(4, "workspace_running", "owned host is already active")
			}
		}
		return ctx.Err()
	}
	if err = saveLaunchJSON(launchPath(w, "supervisor.json"), record); err != nil {
		return err
	}
	s.persist()
	mux := http.NewServeMux()
	mux.Handle("/v1/supervisor", supervisorHandler(w.Manifest.WorkspaceID, generation, token, s.execute))
	mux.Handle("/v1/process", s.processHandler(token))
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.Serve(listener) }()
	s.launchDone = make(chan struct{})
	go func() {
		defer close(s.launchDone)
		s.runMu.Lock()
		defer s.runMu.Unlock()
		if err := s.launch(s.sessionContext); err != nil {
			s.failed(err)
			_ = s.stopChildren(context.Background())
		}
	}()
	select {
	case <-ctx.Done():
	case <-s.exit:
	case err = <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			s.failed(err)
		}
	}
	s.sessionCancel()
	<-s.launchDone
	s.mu.Lock()
	watchDone := s.watchDone
	s.mu.Unlock()
	if watchDone != nil {
		<-watchDone
	}
	// Cancellation requests shutdown; it does not prove disposal. In particular,
	// never leave an unreaped Cmd behind by returning through the deferred closes.
	for {
		s.runMu.Lock()
		stopErr := s.stopChildren(context.Background())
		if stopErr == nil || s.ownedCleanupComplete {
			s.childCancel()
			if stopErr != nil {
				resultErr = errors.Join(resultErr, stopErr)
				s.failed(stopErr)
			} else {
				s.setPhase("stopped", nil)
			}
			s.runMu.Unlock()
			break
		}
		s.failed(errors.Join(err, stopErr))
		s.runMu.Unlock()
		// Keep serving authenticated Stop while ownership is unresolved. If the
		// HTTP server failed, retain the owner and its error until disposal works.
		time.Sleep(time.Second)
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	// Keep stopped metadata as truthful history. Never sweep another generation.
	return resultErr
}
func writeLaunchSecret(path string, token []byte) error { return writeOwnedLaunchSecret(path, token) }
func (s *workspaceSupervisor) environment() []string {
	env := append(workspaceEnvironment(os.Environ(), s.workspace, s.generation, s.options), "OMNIVIEW_DEV_CLI="+s.owner.Executable, "GOCACHE="+s.goBuildCache)
	s.feedbackMu.Lock()
	defer s.feedbackMu.Unlock()
	if s.feedback != nil {
		env = append(env, s.feedback.environment)
	}
	return env
}
func (s *workspaceSupervisor) snapshot() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, _ := json.Marshal(s.status)
	var status Status
	_ = json.Unmarshal(raw, &status)
	return status
}
func (s *workspaceSupervisor) persist() {
	if err := saveLaunchJSON(launchPath(s.workspace, "launch-status.json"), s.snapshot()); err != nil {
		s.mu.Lock()
		s.status.Phase = "error"
		s.status.LastError = devcontract.Fail(4, "generated_conflict", "cannot persist owned launch status; source metadata changed or write failed")
		s.mu.Unlock()
		if s.sessionCancel != nil {
			s.sessionCancel()
		}
		_, _ = fmt.Fprintln(s.output, "cannot persist owned launch status:", err)
	}
}
func (s *workspaceSupervisor) setPhase(phase string, err error) {
	var served map[string]CheckoutStatus
	if phase == "ready" {
		parent := s.sessionContext
		if parent == nil {
			parent = context.Background()
		}
		ctx, cancel := context.WithTimeout(parent, 30*time.Second)
		served = checkoutStatuses(ctx, s.workspace)
		cancel()
	}
	s.mu.Lock()
	if err != nil {
		s.status.FailedStage = s.status.Phase
		s.status.RecoveryCommand = "omniview-dev workspace refresh " + s.workspace.Manifest.WorkspaceID
	}
	if phase == "ready" {
		s.status.ServedCheckouts = served
		s.status.FailedStage = ""
		s.status.RecoveryCommand = ""
	}
	s.status.Phase = phase
	s.status.LastError = nil
	if phase == "stopped" || phase == "error" {
		s.status.Instance = nil
		for role, service := range s.status.Services {
			service.Ready = false
			s.status.Services[role] = service
		}
	}
	if err != nil {
		s.status.LastError = workspaceError(err)
	}
	s.mu.Unlock()
	s.persist()
}
func (s *workspaceSupervisor) failed(err error) { s.setPhase("error", err) }
func (s *workspaceSupervisor) execute(ctx context.Context, command string) (Status, error) {
	if command == "status" {
		status := s.snapshot()
		if status.Phase == "ready" {
			client, descriptor, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation)
			if err != nil {
				status.Phase = "unreachable"
				status.Instance = nil
			} else {
				defer client.Close()
				status.Instance = &descriptor
				// Reconcile live producer observations only in this response. A
				// transient build failure or intentional plugin stop must neither
				// poison the supervisor phase nor restart a managed generation.
				for _, plugin := range s.workspace.Manifest.Plugins {
					state, stateErr := readPluginState(ctx, client, plugin.ID)
					if stateErr != nil {
						status.Phase = "error"
						status.LastError = workspaceError(stateErr)
						break
					}
					if stage := devcontract.FailedReadinessStage(state.BuildStatus, state.ViteStatus, state.RPCStatus, state.ControllerStatus); state.LastError != nil || stage != "" || !state.Ready || state.Generation == "" || state.Mode != "managed" {
						status.Phase = "error"
						status.LastError = state.LastError
						if status.LastError == nil {
							status.LastError = devcontract.Fail(5, "plugin_not_ready", fmt.Sprintf("managed plugin %s is not ready: build=%s Vite=%s RPC=%s controllers=%s", plugin.ID, state.BuildStatus, state.ViteStatus, state.RPCStatus, state.ControllerStatus))
						}
						break
					}
				}
			}
		}
		return s.observeStatus(ctx, status), nil
	}
	if command == "stop" || command == "restart" {
		s.sessionCancel()
		s.runMu.Lock()
		err := s.stopChildren(ctx)
		if err != nil {
			s.failed(err)
		} else {
			s.setPhase("stopped", nil)
		}
		if s.ownedCleanupComplete {
			s.exitOnce.Do(func() { close(s.exit) })
		}
		s.runMu.Unlock()
		return s.snapshot(), err
	}
	return Status{}, fmt.Errorf("unknown supervisor operation")
}
func (s *workspaceSupervisor) stopChildren(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.ownedCleanupComplete {
		return s.feedbackShutdownError
	}
	integrityErr, holdErr := s.holdExistingFeedback(ctx)
	if holdErr != nil {
		return errors.Join(holdErr, s.feedbackShutdownError)
	}
	if integrityErr != nil && s.feedbackShutdownError == nil {
		// Feedback integrity never authorizes abandoning otherwise exact-owned
		// children. Retire them normally without repairing foreign metadata.
		s.feedbackShutdownError = integrityErr
	}
	if integrityErr != nil {
		if err := s.retireUnfencedFeedbackConsumers(ctx); err != nil {
			// Without a durable hold or confirmed feedback-process retirement,
			// preserve the live backend and every remaining ownership handle.
			return errors.Join(err, s.feedbackShutdownError)
		}
	}
	// Ask A08 to shut down each exact managed generation before host teardown.
	if client, _, err := ConnectWorkspaceControl(ctx, s.workspace, s.manager.options.Home, s.generation); err == nil {
		for _, plugin := range s.workspace.Manifest.Plugins {
			_, _ = controlMutation(ctx, client, "plugin.dev.stop", map[string]string{"id": plugin.ID}, 30*time.Second)
		}
		client.Close()
	}
	managedErr := s.stopManagedProcesses(ctx)
	s.mu.Lock()
	children := make(map[string]*ownedChild, len(s.children))
	for role, child := range s.children {
		children[role] = child
	}
	s.mu.Unlock()
	first := managedErr
	for _, role := range []string{"host", "vite"} {
		if child := children[role]; child != nil {
			if err := child.stop(ctx); err != nil {
				if first == nil {
					first = err
				}
			}
		}
	}
	if err := s.stopManagedProcesses(ctx); err != nil && first == nil {
		first = err
	}
	// Preserve every retained handle and capability if any disposal is still
	// uncertain. A later authenticated Stop must be able to retry the real owner.
	if first != nil {
		return errors.Join(first, s.feedbackShutdownError)
	}
	// The namespace may contain stale Unix socket inodes after a killed
	// plugin. Only confirmed disposal of every owned group authorizes cleanup.
	if s.unixSocketDirectory != nil {
		if err := s.unixSocketDirectory.Close(); err != nil {
			return errors.Join(err, s.feedbackShutdownError)
		}
		s.unixSocketDirectory = nil
	}
	for role, lease := range s.leases {
		if err := s.registry.Release(ctx, lease.Key, s.generation); err != nil {
			if first == nil {
				first = err
			}
			continue
		}
		delete(s.leases, role)
	}
	if first != nil {
		return errors.Join(first, s.feedbackShutdownError)
	}
	if err := s.clearHostDiscovery(ctx); err != nil {
		return errors.Join(err, s.feedbackShutdownError)
	}
	s.mu.Lock()
	for role, child := range children {
		if s.children[role] == child {
			delete(s.children, role)
		}
	}
	s.mu.Unlock()
	if err := s.closeFeedback(); err != nil {
		return errors.Join(err, s.feedbackShutdownError)
	}
	s.ownedCleanupComplete = true
	return s.feedbackShutdownError
}
