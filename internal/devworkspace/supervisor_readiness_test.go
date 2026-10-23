//go:build devcontrol

package devworkspace

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// This adapter supplies producer observations at the authenticated control
// boundary; the supervisor and dependency-watch handoff remain real.
type readinessProducer struct {
	devcontrol.Dev
	states map[string]devcontrol.DevState
}

func (p *readinessProducer) Status(id string) (devcontrol.DevState, error) {
	state, ok := p.states[id]
	if !ok {
		return state, errors.New("plugin not selected")
	}
	return state, nil
}
func (p *readinessProducer) SetDependencyWatching(_ context.Context, id, generation string, _ bool) error {
	state, err := p.Status(id)
	if err != nil || state.Mode != "managed" || state.Generation != generation || state.BuildStatus == "n/a" {
		return errors.New("managed backend watcher source/generation changed")
	}
	return nil
}

func readinessSupervisor(t *testing.T, states map[string]devcontrol.DevState) (*workspaceSupervisor, *readinessProducer) {
	t.Helper()
	w := generatedFixture(t)
	home, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.StateRoot = filepath.Join(home, ".omniview-dev", "profiles", w.Manifest.WorkspaceID, "state")
	host := filepath.Join(w.Root, "omniview")
	if err = os.MkdirAll(host, 0700); err != nil {
		t.Fatal(err)
	}
	for id := range states {
		w.Manifest.Repositories = append(w.Manifest.Repositories, devcontract.Repository{ID: id, Directory: id, BaseRef: "main", BaseCommit: w.Manifest.Repositories[0].BaseCommit, Branch: "feature/fixture"})
		w.Manifest.Plugins = append(w.Manifest.Plugins, devcontract.Plugin{ID: id, RepositoryID: id, Mode: "managed"})
		if err = os.MkdirAll(filepath.Join(w.Root, id), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err = writeManifest(w.Root, w.Manifest); err != nil {
		t.Fatal(err)
	}
	generation := NewGeneration()
	profile, err := profileFor(w, home, generation)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := profile.Descriptor
	descriptor.Process, err = devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "host", Source: host})
	if err != nil {
		t.Fatal(err)
	}
	descriptor.Readiness = "host-ready"
	store, err := devsession.OpenDiscoveryStore(profile.RuntimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	producer := &readinessProducer{states: states}
	server, err := devcontrol.Start(context.Background(), devcontrol.Config{Descriptor: descriptor, Discovery: store, Adapters: devcontrol.Adapters{Inspect: func(context.Context) (devcontract.InstanceDescriptor, error) { return descriptor, nil }, Dev: producer, Plugins: struct{ devcontrol.Plugins }{}, Settings: struct{ devcontrol.Settings }{}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close(context.Background()) })
	s := &workspaceSupervisor{workspace: w, generation: generation, manager: &Manager{options: Options{Home: home}}, sessionContext: context.Background(), options: LaunchOptions{Timeout: time.Second}, output: io.Discard, status: Status{Workspace: w, Generation: generation, Phase: "ready"}}
	return s, producer
}

func TestSupervisorFrontendOnlyDependencyWatchHandoffStaysHealthy(t *testing.T) {
	s, _ := readinessSupervisor(t, map[string]devcontrol.DevState{
		"frontend": {PluginState: devcontract.PluginState{ID: "frontend", Mode: "managed", Generation: "frontend-generation", BuildStatus: "n/a", ViteStatus: "ready", RPCStatus: "n/a", ControllerStatus: "n/a"}, Ready: true},
		"backend":  {PluginState: devcontract.PluginState{ID: "backend", Mode: "managed", Generation: "backend-generation", BuildStatus: "ready", ViteStatus: "n/a", RPCStatus: "ready", ControllerStatus: "ready"}, Ready: true},
		"stopped":  {PluginState: devcontract.PluginState{ID: "stopped", Mode: "idle", BuildStatus: "stopped", ViteStatus: "stopped", RPCStatus: "stopped", ControllerStatus: "stopped"}},
	})
	generations, err := (&BuildGraph{}).disableManagedDependencies(context.Background(), s.watchHooks())
	if err != nil {
		t.Fatalf("frontend-only/stopped plugin killed dependency-watch handoff: %v", err)
	}
	if len(generations) != 1 || generations["backend"] != "backend-generation" {
		t.Fatalf("dependency ownership must include only active backend generations: %v", generations)
	}
	if err = s.waitPluginReady(context.Background(), "frontend", "frontend-generation"); err != nil {
		t.Fatalf("frontend capability readiness was lost: %v", err)
	}
}

func TestSupervisorLiveReadinessReflectsPluginFailureAndRecovery(t *testing.T) {
	for _, stage := range []string{"build", "vite", "rpc", "controller", "last-error", "stopped", "building"} {
		t.Run(stage, func(t *testing.T) {
			ready := devcontrol.DevState{PluginState: devcontract.PluginState{ID: "plugin", Mode: "managed", Generation: "original-plugin-generation", BuildStatus: "ready", ViteStatus: "ready", RPCStatus: "ready", ControllerStatus: "ready"}, Ready: true}
			s, producer := readinessSupervisor(t, map[string]devcontrol.DevState{"plugin": ready})
			assertStatus := func(wantReady bool) {
				t.Helper()
				status, err := s.execute(context.Background(), "status")
				if err != nil || (status.Phase == "ready") != wantReady || status.Generation != s.generation || status.Instance == nil {
					t.Fatalf("live readiness=%v: %+v %v", wantReady, status, err)
				}
				if !wantReady && status.LastError == nil {
					t.Fatal("not-ready status lost the current readiness error")
				}
				if wantReady && status.LastError != nil {
					t.Fatalf("actual recovery retained stale error: %+v", status.LastError)
				}
				if s.snapshot().Phase != "ready" || producer.states["plugin"].Generation != "original-plugin-generation" {
					t.Fatal("inspection mutated supervisor lifecycle or managed generation")
				}
			}
			assertStatus(true)
			failed := ready
			failed.Ready = false
			switch stage {
			case "build":
				failed.BuildStatus = "error"
			case "vite":
				failed.ViteStatus = "error"
			case "rpc":
				failed.RPCStatus = "error"
			case "controller":
				failed.ControllerStatus = "error"
			case "last-error":
				failed.LastError = devcontract.Fail(5, "dependency_failed", "plugin build or readiness failed")
			case "stopped":
				failed.Mode, failed.BuildStatus, failed.ViteStatus = "idle", "stopped", "stopped"
			case "building":
				failed.BuildStatus = "building"
			}
			producer.states["plugin"] = failed
			assertStatus(false)
			// A second read must not restart an intentionally stopped producer or
			// make a failed producer ready merely because the host is reachable.
			assertStatus(false)
			producer.states["plugin"] = ready
			assertStatus(true)
		})
	}
}

func TestSupervisorWaitPluginReadyRejectsTerminalStages(t *testing.T) {
	for _, stage := range []string{"build", "vite", "rpc", "controller", "last-error"} {
		t.Run(stage, func(t *testing.T) {
			state := devcontrol.DevState{PluginState: devcontract.PluginState{ID: "plugin", Mode: "managed", Generation: "selected-generation", BuildStatus: "ready", ViteStatus: "ready", RPCStatus: "ready", ControllerStatus: "ready"}}
			switch stage {
			case "build":
				state.BuildStatus = "error"
			case "vite":
				state.ViteStatus = "error"
			case "rpc":
				state.RPCStatus = "error"
			case "controller":
				state.ControllerStatus = "error"
			case "last-error":
				state.LastError = devcontract.Fail(5, "dependency_failed", "readiness failed")
			}
			s, _ := readinessSupervisor(t, map[string]devcontrol.DevState{"plugin": state})
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			err := s.waitPluginReady(ctx, "plugin", state.Generation)
			var failure *devcontract.Error
			if !errors.As(err, &failure) || failure.Code != "plugin_not_ready" {
				t.Fatalf("terminal %s failure must stop readiness rather than wait for cancellation: %v", stage, err)
			}
			err = s.waitPluginReady(ctx, "plugin", "replaced-generation")
			if !errors.As(err, &failure) || failure.Code != "stale_target" {
				t.Fatalf("stage failure overrode the exact-generation check: %v", err)
			}
		})
	}
}
