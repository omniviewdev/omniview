package plugin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/pprof"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/stretchr/testify/require"
)

func workspaceSelectionFixture(t *testing.T, mode string) (*pluginManager, *devserver.DevServerManager, string, string) {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_WORKSPACE_ID", "")
	t.Setenv("OMNIVIEW_GENERATION", "")
	collection, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	root := filepath.Join(collection, "workspaces", "selection")
	id := "dcb31603-d97a-4c1a-8785-5a7b68c52a2d"
	manifest := devcontract.WorkspaceManifest{SchemaVersion: 1, WorkspaceID: id, Slug: "selection", DisplayName: "Selection fixture", Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}}
	manifest.Repositories = []devcontract.Repository{{ID: "omniview", Directory: "host", BaseRef: "main", BaseCommit: strings.Repeat("a", 40), Branch: "fixture"}}
	require.NoError(t, os.MkdirAll(filepath.Join(root, "host"), 0700))
	selected, old := filepath.Join(root, "selected"), filepath.Join(root, "old")
	for _, source := range []string{selected, old} {
		require.NoError(t, os.MkdirAll(source, 0700))
		require.NoError(t, os.WriteFile(filepath.Join(source, "plugin.yaml"), []byte("id: flux\nversion: 1.0.0\ncapabilities: [resource]\n"), 0600))
	}
	if mode != "removed" {
		manifest.Repositories = append(manifest.Repositories, devcontract.Repository{ID: "plugin", Directory: "selected", BaseRef: "main", BaseCommit: strings.Repeat("b", 40), Branch: "fixture"})
		manifest.Plugins = []devcontract.Plugin{{ID: "flux", RepositoryID: "plugin", Mode: "managed"}}
	}
	encoded, err := json.Marshal(manifest)
	require.NoError(t, err)
	path := filepath.Join(root, "workspace.json")
	require.NoError(t, os.WriteFile(path, encoded, 0600))
	require.NoError(t, devcontract.EnsureDefaultProfileOwnership(home, id))
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: path, Home: home})
	require.NoError(t, err)
	service, err := appstate.New(appstate.WithRoot(workspace.StateRoot), appstate.WithFlock(false))
	require.NoError(t, err)
	t.Cleanup(func() { _ = service.Close() })
	manager := newTestManager(t)
	manager.stateRoot, manager.pluginsRoot = service.RootDir(), service.Plugins()
	manager.pidTracker = NewPIDTracker(service.RootDir())
	servers := devserver.NewDevServerManager(logging.NewNop(), service.RootDir(), service.Plugins(), &PluginRefAdapter{Mgr: manager}, &PluginReloaderAdapter{Mgr: manager}, nil)
	profile := instance.Profile{Workspace: &workspace, Descriptor: devcontract.InstanceDescriptor{WorkspaceID: id, InstanceID: id, StateRoot: workspace.StateRoot, Generation: "5523f405-4385-472d-bc06-ef4f64d7b318"}}
	require.NoError(t, servers.ConfigureWorkspace(profile, t.TempDir(), ""))
	manager.SetDevServerManager(servers)
	t.Cleanup(func() { _ = servers.ServiceShutdown() })
	return manager, servers, selected, old
}

