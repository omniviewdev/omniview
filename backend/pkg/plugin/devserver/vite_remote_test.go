//go:build !windows

package devserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/stretchr/testify/require"
)

// This fixture owns actual child Cmds and HTTP listeners. It isolates the host
// adapter from the CLI package import cycle, not from real output/exit behavior.
// A16 and the parent exercise the production supervisor dispatcher separately.
type remoteChildFixture struct {
	mu                   sync.Mutex
	processes            map[string]*remoteChildProcess
	starts               []devsession.ProcessStart
	workspace            devcontract.ResolvedWorkspace
	generation           string
	token                string
	overflow             bool
	advertiseOnly        bool
	waitUnavailable      bool
	changeManifestOnLogs bool
}
type remoteChildProcess struct {
	cmd      *exec.Cmd
	status   devsession.ProcessStatus
	done     chan struct{}
	reaping  bool
	outputMu sync.Mutex
	output   bytes.Buffer
}

func (p *remoteChildProcess) Write(data []byte) (int, error) {
	p.outputMu.Lock()
	defer p.outputMu.Unlock()
	return p.output.Write(data)
}

func (f *remoteChildFixture) serve(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer "+f.token {
		http.Error(w, "unauthorized", 401)
		return
	}
	var request devsession.ProcessRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid request", 400)
		return
	}
	response := devsession.ProcessResponse{RequestID: request.RequestID, WorkspaceID: request.WorkspaceID, Generation: request.Generation}
	f.mu.Lock()
	if request.Operation == "start" {
		start := request.Start
		if start == nil || start.Kind != "dev" || start.Source != filepath.Join(f.workspace.Root, "plugin") || start.PluginID != "remote" || start.PluginGeneration == "" {
			f.mu.Unlock()
			http.Error(w, "invalid source", 400)
			return
		}
		executable, err := os.Executable()
		if err != nil {
			f.mu.Unlock()
			http.Error(w, "fixture executable", 500)
			return
		}
		testName := "TestViteHTTPChildFixture"
		role := "plugin-vite"
		cmd := exec.Command(executable, "-test.run=^"+testName+"$")
		cmd.Dir = filepath.Join(start.Source, "ui")
		cmd.Env = goBuildEnv(append(os.Environ(), "OMNIVIEW_VITE_HTTP_FIXTURE=1", "OMNIVIEW_STATE_DIR="+f.workspace.StateRoot, "OMNIVIEW_VITE_PORT="+strconv.Itoa(start.Port), "OMNIVIEW_FIXTURE_ADVERTISE_ONLY="+strconv.FormatBool(f.advertiseOnly)))
		if f.advertiseOnly {
			cmd.Env = append(cmd.Env, "OMNIVIEW_FIXTURE_ADVERTISE_ONLY=1")
		}
		cmd.SysProcAttr = newProcessGroupAttr()
		process := &remoteChildProcess{cmd: cmd, done: make(chan struct{})}
		cmd.Stdout, cmd.Stderr = process, process
		if err = cmd.Start(); err != nil {
			f.mu.Unlock()
			http.Error(w, "fixture start", 500)
			return
		}
		identity, err := devsession.CaptureProcess(cmd.Process.Pid, devsession.ProcessOwner{WorkspaceID: f.workspace.Manifest.WorkspaceID, Generation: f.generation, Role: role, Source: start.Source})
		if err != nil {
			_ = killProcessGroup(cmd.Process.Pid)
			_ = cmd.Wait()
			f.mu.Unlock()
			http.Error(w, "fixture capture", 500)
			return
		}
		id := strconv.Itoa(len(f.starts) + 1)
		process.status = devsession.ProcessStatus{ProcessID: id, Identity: identity, Running: true}
		f.starts = append(f.starts, *start)
		f.processes[id] = process
		status := process.status
		response.Process = &status
		go func() {
			_ = awaitOwnedExit(cmd.Process.Pid)
			f.mu.Lock()
			if !process.reaping {
				_ = killProcessGroup(cmd.Process.Pid)
				process.reaping = true
			}
			f.mu.Unlock()
			err := cmd.Wait()
			f.mu.Lock()
			process.status.Running = false
			if err != nil {
				process.status.ExitCode = 1
			}
			close(process.done)
			f.mu.Unlock()
		}()
		f.mu.Unlock()
	} else {
		process := f.processes[request.ProcessID]
		if process == nil {
			f.mu.Unlock()
			http.Error(w, "unknown process", 404)
			return
		}
		switch request.Operation {
		case "stop":
			if !process.reaping {
				_ = killProcessGroup(process.cmd.Process.Pid)
				process.reaping = true
			}
			f.mu.Unlock()
			select {
			case <-process.done:
			case <-r.Context().Done():
				return
			}
			f.mu.Lock()
		case "wait":
			if f.waitUnavailable {
				f.mu.Unlock()
				http.Error(w, "wait transport interrupted", 503)
				return
			}
			f.mu.Unlock()
			select {
			case <-process.done:
			case <-r.Context().Done():
				return
			}
			f.mu.Lock()
		case "logs":
			if f.changeManifestOnLogs {
				path := filepath.Join(f.workspace.Root, "plugin", "ui", "package.json")
				if err := os.WriteFile(path, []byte(`{"name":"changed-before-ready","private":true,"packageManager":"pnpm@12.14.0"}`), 0600); err != nil {
					f.mu.Unlock()
					http.Error(w, "fixture manifest write", 500)
					return
				}
				f.changeManifestOnLogs = false
			}
			process.outputMu.Lock()
			data := process.output.String()
			process.outputMu.Unlock()
			cursor := request.Cursor
			if cursor < 0 || cursor > int64(len(data)) {
				f.mu.Unlock()
				http.Error(w, "invalid cursor", 400)
				return
			}
			end := int64(len(data))
			if request.Limit > 0 && end-cursor > int64(request.Limit) {
				end = cursor + int64(request.Limit)
			}
			response.Logs = &devsession.ProcessLogPage{Data: data[cursor:end], NextCursor: end, EOF: !process.status.Running && end == int64(len(data)), Overflow: f.overflow}
		case "status":
		default:
			f.mu.Unlock()
			http.Error(w, "unknown operation", 400)
			return
		}
		if response.Logs == nil {
			status := process.status
			response.Process = &status
		}
		f.mu.Unlock()
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func remoteFrontendFixture(t *testing.T, overflow, advertiseOnly bool) (*viteProcess, *remoteChildFixture) {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	id := "dc68dba0-49a1-4852-97ba-8b4da3f88abe"
	generation := "c659f178-31c3-45b2-92ec-237bf538c876"
	manifest := devcontract.WorkspaceManifest{SchemaVersion: 1, WorkspaceID: id, Slug: "remote", DisplayName: "Remote fixture", Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}, Repositories: []devcontract.Repository{{ID: "omniview", Directory: "host", BaseRef: "main", BaseCommit: strings.Repeat("a", 40), Branch: "fixture"}, {ID: "plugin", Directory: "plugin", BaseRef: "main", BaseCommit: strings.Repeat("b", 40), Branch: "fixture"}}, Plugins: []devcontract.Plugin{{ID: "remote", RepositoryID: "plugin", Mode: "managed"}}}
	for _, dir := range []string{"host", "plugin/ui", ".local"} {
		require.NoError(t, os.MkdirAll(filepath.Join(root, dir), 0700))
	}
	require.NoError(t, devcontract.EnsureDefaultProfileOwnership(home, id))
	data, err := json.Marshal(manifest)
	require.NoError(t, err)
	file := filepath.Join(root, "workspace.json")
	require.NoError(t, os.WriteFile(file, data, 0600))
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: file, Home: home})
	require.NoError(t, err)
	installedCompositionFixture(t, workspace)
	host, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: id, Generation: generation, Role: "host", Source: filepath.Join(root, "host")})
	require.NoError(t, err)
	token := strings.Repeat("s", 64)
	tokenFile := filepath.Join(root, ".local", "supervisor-"+generation+".secret")
	require.NoError(t, os.WriteFile(tokenFile, []byte(token), 0600))
	fixture := &remoteChildFixture{workspace: workspace, generation: generation, token: token, processes: map[string]*remoteChildProcess{}, overflow: overflow, advertiseOnly: advertiseOnly}
	server := httptest.NewServer(http.HandlerFunc(fixture.serve))
	t.Cleanup(server.Close)
	client, err := devsession.NewProcessBridgeClient(devsession.ProcessBridgeConfig{Endpoint: server.URL + "/v1/process", TokenFile: tokenFile, WorkspaceFile: file, WorkspaceID: id, Generation: generation, Host: host})
	require.NoError(t, err)
	t.Cleanup(client.Close)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	require.NoError(t, listener.Close())
	options := BuildOpts{Workspace: &workspace, Generation: "plugin-generation", ProcessSupervisor: client, PnpmPath: "must-not-run-local-pnpm", PnpmArgs: []string{"must-not-forward-prefix"}, NodePath: "must-not-run-local-node"}
	process := newViteProcess(context.Background(), logging.NewNop(), "remote", filepath.Join(root, "plugin"), port, options, func(LogEntry) {}, func(DevProcessStatus) {})
	t.Cleanup(func() {
		_ = process.Stop()
		fixture.mu.Lock()
		for _, child := range fixture.processes {
			if !child.reaping {
				_ = killProcessGroup(child.cmd.Process.Pid)
				child.reaping = true
			}
		}
		children := make([]*remoteChildProcess, 0, len(fixture.processes))
		for _, child := range fixture.processes {
			children = append(children, child)
		}
		fixture.mu.Unlock()
		for _, child := range children {
			<-child.done
		}
	})
	return process, fixture
}

