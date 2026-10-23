package devserver

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devsource"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

func TestBuildSuccessDoesNotConnectRPC(t *testing.T) {
	inst, _, _ := newTestInstance(t, "stages")
	inst.hasBackend = true
	inst.setGoStatus(DevProcessStatusBuilding)
	inst.setBuildResult(time.Millisecond, "")
	state := inst.State()
	if state.GRPCConnected || state.Ready || state.RPCStatus == StageReady {
		t.Fatalf("compilation reported runtime readiness: %+v", state)
	}
	inst.notifyLifecycle(true, true, nil)
	if !inst.State().GRPCConnected {
		t.Fatal("actual lifecycle observation did not connect RPC")
	}
	inst.notifyLifecycle(false, false, errors.New("process exited"))
	if inst.State().Ready || inst.State().GRPCConnected {
		t.Fatal("crash retained readiness")
	}
}

func TestCapabilityReadinessIsNotApplicable(t *testing.T) {
	inst, _, _ := newTestInstance(t, "ui-only")
	inst.hasUI = true
	inst.initializeStages()
	inst.setViteStatus(DevProcessStatusReady)
	state := inst.State()
	if state.GRPCConnected || state.RPCStatus != StageNotApplicable || state.ControllerStatus != StageNotApplicable || !state.Ready {
		t.Fatalf("UI-only stage mismatch: %+v", state)
	}
}

func TestViteProbeRequiresActualViteHTTP(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/@vite/client" {
			w.Header().Set("Content-Type", "application/javascript")
			_, _ = w.Write([]byte("export const vite = true"))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := probeVite(ctx, server.URL); err != nil {
		t.Fatal(err)
	}
	missing := httptest.NewServer(http.NotFoundHandler())
	defer missing.Close()
	if err := probeVite(ctx, missing.URL); err == nil {
		t.Fatal("non-Vite HTTP endpoint reported ready")
	}
}

func TestChildBuildEnvironmentOverridesInheritedWorkspace(t *testing.T) {
	env := goBuildEnv([]string{"GOWORK=/foreign/go.work", "GOROOT=/foreign/go", "PATH=/tools"})
	found := false
	for _, entry := range env {
		if entry == "GOWORK=off" {
			found = true
		}
		if entry == "GOWORK=/foreign/go.work" || entry == "GOROOT=/foreign/go" {
			t.Fatalf("unsafe inherited environment: %v", env)
		}
	}
	if !found {
		t.Fatal("GOWORK=off missing")
	}
}

func TestNodeAndGoChildEnvironmentDoesNotInheritProcessBridgeAuthority(t *testing.T) {
	environment := goBuildEnv([]string{"PATH=/tools", "OMNIVIEW_PROCESS_BRIDGE_ENDPOINT=http://127.0.0.1:1/v1/process", "OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE=/private/secret", "OMNIVIEW_STATE_DIR=/workspace/state", "OMNIVIEW_WORKSPACE_ID=selected"})
	require.Equal(t, []string{"PATH=/tools", "OMNIVIEW_STATE_DIR=/workspace/state", "OMNIVIEW_WORKSPACE_ID=selected", "GOWORK=off"}, environment)
}

func TestSDKRevisionRequiresTrustedExactCommit(t *testing.T) {
	for _, revision := range []string{"", "7bc9616", "main", "dirty", "0000000000000000000000000000000000000000"} {
		if validSDKRevision(revision) {
			t.Fatalf("accepted untrusted/non-exact revision %q", revision)
		}
	}
}

func TestManagedLeasesSeparateWorkspacesAndRemainSticky(t *testing.T) {
	registry, err := devsession.OpenRegistry(t.TempDir(), devsession.RegistryOptions{})
	require.NoError(t, err)
	first := newTestPortAllocator(t)
	second := newTestPortAllocator(t)
	first.registry, second.registry = registry, registry
	first.owner, err = devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: "9f479dc5-9fd0-4359-915a-ed307fbe5510", Generation: "first", Role: "host", Source: t.TempDir()})
	require.NoError(t, err)
	second.owner, err = devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: "cf5bd0a4-d197-47fb-8dfe-93bf51fb2c2d", Generation: "second", Role: "host", Source: t.TempDir()})
	require.NoError(t, err)
	a, err := first.Allocate("same-plugin")
	require.NoError(t, err)
	b, err := second.Allocate("same-plugin")
	require.NoError(t, err)
	require.NotEqual(t, a, b)
	first.Release(a)
	sticky, err := first.Allocate("same-plugin")
	require.NoError(t, err)
	require.Equal(t, a, sticky)
}