func TestInitializeRetainsRemovedOrReboundDevInventoryWithoutExecutingOldSource(t *testing.T) {
	for _, mode := range []string{"removed", "rebound"} {
		t.Run(mode, func(t *testing.T) {
			manager, servers, _, old := workspaceSelectionFixture(t, mode)
			installPluginFixture(t, manager, "flux", []string{"resource"}, true)
			record := plugintypes.NewPluginRecord("flux", config.PluginMeta{ID: "flux", Version: "old", Capabilities: []string{"resource"}}, lifecycle.PhaseRunning)
			record.DevMode, record.DevPath, record.Enabled = true, old, true
			manager.records["flux"] = record
			require.NoError(t, manager.pluginsRoot.WriteFile(filepath.Join("flux", "user-data"), []byte("retained"), 0600))
			installPluginFixture(t, manager, "archive", []string{"ui"}, false)
			require.NoError(t, manager.pluginsRoot.MkdirAll(filepath.Join("archive", "assets"), 0700))
			manager.records["archive"] = plugintypes.NewPluginRecord("archive", config.PluginMeta{ID: "archive", Capabilities: []string{"ui"}}, lifecycle.PhaseRunning)
			require.NoError(t, manager.writePluginStateJSON())
			manager.records = map[string]*plugintypes.PluginRecord{}
			var launches atomic.Int32
			manager.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) {
				launches.Add(1)
				return nil, fmt.Errorf("old source must not reach backend launch")
			}
			require.NoError(t, manager.Initialize(context.Background()))
			require.Zero(t, launches.Load())
			info, err := manager.GetPlugin("flux")
			require.NoError(t, err)
			require.Equal(t, string(lifecycle.PhaseStopped), info.Phase)
			require.Equal(t, old, info.DevPath)
			require.True(t, info.Enabled)
			require.True(t, info.DevMode)
			require.Contains(t, info.LastError, "workspace")
			require.False(t, servers.IsManaged("flux"))
			require.Nil(t, manager.records["flux"].Backend)
			data, err := manager.pluginsRoot.ReadFile(filepath.Join("flux", "user-data"))
			require.NoError(t, err)
			require.Equal(t, "retained", string(data))
			persisted, err := manager.readPluginStateJSON()
			require.NoError(t, err)
			require.Len(t, persisted, 2)
			archive, err := manager.GetPlugin("archive")
			require.NoError(t, err)
			require.Equal(t, string(lifecycle.PhaseRunning), archive.Phase)
			_, err = manager.LoadPlugin("flux", nil)
			require.ErrorContains(t, err, "workspace")
			_, err = manager.InstallDevPluginFromPath(old)
			require.ErrorContains(t, err, "workspace")
			_, err = servers.StartDevServerForPath("flux", old)
			require.ErrorContains(t, err, "workspace")
			require.Zero(t, launches.Load())
			require.NoError(t, os.RemoveAll(old))
			manager.records = map[string]*plugintypes.PluginRecord{}
			require.NoError(t, manager.Initialize(context.Background()))
			retained, err := manager.GetPlugin("flux")
			require.NoError(t, err)
			require.Equal(t, string(lifecycle.PhaseStopped), retained.Phase)
			require.Equal(t, old, retained.DevPath)
			require.Zero(t, launches.Load(), "removing the old worktree must not drop inventory or attempt execution")
		})
	}
}

func TestSupervisedStartupPreservesDevInventoryUntilCanonicalLink(t *testing.T) {
	manager, servers, selected, _ := workspaceSelectionFixture(t, "selected")
	manager.ctx = context.Background()
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: filepath.Join(filepath.Dir(selected), "workspace.json")})
	require.NoError(t, err)
	generation := "5523f405-4385-472d-bc06-ef4f64d7b318"
	host, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{
		WorkspaceID: workspace.Manifest.WorkspaceID, Generation: generation, Role: "host", Source: filepath.Join(workspace.Root, "host"),
	})
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(workspace.Root, ".local"), 0700))
	tokenFile := filepath.Join(workspace.Root, ".local", "supervisor-"+generation+".secret")
	require.NoError(t, os.WriteFile(tokenFile, []byte(strings.Repeat("s", 64)), 0600))
	require.NoError(t, servers.ConfigureProcessSupervisor(devsession.ProcessBridgeConfig{
		Endpoint: "http://127.0.0.1:1/v1/process", TokenFile: tokenFile, WorkspaceFile: workspace.ManifestPath,
		WorkspaceID: workspace.Manifest.WorkspaceID, Generation: generation, Host: host,
	}))

	// The selected source needs canonical startup work: its metadata is newer,
	// and no aggregate UI install has been prepared. Initialization must not
	// replace the saved installation or turn this inventory into a failed build.
	require.NoError(t, os.WriteFile(filepath.Join(selected, "plugin.yaml"), []byte(uiOnlyYaml), 0600))
	installPluginFixture(t, manager, "flux", []string{"ui"}, false)
	before, err := manager.pluginsRoot.ReadFile(filepath.Join("flux", "plugin.yaml"))
	require.NoError(t, err)
	record := plugintypes.NewPluginRecord("flux", config.PluginMeta{ID: "flux", Version: "saved", Capabilities: []string{"ui"}}, lifecycle.PhaseRunning)
	record.DevMode, record.DevPath, record.Enabled = true, selected, true
	manager.records["flux"] = record
	installPluginFixture(t, manager, "archive", []string{"ui"}, false)
	require.NoError(t, manager.pluginsRoot.MkdirAll(filepath.Join("archive", "assets"), 0700))
	manager.records["archive"] = plugintypes.NewPluginRecord("archive", config.PluginMeta{ID: "archive", Capabilities: []string{"ui"}}, lifecycle.PhaseRunning)
	require.NoError(t, manager.writePluginStateJSON())
	manager.records = map[string]*plugintypes.PluginRecord{}
	states, err := manager.readPluginStateJSON()
	require.NoError(t, err)
	files, err := os.ReadDir(manager.pluginsRoot.ResolvePath(""))
	require.NoError(t, err)

	// Execute Initialize's complete load/start plan synchronously so observing a
	// stopped record cannot pass just because its background goroutine is late.
	toLoad, devPlugins := manager.planPluginLoads(files, states)
	manager.loadPluginsConcurrently(toLoad)
	manager.startDevServers(devPlugins)
	require.NoError(t, manager.mergeAndWritePluginState(states))
	info, err := manager.GetPlugin("flux")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseStopped), info.Phase)
	require.Equal(t, "saved", info.Metadata.Version)
	require.Equal(t, selected, info.DevPath)
	require.True(t, info.Enabled)
	require.True(t, info.DevMode)
	require.Empty(t, info.LastError)
	require.False(t, servers.IsManaged("flux"))
	after, err := manager.pluginsRoot.ReadFile(filepath.Join("flux", "plugin.yaml"))
	require.NoError(t, err)
	require.Equal(t, before, after, "startup must leave replacement to the canonical link transaction")
	archive, err := manager.GetPlugin("archive")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseRunning), archive.Phase, "installed plugins still restore normally")

	_, err = manager.InstallDevPluginFromPath(selected)
	require.Error(t, err, "explicit link must attempt the real, unprepared UI startup rather than report idle readiness")
	after, err = manager.pluginsRoot.ReadFile(filepath.Join("flux", "plugin.yaml"))
	require.NoError(t, err)
	require.Equal(t, uiOnlyYaml, string(after), "explicit link, not initialization, owns source installation")
}

