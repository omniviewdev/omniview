//go:build devcontrol && (darwin || linux)

package devworkspace

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

func init() {
	if os.Getenv("OMNIVIEW_REPLACEMENT_HOST_FIXTURE") == "1" {
		os.Args = []string{os.Args[0], "-test.run=^TestSupervisorReplacementHostFixture$"}
	}
}

type replacementPluginProducer struct {
	readinessProducer
	devcontrol.Plugins
	source, endpoint, failureFile string
}

func (p *replacementPluginProducer) InstallDevPluginFromPath(source string) (sdktypes.PluginInfo, error) {
	if source != p.source {
		return sdktypes.PluginInfo{}, errors.New("plugin source differs from selected fixture")
	}
	return sdktypes.PluginInfo{ID: "fixture-plugin"}, nil
}

func (p *replacementPluginProducer) WaitReady(_ context.Context, id, generation string) (devcontrol.DevState, error) {
	state, err := p.Status(id)
	if err != nil {
		return state, err
	}
	if generation == "" || state.Generation != generation {
		return state, devcontract.Fail(4, "stale_target", "fixture plugin generation changed")
	}
	if p.failureFile != "" {
		initialEndpoint, err := os.ReadFile(p.failureFile)
		if err == nil && p.endpoint != string(initialEndpoint) {
			return state, devcontract.Fail(5, "dependency_failed", "selected plugin failed readiness after host replacement")
		}
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return state, err
		}
	}
	return state, nil
}

func (p *replacementPluginProducer) Stop(_ context.Context, id string) error {
	state, err := p.Status(id)
	if err != nil {
		return err
	}
	state.Ready = false
	state.Mode = "idle"
	state.ViteStatus = "stopped"
	p.states[id] = state
	return nil
}

// This subprocess is an actual authenticated host control server. Its descriptor
// reports the frontend URL captured at process creation, not the current lease.
func TestSupervisorReplacementHostFixture(t *testing.T) {
	if os.Getenv("OMNIVIEW_REPLACEMENT_HOST_FIXTURE") != "1" {
		return
	}
	profile, err := instance.Resolve(instance.Options{EnvironmentManifest: os.Getenv(devcontract.WorkspaceEnvironment), StateRoot: os.Getenv("OMNIVIEW_STATE_DIR"), Home: os.Getenv("OMNIVIEW_REPLACEMENT_HOME"), Generation: os.Getenv("OMNIVIEW_GENERATION"), Channel: "local"})
	if err != nil {
		t.Fatal(err)
	}
	descriptor := profile.Descriptor
	source, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	descriptor.Process, err = devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: descriptor.WorkspaceID, Generation: descriptor.Generation, Role: "host", Source: source})
	if err != nil {
		t.Fatal(err)
	}
	endpoint := os.Getenv("FRONTEND_DEVSERVER_URL")
	descriptor.Endpoints.Vite = &endpoint
	descriptor.Readiness = "host-ready"
	store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	producer := &replacementPluginProducer{readinessProducer: readinessProducer{states: map[string]devcontrol.DevState{}}, endpoint: endpoint, failureFile: os.Getenv("OMNIVIEW_REPLACEMENT_PLUGIN_FAILURE")}
	for _, plugin := range profile.Workspace.Manifest.Plugins {
		producer.source, err = profile.Workspace.RepositoryPath(plugin.RepositoryID)
		if err != nil {
			t.Fatal(err)
		}
		producer.states[plugin.ID] = devcontrol.DevState{PluginState: devcontract.PluginState{ID: plugin.ID, Mode: "managed", Generation: NewGeneration(), BuildStatus: "n/a", ViteStatus: "ready", RPCStatus: "n/a", ControllerStatus: "n/a"}, Ready: true}
	}
	server, err := devcontrol.Start(context.Background(), devcontrol.Config{Descriptor: descriptor, Discovery: store, Adapters: devcontrol.Adapters{Inspect: func(context.Context) (devcontract.InstanceDescriptor, error) { return descriptor, nil }, Dev: producer, Plugins: producer, Settings: struct{ devcontrol.Settings }{}}})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close(context.Background())
	select {}
}

func TestSupervisorFrontendReplacementRetryRetainsHostBinding(t *testing.T) {
	testSupervisorFrontendReplacementRetry(t, false, false)
}

func TestSupervisorFrontendReplacementRetryAfterHostStartFailure(t *testing.T) {
	testSupervisorFrontendReplacementRetry(t, true, false)
}

func TestSupervisorFrontendReplacementRetryAfterPluginFailureReturnsToPriorPort(t *testing.T) {
	testSupervisorFrontendReplacementRetry(t, false, true)
}