func TestRemoteViteConsumesInstalledCompositionAndOwnsActualReadinessExitAndStop(t *testing.T) {
	process, fixture := remoteFrontendFixture(t, false, false)
	allocator := newTestPortAllocator(t)
	registry, err := devsession.OpenRegistry(t.TempDir(), devsession.RegistryOptions{})
	require.NoError(t, err)
	allocator.registry = registry
	allocator.owner, err = devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: fixture.workspace.Manifest.WorkspaceID, Generation: fixture.generation, Role: "host", Source: fixture.workspace.ManifestPath})
	require.NoError(t, err)
	process.port, err = allocator.Allocate("remote")
	require.NoError(t, err)
	allocator.sources["remote"] = process.devPath
	process.buildOpts.ViteStarted = func(identity devcontract.ProcessIdentity) error {
		return allocator.RecordProcess(process.port, identity)
	}
	require.NoError(t, process.Start())
	require.NoError(t, process.WaitReady())
	require.NoError(t, allocator.ConfirmBound("remote"), "actual retained child must satisfy existing A06 role/source/generation lease binding")
	require.Equal(t, fixture.generation, allocator.pids[process.port].Generation)
	require.Equal(t, "plugin-vite", allocator.pids[process.port].Role)
	require.Nil(t, process.cmd, "remote ownership must never fabricate an exec.Cmd")
	require.Zero(t, process.PGID(), "host has no remote process-group signal authority")
	require.Positive(t, process.PID())
	require.NoError(t, probeVite(context.Background(), fmt.Sprintf("http://127.0.0.1:%d", process.port)))
	fixture.mu.Lock()
	starts := append([]devsession.ProcessStart(nil), fixture.starts...)
	fixture.mu.Unlock()
	require.Len(t, starts, 1)
	require.Equal(t, "dev", starts[0].Kind)
	require.Empty(t, starts[0].PNPMPath, "graph command is not an explicit developer override")
	require.Empty(t, starts[0].NodePath)
	require.NoError(t, process.Stop())
	allocator.Release(process.port)
	require.NoError(t, allocator.SavePIDs())
	select {
	case <-process.done:
	case <-time.After(time.Second):
		t.Fatal("actual remote exit was not observed")
	}
	require.Error(t, probeVite(context.Background(), fmt.Sprintf("http://127.0.0.1:%d", process.port)))
}