func TestBuildMetadataReplacesUntrustedYAMLAttestation(t *testing.T) {
	source := managedSourceFixture(t, "metadata")
	path := filepath.Join(source, "plugin.yaml")
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	data = append(data, []byte("state_isolation:\n  sdk_revision: forged\n  binary_sha256: forged\n")...)
	require.NoError(t, os.WriteFile(path, data, 0600))
	root := appstate.NewTestService(t).Plugins()
	gw := &goWatcherProcess{pluginID: "metadata", devPath: source, pluginsRoot: root}
	require.NoError(t, gw.syncPluginYaml())
	installed, err := sdktypes.LoadPluginMetadata(root.ResolvePath("metadata"))
	require.NoError(t, err)
	require.Nil(t, installed.StateIsolation)
	gw.buildRelativePath = filepath.Join("metadata", ".test-build", "plugin")
	require.NoError(t, root.MkdirAll(filepath.Dir(gw.buildRelativePath), 0700))
	binary := root.ResolvePath(gw.buildRelativePath)
	require.NoError(t, root.WriteFile(gw.buildRelativePath, []byte("built artifact fixture"), 0700))
	gw.selectedSDK = devsource.Identity{Directory: source, ReviewedRevision: strings.Repeat("a", 40), SourceDigest: strings.Repeat("b", 64)}
	require.NoError(t, gw.syncPluginYaml())
	installed, err = sdktypes.LoadPluginMetadata(root.ResolvePath("metadata"))
	require.NoError(t, err)
	require.NoError(t, installed.StateIsolation.VerifyArtifact(binary, gw.selectedSDK.ReviewedRevision, gw.selectedSDK.SourceDigest))
	original, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, data, original, "never rewrite source metadata")
}

func TestViteLegacyRecoveryRecordsAreRetained(t *testing.T) {
	allocator := newTestPortAllocator(t)
	legacy := []byte("{\"15173\":12345}")
	require.NoError(t, allocator.stateRoot.WriteFile(devserverPIDFileName, legacy, 0600))
	allocator.CleanupStaleProcesses(context.Background(), logging.NewNop())
	require.NoError(t, allocator.SavePIDs())
	retained, err := allocator.stateRoot.ReadFile(devserverPIDFileName)
	require.NoError(t, err)
	require.JSONEq(t, string(legacy), string(retained))
}

func TestBackendOnlyFailureKeepsWatcherWithoutAllocatingVite(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	manager := newTestManager(t)
	source := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(source, "plugin.yaml"), []byte("id: backend-only\nname: Backend fixture\nversion: 1.0.0\ncapabilities: [resource]\n"), 0600))
	require.NoError(t, os.MkdirAll(filepath.Join(source, "pkg"), 0700))
	state, err := manager.StartDevServerForPath("backend-only", source)
	require.ErrorContains(t, err, "resolve go tool")
	require.Equal(t, DevProcessStatusNotApplicable, state.ViteStatus)
	require.Zero(t, state.VitePort)
	require.Equal(t, StageError, state.BuildStatus)
	require.False(t, state.Ready)
	require.True(t, manager.IsManaged("backend-only"), "failed build must remain watched and recoverable")
	require.Empty(t, manager.ports.assigned)
	require.NoError(t, manager.StopDevServer("backend-only"))
}

func TestRebuildInvalidatesOldBackendBeforeArtifactReady(t *testing.T) {
	inst, _, _ := newTestInstance(t, "replacement")
	inst.hasBackend = true
	inst.initializeStages()
	inst.setGoStatus(DevProcessStatusReady)
	inst.notifyLifecycle(true, true, nil)
	require.True(t, inst.State().Ready)
	inst.setGoStatus(DevProcessStatusBuilding)
	pending := inst.State()
	require.False(t, pending.GRPCConnected)
	require.Equal(t, StagePending, pending.RPCStatus)
	require.Equal(t, StagePending, pending.ControllerStatus)
	inst.setBuildResult(time.Millisecond, "")
	inst.setGoStatus(DevProcessStatusReady)
	require.False(t, inst.State().Ready, "new artifact cannot reuse the prior backend's observations")
	inst.notifyLifecycle(false, false, errors.New("replacement RPC failed"))
	require.False(t, inst.State().Ready)
}

func TestPriorBackendObservationCannotReadyReplacementBuild(t *testing.T) {
	manager := newTestManager(t)
	source := managedSourceFixture(t, "epoch")
	inst, _, _ := newTestInstance(t, "epoch")
	inst.devPath = source
	inst.hasBackend = true
	manager.instances["epoch"] = inst
	old := manager.RuntimeGeneration("epoch", source)
	inst.setGoStatus(DevProcessStatusBuilding)
	inst.setGoStatus(DevProcessStatusReady)
	require.False(t, manager.NotifyPluginLifecycle("epoch", source, old, true, true, nil))
	require.False(t, inst.State().Ready)
	current := manager.RuntimeGeneration("epoch", source)
	require.NotEqual(t, old, current)
	require.True(t, manager.NotifyPluginLifecycle("epoch", source, current, true, true, nil))
	require.True(t, inst.State().Ready)
}

func TestStaleManagedGenerationReportsConflict(t *testing.T) {
	manager := &DevServerManager{instances: map[string]*DevServerInstance{
		"plugin": {generation: "current-generation"},
	}}
	for _, generation := range []string{"previous-generation", ""} {
		t.Run(generation, func(t *testing.T) {
			checks := map[string]func() error{
				"rebuild": func() error {
					return manager.RebuildPluginGeneration(context.Background(), "plugin", generation)
				},
				"readiness": func() error {
					_, err := manager.WaitReady(context.Background(), "plugin", generation)
					return err
				},
				"dependency watching": func() error {
					return manager.SetDependencyWatching("plugin", generation, true)
				},
			}
			for name, check := range checks {
				t.Run(name, func(t *testing.T) {
					err := check()
					var failure *devcontract.Error
					require.ErrorAs(t, err, &failure)
					require.Equal(t, "stale_target", failure.Code)
					require.Equal(t, 4, devcontract.ExitCode(err))
				})
			}
		})
	}
}