func testSupervisorFrontendReplacementRetry(t *testing.T, failStart, failPlugins bool) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("Node is required for the actual Vite child")
	}
	installedVite, err := filepath.Abs(filepath.Join("..", "..", "node_modules", "vite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(installedVite, "bin", "vite.js")); err != nil {
		t.Skip("installed Vite is required for the actual frontend child")
	}
	w := generatedFixture(t)
	home, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.StateRoot = filepath.Join(home, ".omniview-dev", "profiles", w.Manifest.WorkspaceID, "state")
	host, err := w.RepositoryPath("omniview")
	if err != nil {
		t.Fatal(err)
	}
	if failPlugins {
		w.Manifest.Repositories = append(w.Manifest.Repositories, devcontract.Repository{ID: "fixture-plugin", Directory: "fixture-plugin", BaseRef: "main", BaseCommit: w.Manifest.Repositories[0].BaseCommit, Branch: "feature/fixture"})
		w.Manifest.Plugins = []devcontract.Plugin{{ID: "fixture-plugin", RepositoryID: "fixture-plugin", Mode: "managed"}}
		if err := os.MkdirAll(filepath.Join(w.Root, "fixture-plugin"), 0700); err != nil {
			t.Fatal(err)
		}
		if err := writeManifest(w.Root, w.Manifest); err != nil {
			t.Fatal(err)
		}
	}
	writeGraphFixture(t, filepath.Join(host, "package.json"), `{"name":"replacement-fixture","private":true,"packageManager":"pnpm@12.14.0"}`)
	writeGraphFixture(t, filepath.Join(host, "index.html"), "<html>replacement fixture</html>")
	writeGraphFixture(t, filepath.Join(host, "vite.config.mjs"), "export default { cacheDir: process.env.OMNIVIEW_VITE_CACHE_DIRECTORY };\n")
	writeGraphFixture(t, filepath.Join(host, ".gitignore"), "node_modules/\n")
	fixtureGit(t, host, "init")
	fixtureGit(t, host, "add", ".")
	fixtureGit(t, host, "commit", "-m", "replacement host fixture")
	composition := supervisorCompositionFixture(t, w, host)
	writer, err := devoutputs.BeginCompositionInstall(context.Background(), w.ResolvedWorkspace, composition)
	if err != nil {
		t.Fatal(err)
	}
	for _, root := range []string{w.Root, host} {
		if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(installedVite, filepath.Join(host, "node_modules", "vite")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Finish(context.Background()); err != nil {
		t.Fatal(err)
	}
	generation := NewGeneration()
	cache, err := prepareWorkspaceBuildCache(context.Background(), w, home, generation)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root})
	if err != nil {
		t.Fatal(err)
	}
	registryOptions := devsession.RegistryOptions{}
	if failPlugins {
		for range 16 {
			first, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			port := first.Addr().(*net.TCPAddr).Port
			second, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(port+1))
			_ = first.Close()
			if err == nil {
				_ = second.Close()
				registryOptions.MinPort, registryOptions.MaxPort = port, port+1
				break
			}
		}
		if registryOptions.MinPort == 0 {
			t.Fatal("could not reserve two adjacent test ports")
		}
	}
	registry, err := devsession.OpenRegistry(filepath.Join(home, "sessions"), registryOptions)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("OMNIVIEW_REPLACEMENT_HOST_FIXTURE", "1")
	t.Setenv("OMNIVIEW_REPLACEMENT_HOME", home)
	failureFile := filepath.Join(w.Root, ".local", "plugin-startup-failure")
	if failPlugins {
		t.Setenv("OMNIVIEW_REPLACEMENT_PLUGIN_FAILURE", failureFile)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	s := &workspaceSupervisor{workspace: w, generation: generation, owner: owner, manager: &Manager{options: Options{Home: home}}, registry: registry, children: map[string]*ownedChild{}, leases: map[string]devsession.Lease{}, graphInstance: &BuildGraph{workspace: w}, binary: os.Args[0], goBuildCache: cache, options: LaunchOptions{LiveFrontend: true}, output: os.Stderr, childContext: ctx, sessionContext: ctx, sessionCancel: cancel}
	t.Cleanup(func() { _ = s.stopChildren(context.Background()) })
	if err := s.startVite(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.startHost(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.startPlugins(ctx); err != nil {
		t.Fatal(err)
	}
	originalHost := s.children["host"]
	originalPort := s.leases["vite"].Port
	if failPlugins {
		if err := os.WriteFile(failureFile, []byte("http://127.0.0.1:"+strconv.Itoa(originalPort)), 0600); err != nil {
			t.Fatal(err)
		}
	}
	var blocker net.Listener
	originalVite := s.children["vite"]
	t.Cleanup(func() {
		_ = originalVite.stop(context.Background())
		if blocker != nil {
			_ = blocker.Close()
		}
	})
	originalVite.mu.Lock()
	finalize := originalVite.finalize
	originalVite.finalize = func() error {
		if err := finalize(); err != nil {
			return err
		}
		var err error
		blocker, err = net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(originalPort))
		return err
	}
	originalVite.mu.Unlock()
	stopTree := originalHost.stopTree
	denied := errors.New("replacement host disposal denied")
	if failStart {
		s.binary = filepath.Join(w.Root, "missing-host")
	} else if !failPlugins {
		originalHost.stopTree = func(bool) error { return denied }
	}
	defer func() { originalHost.stopTree = stopTree }()
	change := WatchChange{Nodes: []string{"host-backend"}, RuntimeChanged: failStart}
	err = s.watchHooks().RefreshConsumers(ctx, change)
	if failStart {
		if !errors.Is(err, os.ErrNotExist) || s.children["host"] != nil {
			t.Fatalf("A-to-B replacement did not reach host launch after disposal: %v", err)
		}
	} else if failPlugins {
		var failure *devcontract.Error
		if !errors.As(err, &failure) || failure.Code != "dependency_failed" || s.children["host"] == nil || s.children["host"] == originalHost {
			t.Fatalf("A-to-B replacement did not reach new host plugin readiness failure: %v", err)
		}
	} else if !errors.Is(err, denied) || s.children["host"] != originalHost {
		t.Fatalf("A-to-B replacement did not retain its unresolved host: %v", err)
	}
	replacementPort := s.leases["vite"].Port
	if originalPort == replacementPort {
		t.Fatalf("failed attempt did not reach frontend B: %+v", s.leases)
	}
	originalHost.stopTree = stopTree
	s.binary = os.Args[0]
	if failPlugins {
		failedHost := s.children["host"]
		if err := blocker.Close(); err != nil {
			t.Fatal(err)
		}
		blocker = nil
		if err := os.Remove(failureFile); err != nil {
			t.Fatal(err)
		}
		currentVite := s.children["vite"]
		var replacementBlocker net.Listener
		t.Cleanup(func() {
			_ = currentVite.stop(context.Background())
			if replacementBlocker != nil {
				_ = replacementBlocker.Close()
			}
		})
		currentVite.mu.Lock()
		finish := currentVite.finalize
		currentVite.finalize = func() error {
			if err := finish(); err != nil {
				return err
			}
			var err error
			replacementBlocker, err = net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(replacementPort))
			return err
		}
		currentVite.mu.Unlock()
		if err := s.watchHooks().RefreshConsumers(ctx, change); err != nil {
			t.Fatalf("B-to-A retry failed: %v", err)
		}
		if s.leases["vite"].Port != originalPort {
			t.Fatalf("retry did not return frontend to A: %+v", s.leases)
		}
		if s.children["host"] == failedHost {
			t.Fatal("A-to-B-to-A retry forgot unresolved replacement after plugin readiness failure")
		}
		client, descriptor, err := ConnectWorkspaceControl(ctx, s.workspace, home, generation)
		if err != nil {
			t.Fatal(err)
		}
		defer client.Close()
		want := "http://127.0.0.1:" + strconv.Itoa(originalPort)
		if descriptor.Endpoints.Vite == nil || *descriptor.Endpoints.Vite != want {
			t.Fatalf("recovered host did not capture frontend A: %+v", descriptor.Endpoints)
		}
		return
	}
	if err := s.watchHooks().RefreshConsumers(ctx, change); err != nil {
		t.Fatalf("B-to-B retry failed: %v", err)
	}
	if s.children["host"] == originalHost {
		t.Fatal("B-to-B retry forgot that the retained host still targets frontend A")
	}
	client, descriptor, err := ConnectWorkspaceControl(ctx, s.workspace, home, generation)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	want := "http://127.0.0.1:" + strconv.Itoa(replacementPort)
	if descriptor.Endpoints.Vite == nil || *descriptor.Endpoints.Vite != want {
		t.Fatalf("replacement host did not capture frontend B: %+v", descriptor.Endpoints)
	}
	replacementHost := s.children["host"]
	if err := s.watchHooks().RefreshConsumers(ctx, change); err != nil {
		t.Fatalf("same-endpoint refresh failed after successful replacement: %v", err)
	}
	if s.children["host"] != replacementHost {
		t.Fatal("successful endpoint replacement left a stale host-rebinding obligation")
	}
}