func TestManagedViteRefusesMissingStaleOrTamperedCompositionBeforeSpawn(t *testing.T) {
	for _, mutation := range []string{"missing", "stale", "tampered"} {
		t.Run(mutation, func(t *testing.T) {
			process, fixture := remoteFrontendFixture(t, false, false)
			// Existing module directories must not authorize a missing transaction.
			require.NoError(t, os.MkdirAll(filepath.Join(process.devPath, "ui", "node_modules"), 0700))
			switch mutation {
			case "missing":
				require.NoError(t, os.Remove(filepath.Join(fixture.workspace.Root, ".local", "links.json")))
			case "stale":
				require.NoError(t, os.WriteFile(filepath.Join(process.devPath, "ui", "package.json"), []byte(`{"name":"changed","private":true,"packageManager":"pnpm@12.14.0","peerDependencies":{"react":"18.x"}}`), 0600))
			case "tampered":
				require.NoError(t, os.WriteFile(filepath.Join(fixture.workspace.Root, "pnpm-workspace.yaml"), []byte("packages: []\n"), 0600))
			}
			require.ErrorContains(t, process.Start(), "reconfigure")
			fixture.mu.Lock()
			require.Empty(t, fixture.starts, "refusal must not start Vite or a hidden installer")
			fixture.mu.Unlock()
			require.Nil(t, process.cmd)
			require.Nil(t, process.remote)
		})
	}
}