func TestSelectedUIStartupUsesCanonicalLifecycleAndActualHTTPBeforeReady(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node unavailable")
	}
	manager, servers, selected, _ := workspaceSelectionFixture(t, "selected")
	emitter := &testRecordingEmitter{}
	manager.emitter = emitter
	require.NoError(t, os.WriteFile(filepath.Join(selected, "plugin.yaml"), []byte(uiOnlyYaml), 0600))
	require.NoError(t, os.MkdirAll(filepath.Join(selected, "ui"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(selected, "ui", "package.json"), []byte("{\"name\":\"selection-fixture\",\"private\":true,\"packageManager\":\"pnpm@12.14.0\"}\n"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(selected, ".gitignore"), []byte("ui/node_modules/\n"), 0600))
	proofFile := filepath.Join(t.TempDir(), "actual-shutdown-cache")
	encodedProof, err := json.Marshal(proofFile)
	require.NoError(t, err)
	runner := filepath.Join(selected, "pnpm-fixture.cjs")
	script := fmt.Sprintf(`const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
if(process.argv[2]!=='run'||process.argv[3]!=='dev')process.exit(3);
const client=fs.readFileSync('node_modules/fixture-dependency/client.js','utf8');
const cache=process.env.OMNIVIEW_VITE_CACHE_DIRECTORY;
if(!cache)process.exit(4);
fs.mkdirSync(cache,{recursive:true});
fs.writeFileSync(path.join(cache,'startup.js'),client);
process.on('SIGTERM',()=>{
  const final=path.join(cache,'shutdown.js');
  fs.writeFileSync(final,client);
  fs.writeFileSync(%s,final);
  process.exit(0);
});
const port=Number(process.env.OMNIVIEW_VITE_PORT);
http.createServer((req,res)=>{res.writeHead(req.url==='/@vite/client'?200:404,{'Content-Type':'application/javascript'});res.end(client);}).listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port+'/'));
`, encodedProof)
	require.NoError(t, os.WriteFile(runner, []byte(script), 0600))
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", selected, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=" + os.DevNull}, args...)...)
		command.Env = append(os.Environ(), "GOWORK=off", "GIT_CONFIG_NOSYSTEM=1")
		output, err := command.CombinedOutput()
		require.NoError(t, err, string(output))
	}
	git("init", "--initial-branch=fixture")
	git("add", ".")
	git("commit", "-m", "selected UI source fixture")
	workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{Explicit: filepath.Join(filepath.Dir(selected), "workspace.json")})
	require.NoError(t, err)
	host := filepath.Join(workspace.Root, "host")
	require.NoError(t, os.WriteFile(filepath.Join(host, "package.json"), []byte(`{"name":"host-fixture","private":true,"packageManager":"pnpm@12.14.0"}`), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(host, ".gitignore"), []byte("node_modules/\n"), 0600))
	for _, arguments := range [][]string{{"init", "--initial-branch=fixture"}, {"add", "."}, {"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=" + os.DevNull, "commit", "-m", "host fixture"}} {
		cmd := exec.Command("git", append([]string{"-C", host}, arguments...)...)
		data, err := cmd.CombinedOutput()
		require.NoError(t, err, string(data))
	}
	composition, err := devcompose.New(workspace, []devcompose.Root{{Path: host, Version: "12.14.0"}, {Path: filepath.Join(selected, "ui"), Version: "12.14.0"}}, nil)
	require.NoError(t, err)
	var generated []map[string]any
	for _, file := range composition.Files {
		path := file.Path
		if !filepath.IsAbs(path) {
			path = filepath.Join(workspace.Root, path)
		}
		require.NoError(t, os.WriteFile(path, file.Data, 0600))
		relative, err := filepath.Rel(workspace.Root, path)
		require.NoError(t, err)
		hash := sha256.Sum256(file.Data)
		generated = append(generated, map[string]any{"path": filepath.ToSlash(relative), "appliedHash": hex.EncodeToString(hash[:]), "pending": false})
	}
	receipt, err := json.Marshal(map[string]any{"schemaVersion": 2, "workspaceID": workspace.Manifest.WorkspaceID, "root": workspace.Root, "phase": "linked", "manifest": workspace.Manifest, "evidence": map[string]any{"protocol": "workspace", "versions": []string{"12.14.0"}, "atomicDist": true, "peers": true, "runtime": true}, "plan": map[string]any{"composition": composition}, "files": generated})
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(workspace.Root, ".local"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(workspace.Root, ".local", "links.json"), receipt, 0600))
	writer, err := devoutputs.BeginCompositionInstall(context.Background(), workspace, composition)
	require.NoError(t, err)
	dependency := filepath.Join(selected, "ui", "node_modules", "fixture-dependency")
	require.NoError(t, os.MkdirAll(dependency, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(dependency, "client.js"), []byte("export const selected = true"), 0600))
	require.NoError(t, writer.Finish(context.Background()))
	require.NoError(t, servers.ConfigurePNPMCommands(map[string]devserver.PNPMCommand{"flux": {Program: node, Args: []string{runner}, Source: selected, WorkspaceRoot: workspace.Root, Version: "12.14.0"}}))
	installPluginFixture(t, manager, "flux", []string{"ui"}, false)
	record := plugintypes.NewPluginRecord("flux", config.PluginMeta{ID: "flux", Capabilities: []string{"ui"}}, lifecycle.PhaseRunning)
	record.DevMode, record.DevPath = true, selected
	manager.records["flux"] = record
	require.NoError(t, manager.writePluginStateJSON())
	manager.records = map[string]*plugintypes.PluginRecord{}
	require.NoError(t, manager.Initialize(context.Background()))
	deadline := time.Now().Add(8 * time.Second)
	for {
		state := servers.GetDevServerState("flux")
		info, err := manager.GetPlugin("flux")
		completed := false
		for _, event := range emitter.getEvents() {
			if event.event == EventDevInstallComplete {
				completed = true
			}
		}
		if completed && err == nil && info.Phase == string(lifecycle.PhaseRunning) && state.Ready {
			require.Equal(t, devserver.StageNotApplicable, state.RPCStatus)
			require.False(t, state.GRPCConnected)
			response, err := (&http.Client{Timeout: time.Second}).Get(state.ViteURL + "/@vite/client")
			require.NoError(t, err)
			_ = response.Body.Close()
			require.Equal(t, http.StatusOK, response.StatusCode)
			break
		}
		if time.Now().After(deadline) {
			t.Logf("selected startup process logs: %+v", servers.GetDevServerLogs("flux", 100))
			_ = pprof.Lookup("goroutine").WriteTo(os.Stderr, 2)
			t.Fatalf("selected canonical startup did not reach actual readiness: %+v %+v %v", state, info, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	require.Error(t, devoutputs.Validate(context.Background(), workspace), "actual Vite cache writer must remain live before Stop")
	require.NoError(t, manager.StopDevPlugin("flux"))
	finalCachePath, err := os.ReadFile(proofFile)
	require.NoError(t, err)
	finalCache, err := os.ReadFile(string(finalCachePath))
	require.NoError(t, err)
	require.Equal(t, "export const selected = true", string(finalCache))
	require.NoError(t, devoutputs.Validate(context.Background(), workspace), "snapshot must include actual shutdown writes before the sole reaper closes ownership")
	require.NoError(t, devoutputs.Restore(context.Background(), workspace))
	_, err = os.Stat(string(finalCachePath))
	require.ErrorIs(t, err, os.ErrNotExist)
}
