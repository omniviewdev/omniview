//go:build darwin || linux

package devworkspace

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestManagedBridgeOwnsActualProcessesThroughHostCrash(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("actual Node executable unavailable")
	}
	node, err = devcontract.CanonicalPath(node)
	if err != nil {
		t.Fatal(err)
	}
	w := generatedFixture(t)
	// Concurrent test binaries have separate registries but share loopback ports.
	// A distinct workspace identity avoids the same deterministic sticky port.
	w.Manifest.WorkspaceID = uuid.NewString()
	home, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.StateRoot = filepath.Join(home, ".omniview-dev", "profiles", w.Manifest.WorkspaceID, "state")
	w.Manifest.Repositories = append(w.Manifest.Repositories, devcontract.Repository{ID: "plugin-fixture", Directory: "plugin-fixture", BaseRef: "main", BaseCommit: w.Manifest.Repositories[0].BaseCommit, Branch: "main"})
	w.Manifest.Plugins = []devcontract.Plugin{{ID: "fixture-plugin", RepositoryID: "plugin-fixture", Mode: "managed"}}
	hostSource := filepath.Join(w.Root, "omniview")
	pluginSource := filepath.Join(w.Root, "plugin-fixture")
	frontend := filepath.Join(pluginSource, "custom frontend")
	for _, directory := range []string{hostSource, frontend} {
		if err = os.MkdirAll(directory, 0700); err != nil {
			t.Fatal(err)
		}
	}
	script := `const http=require('node:http');const a=process.argv.slice(2);if(a.length!==6||a[0]!=='dev'||a[1]!=='--port'||a[3]!=='--strictPort'||a[4]!=='--host'||a[5]!=='127.0.0.1')throw new Error('unexpected fixed arguments');const p=Number(a[2]);http.createServer((q,r)=>r.end(JSON.stringify({cwd:process.cwd(),root:process.env.PNPM_CONFIG_WORKSPACE_DIR||'',alias:process.env.npm_config_workspace_dir||'',bridge:process.env.OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE||'',fds:process.env.OMNIVIEW_NATIVE_PURGE_LOCK_FDS||''}))).listen(p,'127.0.0.1');`
	// The explicit PNPM executable override is actual Node; Node executes this
	// selected frontend's "run" script with the supervisor's fixed dev arguments.
	if err = os.WriteFile(filepath.Join(frontend, "run"), []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{hostSource, frontend} {
		if err = os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"name":"fixture","private":true,"packageManager":"pnpm@12.14.0"}`), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for i, directory := range []string{hostSource, pluginSource} {
		if err = os.WriteFile(filepath.Join(directory, ".gitignore"), []byte("node_modules/\n"), 0600); err != nil {
			t.Fatal(err)
		}
		git := func(args ...string) []byte {
			t.Helper()
			command := exec.Command("git", args...)
			command.Dir = directory
			data, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("git %v: %s %v", args, data, err)
			}
			return data
		}
		git("init", "-b", "main")
		git("config", "user.name", "Fixture")
		git("config", "user.email", "fixture@example.invalid")
		git("add", ".")
		git("commit", "-m", "fixture")
		w.Manifest.Repositories[i].BaseCommit = strings.TrimSpace(string(git("rev-parse", "HEAD")))
		w.Manifest.Repositories[i].Branch = "main"
	}
	if err = writeManifest(w.Root, w.Manifest); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE", "/foreign/private-token")
	t.Setenv("OMNIVIEW_PROCESS_BRIDGE_ENDPOINT", "http://127.0.0.1:1/v1/process")
	t.Setenv("OMNIVIEW_NATIVE_PURGE_LOCK_FDS", `{"uuid":999}`)
	t.Setenv("PNPM_CONFIG_WORKSPACE_DIR", "/foreign/root")
	t.Setenv("npm_config_workspace_dir", "/foreign/alias")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	session, sessionCancel := context.WithCancel(context.Background())
	defer sessionCancel()
	composition := supervisorCompositionFixture(t, w, hostSource, frontend)
	installed, err := devoutputs.BeginCompositionInstall(ctx, w.ResolvedWorkspace, composition)
	if err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{w.Root, hostSource, frontend} {
		if err = os.MkdirAll(filepath.Join(directory, "node_modules"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err = installed.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	generation := NewGeneration()
	host, err := startOwnedChild(ctx, hostSource, os.Environ(), io.Discard, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "host", Source: hostSource}, nil, "/bin/sleep", "300")
	if err != nil {
		t.Fatal(err)
	}
	defer host.stop(context.Background())
	registry, err := devsession.OpenRegistry(filepath.Join(home, "sessions"), devsession.RegistryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	s := &workspaceSupervisor{workspace: w, generation: generation, manager: &Manager{options: Options{Home: home}}, registry: registry, children: map[string]*ownedChild{}, childContext: ctx, sessionContext: session, sessionCancel: sessionCancel, hostCaptureReady: make(chan struct{}), output: io.Discard, graphInstance: &BuildGraph{workspace: w, plan: linkPlan{Composition: &composition}, Nodes: []BuildNode{{ID: "plugin-ui:fixture-plugin", Directory: frontend, PNPMVersion: "12.14.0"}}}}
	s.addChild("host", host)
	defer func() { s.runMu.Lock(); defer s.runMu.Unlock(); _ = s.stopChildren(context.Background()) }()
	token := []byte("private-process-bridge-test-authorization")
	server := httptest.NewServer(s.processHandler(token))
	defer server.Close()
	owner := host.identity
	owner.Source = w.ManifestPath
	key := devsession.ServiceKey{WorkspaceID: w.Manifest.WorkspaceID, Role: "plugin-vite", PluginID: "fixture-plugin"}
	lease, err := registry.Reserve(ctx, devsession.LeaseRequest{Key: key, Owner: owner})
	if err != nil {
		t.Fatal(err)
	}
	start := devsession.ProcessStart{PluginID: "fixture-plugin", PluginGeneration: NewGeneration(), Kind: "dev", Source: pluginSource, Port: lease.Port, PNPMPath: node}
	request := devsession.ProcessRequest{RequestID: NewGeneration(), WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Host: host.identity, Operation: "start", Start: &start}
	call := func(body any, authorization string) (int, devsession.ProcessResponse) {
		t.Helper()
		data, _ := json.Marshal(body)
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/process", bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", authorization)
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var result devsession.ProcessResponse
		if err = json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, result
	}
	if code, result := call(request, "Bearer wrong"); code != 401 || result.Error == nil || len(s.managedProcesses) != 0 {
		t.Fatalf("unauthenticated request caused work: %d %+v", code, result)
	}
	wrong := start
	wrong.Source = hostSource
	request.Start = &wrong
	if _, result := call(request, "Bearer "+string(token)); result.Error == nil || len(s.managedProcesses) != 0 {
		t.Fatal("unselected source started a command")
	}
	legacy := start
	legacy.Kind, legacy.Port = "install", 0
	request.Start = &legacy
	if _, result := call(request, "Bearer "+string(token)); result.Error == nil || len(s.managedProcesses) != 0 {
		t.Fatal("managed process bridge allowed a second per-plugin install")
	}
	request.Start = &start
	code, result := call(request, "Bearer "+string(token))
	if code != 200 || result.Error != nil || result.Process == nil {
		t.Fatalf("actual command did not start: %d %+v", code, result)
	}
	_, duplicate := call(request, "Bearer "+string(token))
	if duplicate.Error != nil || duplicate.Process == nil || duplicate.Process.ProcessID != result.Process.ProcessID || len(s.managedProcesses) != 1 {
		t.Fatal("same accepted start was not reconciled idempotently")
	}
	address := "http://127.0.0.1:" + strconv.Itoa(lease.Port)
	client := &http.Client{Timeout: time.Second}
	var observed struct{ Cwd, Root, Alias, Bridge, Fds string }
	for {
		response, probeErr := client.Get(address)
		if probeErr == nil {
			decodeErr := json.NewDecoder(response.Body).Decode(&observed)
			response.Body.Close()
			if decodeErr == nil {
				break
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal("actual selected frontend did not bind")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if observed.Cwd != frontend || observed.Root != w.Root {
		t.Fatalf("wrong selected frontend on port %d: cwd = %q, want %q; root = %q, want %q", lease.Port, observed.Cwd, frontend, observed.Root, w.Root)
	}
	if observed.Alias != "" || observed.Bridge != "" || observed.Fds != "" {
		t.Fatalf("private host capabilities leaked: %+v", observed)
	}
	assertManagedObservationDuringBlockedStart(t, ctx, server.URL, string(token), pluginSource, result.Process.ProcessID, request)

	if err = registry.ConfirmBound(ctx, key, generation, lease.Port, result.Process.Identity); err != nil {
		t.Fatal(err)
	}
	foreign, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer foreign.Close()
	// Crash the actual retained host handle; stop() is an intentional shutdown
	// and correctly suppresses the crash monitor during watch replacement.
	if err = host.command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-host.done:
	case <-ctx.Done():
		t.Fatal("crashed host did not reach its retained terminal observer")
	}
	if response, err := client.Get(address); err != nil {
		t.Fatalf("managed process lifetime incorrectly depended on host Cmd: %v", err)
	} else {
		response.Body.Close()
	}
	s.monitorChildren(ctx)
	s.processMu.Lock()
	record := s.managedProcesses[result.Process.ProcessID]
	s.processMu.Unlock()
	select {
	case <-record.child.done:
	case <-ctx.Done():
		t.Fatal("host crash orphaned outer-owned managed group")
	}
	for {
		leases, readErr := registry.List(ctx, w.Manifest.WorkspaceID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		released := false
		for _, current := range leases {
			if current.Key == key && current.State == devsession.LeaseReleased {
				released = true
			}
		}
		if released {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("exited owned process retained bound lease")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if response, err := client.Get(address); err == nil {
		response.Body.Close()
		t.Fatal("managed listener survived actual host-crash cleanup")
	}
	connection, err := net.DialTimeout("tcp", foreign.Addr().String(), time.Second)
	if err != nil {
		t.Fatalf("foreign listener affected: %v", err)
	}
	connection.Close()
}