func TestManagedViteCannotBecomeReadyAfterCompositionChangesDuringStart(t *testing.T) {
	process, fixture := remoteFrontendFixture(t, false, false)
	fixture.changeManifestOnLogs = true
	require.NoError(t, process.Start())
	require.ErrorContains(t, process.WaitReady(), "reconfigure")
	require.NoError(t, process.Stop(), "the real retained process must still terminate after readiness refusal")
}

func TestRemoteViteLostOutputAndAdvertisementWithoutHTTPFailReadiness(t *testing.T) {
	for _, overflow := range []bool{false, true} {
		t.Run(strconv.FormatBool(overflow), func(t *testing.T) {
			process, _ := remoteFrontendFixture(t, overflow, !overflow)
			require.NoError(t, process.Start())
			require.Error(t, process.WaitReady())
			require.NoError(t, process.Stop())
		})
	}
}

func TestRemoteWaitTransportFailureDoesNotMeanChildExit(t *testing.T) {
	process, fixture := remoteFrontendFixture(t, false, false)
	fixture.waitUnavailable = true
	require.NoError(t, process.Start())
	require.Error(t, process.WaitReady())
	require.Eventually(t, func() bool {
		return probeVite(context.Background(), fmt.Sprintf("http://127.0.0.1:%d", process.port)) == nil
	}, 2*time.Second, 10*time.Millisecond)
	select {
	case <-process.done:
		t.Fatal("transport failure falsely confirmed process exit")
	default:
	}
	status, err := process.remote.Status(context.Background())
	require.NoError(t, err)
	require.True(t, status.Running)
	require.NoError(t, process.Stop(), "actual retained owner must still stop the live child")
	select {
	case <-process.done:
	default:
		t.Fatal("actual successful stop did not confirm exit")
	}
}

func TestRetainedSupervisorLiveRecordIsNeitherSignalledNorErasedByHostRecovery(t *testing.T) {
	allocator := newTestPortAllocator(t)
	allocator.supervised = true
	var err error
	allocator.owner, err = devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: "dc68dba0-49a1-4852-97ba-8b4da3f88abe", Generation: "current", Role: "host", Source: t.TempDir()})
	require.NoError(t, err)
	child := exec.Command("sleep", "300")
	child.Env = goBuildEnv(os.Environ())
	require.NoError(t, child.Start())
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	owner := devsession.ProcessOwner{WorkspaceID: allocator.owner.WorkspaceID, Generation: allocator.owner.Generation, Role: "plugin-vite", Source: t.TempDir()}
	identity, err := devsession.CaptureProcess(child.Process.Pid, owner)
	require.NoError(t, err)
	data, err := json.Marshal(map[int]devcontract.ProcessIdentity{15173: identity})
	require.NoError(t, err)
	require.NoError(t, allocator.stateRoot.WriteFile(devserverPIDFileName, data, 0600))
	allocator.CleanupStaleProcesses(context.Background(), logging.NewNop())
	require.NoError(t, devsession.VerifyOwnedProcess(identity, owner), "only the retained supervisor may signal its actual Cmd")
	require.NoError(t, allocator.SavePIDs())
	retained, err := allocator.stateRoot.ReadFile(devserverPIDFileName)
	require.NoError(t, err)
	require.JSONEq(t, string(data), string(retained), "same generation alone does not prove a child stopped")
}
