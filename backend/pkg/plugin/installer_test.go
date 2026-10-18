package plugin

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Only the process boundary is replaced: metadata copying, loading, records and
// persistence below all use the real manager and temporary filesystem.
type transactionDevServers struct {
	state      devserver.DevServerState
	stopErr    error
	startErr   error
	buildError string
}

func (d *transactionDevServers) IsManaged(id string) bool {
	return d.state.PluginID == id && d.state.Mode == devserver.DevServerModeManaged
}

func (d *transactionDevServers) StartDevServerForPath(id, path string) (devserver.DevServerState, error) {
	// Mirror the real manager's existing-ID fast path. A rebind that forgets
	// to stop the old server must not pass by updating only PluginRecord.
	if d.IsManaged(id) {
		return d.state, nil
	}
	if d.startErr != nil {
		return devserver.DevServerState{}, d.startErr
	}
	d.state = devserver.DevServerState{
		PluginID: id, Mode: devserver.DevServerModeManaged, DevPath: path,
		GoStatus: devserver.DevProcessStatusReady, ViteStatus: devserver.DevProcessStatusRunning,
	}
	if d.buildError != "" {
		d.state.GoStatus = devserver.DevProcessStatusError
		d.state.LastError = d.buildError
	}
	return d.state, nil
}

func (d *transactionDevServers) StopDevServer(id string) error {
	if d.stopErr != nil {
		return d.stopErr
	}
	d.state = devserver.DevServerState{PluginID: id, Mode: devserver.DevServerModeIdle}
	return nil
}

func devSourceFixture(t *testing.T, metadata string) string {
	t.Helper()
	path := t.TempDir()
	path, err := filepath.EvalSymlinks(path)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(path, "plugin.yaml"), []byte(metadata), 0644))
	return path
}

func TestInstallDevPluginFromPath_RebindsManagedSourceAndPersists(t *testing.T) {
	pm := newTestManager(t)
	servers := &transactionDevServers{}
	pm.devServerMgr = servers
	a := devSourceFixture(t, uiOnlyYaml)
	b := devSourceFixture(t, "id: flux\nversion: 0.4.0\ncapabilities: [ui]\n")
	_, err := pm.InstallDevPluginFromPath(a)
	require.NoError(t, err)

	info, err := pm.InstallDevPluginFromPath(b)
	require.NoError(t, err)
	assert.Equal(t, b, info.DevPath)
	assert.Equal(t, "0.4.0", info.Metadata.Version)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	assert.Equal(t, b, servers.state.DevPath)
	states, err := pm.readPluginStateJSON()
	require.NoError(t, err)
	require.Len(t, states, 1)
	assert.Equal(t, b, states[0].DevPath)
	assert.FileExists(t, filepath.Join(a, "plugin.yaml"))
}

type transactionStopFailure struct {
	trackingController
}

func (*transactionStopFailure) OnPluginStop(string, config.PluginMeta) error {
	return errors.New("controller refuses unload")
}

func TestInstallDevPluginFromPath_RebindFailureDoesNotReplaceSource(t *testing.T) {
	for _, failure := range []string{"server-stop", "plugin-unload"} {
		t.Run(failure, func(t *testing.T) {
			pm := newTestManager(t)
			servers := &transactionDevServers{}
			pm.devServerMgr = servers
			a := devSourceFixture(t, uiOnlyYaml)
			b := devSourceFixture(t, "id: flux\nversion: 9.0.0\ncapabilities: [ui]\n")
			_, err := pm.InstallDevPluginFromPath(a)
			require.NoError(t, err)
			if failure == "server-stop" {
				servers.stopErr = errors.New("server refuses stop")
			} else {
				pm.connlessControllers[sdktypes.CapabilitySettings] = &transactionStopFailure{}
			}

			_, err = pm.InstallDevPluginFromPath(b)
			require.Error(t, err)
			info, getErr := pm.GetPlugin("flux")
			require.NoError(t, getErr)
			assert.Equal(t, a, info.DevPath)
			assert.Equal(t, "0.3.0", info.Metadata.Version)
			assert.NotEqual(t, b, servers.state.DevPath)
			installed, readErr := os.ReadFile(filepath.Join(pm.pluginsRoot.ResolvePath("flux"), "plugin.yaml"))
			require.NoError(t, readErr)
			assert.Equal(t, uiOnlyYaml, string(installed))
			states, readErr := pm.readPluginStateJSON()
			require.NoError(t, readErr)
			require.Len(t, states, 1)
			assert.Equal(t, a, states[0].DevPath)
		})
	}
}

func TestInstallDevPluginFromPath_FailedBuildIsErrorAndRecoverable(t *testing.T) {
	pm := newTestManager(t)
	pm.devServerMgr = &transactionDevServers{buildError: "compiler rejected source"}
	emitter := &testRecordingEmitter{}
	pm.emitter = emitter
	source := devSourceFixture(t, backendYaml)

	info, err := pm.InstallDevPluginFromPath(source)
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypePluginBuildFailed, appErr.Type)
	assert.Equal(t, string(lifecycle.PhaseBuildFailed), info.Phase)
	assert.Equal(t, source, info.DevPath)
	assert.Contains(t, info.LastError, "compiler rejected source")
	states, readErr := pm.readPluginStateJSON()
	require.NoError(t, readErr)
	require.Len(t, states, 1)
	assert.Equal(t, lifecycle.PhaseBuildFailed, states[0].Phase)
	assert.Equal(t, source, states[0].DevPath)
	for _, event := range emitter.getEvents() {
		assert.NotEqual(t, EventDevInstallComplete, event.event, "failed install must not emit completion")
	}

	// A later watcher build can reload the retained record without relinking.
	require.NoError(t, os.WriteFile(filepath.Join(pm.pluginsRoot.ResolvePath("kubernetes"), "bin", "plugin"), []byte("built"), 0755))
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(nil), nil
	}
	info, err = pm.ReloadPlugin("kubernetes")
	require.NoError(t, err)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	assert.Equal(t, source, info.DevPath)
}

func TestInstallDevPluginFromPath_LoadFailureRetainsRecoverableBinding(t *testing.T) {
	pm := newTestManager(t)
	pm.devServerMgr = &transactionDevServers{}
	source := devSourceFixture(t, backendYaml)
	info, err := pm.InstallDevPluginFromPath(source)
	require.Error(t, err) // no built backend binary
	assert.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	assert.Equal(t, source, info.DevPath)
	persisted, readErr := pm.readPluginStateJSON()
	require.NoError(t, readErr)
	require.Len(t, persisted, 1)
	assert.Equal(t, lifecycle.PhaseFailed, persisted[0].Phase)
	assert.NotEmpty(t, persisted[0].LastError)
}

func TestUnlinkDevPlugin_RemovesBindingNotSource(t *testing.T) {
	pm := newTestManager(t)
	servers := &transactionDevServers{}
	pm.devServerMgr = servers
	source := devSourceFixture(t, uiOnlyYaml)
	_, err := pm.InstallDevPluginFromPath(source)
	require.NoError(t, err)

	_, err = pm.UnlinkDevPlugin("flux")
	require.NoError(t, err)
	_, err = pm.GetPlugin("flux")
	require.Error(t, err)
	assert.False(t, servers.IsManaged("flux"))
	assert.FileExists(t, filepath.Join(source, "plugin.yaml"))
	assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))
	states, err := pm.readPluginStateJSON()
	require.NoError(t, err)
	assert.Empty(t, states)
}

func TestInstallPluginFromPath_PreservesCallerArchiveOnFailure(t *testing.T) {
	pm := newTestManager(t)
	archive := writeTestTarball(t, []tarEntry{{name: "plugin.yaml", mode: 0644, body: backendYaml}})
	before, err := os.ReadFile(archive)
	require.NoError(t, err)
	_, err = pm.InstallPluginFromPath(archive)
	require.Error(t, err)
	after, err := os.ReadFile(archive)
	require.NoError(t, err)
	assert.Equal(t, before, after)
}

func TestInstallPluginFromPath_UnloadConflictPreservesInstallationAndArchive(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, os.MkdirAll(filepath.Join(pm.pluginsRoot.ResolvePath("flux"), "assets"), 0755))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	pm.connlessControllers[sdktypes.CapabilitySettings] = &transactionStopFailure{}
	installedPath := filepath.Join(pm.pluginsRoot.ResolvePath("flux"), "plugin.yaml")
	before, err := os.ReadFile(installedPath)
	require.NoError(t, err)
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: uiOnlyYaml},
		{name: "assets/", mode: 0755, dir: true},
		{name: "assets/entry.js", mode: 0644, body: "new"},
	})

	_, err = pm.InstallPluginFromPath(archive)
	require.Error(t, err)
	after, readErr := os.ReadFile(installedPath)
	require.NoError(t, readErr)
	assert.Equal(t, before, after)
	assert.FileExists(t, archive)
}

func TestInstallDevPluginFromPath_StartFailureRetainsBindingForRetry(t *testing.T) {
	pm := newTestManager(t)
	servers := &transactionDevServers{startErr: errors.New("toolchain unavailable")}
	pm.devServerMgr = servers
	source := devSourceFixture(t, uiOnlyYaml)
	info, err := pm.InstallDevPluginFromPath(source)
	require.Error(t, err)
	assert.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	assert.Equal(t, source, info.DevPath)
	states, readErr := pm.readPluginStateJSON()
	require.NoError(t, readErr)
	require.Len(t, states, 1)
	assert.Equal(t, source, states[0].DevPath)

	servers.startErr = nil
	info, err = pm.InstallDevPluginFromPath(source)
	require.NoError(t, err)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	assert.Equal(t, source, info.DevPath)
}

func TestUnlinkDevPlugin_RejectsInstalledPluginWithoutRemovingFiles(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, os.MkdirAll(filepath.Join(pm.pluginsRoot.ResolvePath("flux"), "assets"), 0755))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	_, err = pm.UnlinkDevPlugin("flux")
	require.Error(t, err)
	assert.FileExists(t, filepath.Join(pm.pluginsRoot.ResolvePath("flux"), "plugin.yaml"))
	info, err := pm.GetPlugin("flux")
	require.NoError(t, err)
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	assert.False(t, info.DevMode)
}

func TestInstallDevPluginFromPath_PersistenceFailureIsNotCompletion(t *testing.T) {
	pm := newTestManager(t)
	pm.devServerMgr = &transactionDevServers{}
	emitter := &testRecordingEmitter{}
	pm.emitter = emitter
	source := devSourceFixture(t, uiOnlyYaml)
	require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0755))
	info, err := pm.InstallDevPluginFromPath(source)
	require.Error(t, err)
	assert.Equal(t, "flux", info.ID)
	for _, event := range emitter.getEvents() {
		assert.NotEqual(t, EventDevInstallComplete, event.event)
	}
}

func TestInstallDevPluginFromPath_FailedRebindCannotReusePriorBinary(t *testing.T) {
	pm := newTestManager(t)
	a := devSourceFixture(t, backendYaml)
	b := devSourceFixture(t, backendYaml)
	installPluginFixture(t, pm, "kubernetes", []string{"resource", "ui"}, true)
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(nil), nil
	}
	_, err := pm.LoadPlugin("kubernetes", &LoadPluginOptions{DevMode: true, DevModePath: a})
	require.NoError(t, err)
	pm.devServerMgr = &transactionDevServers{
		state: devserver.DevServerState{
			PluginID: "kubernetes", Mode: devserver.DevServerModeManaged, DevPath: a,
			GoStatus: devserver.DevProcessStatusReady,
		},
		buildError: "source B does not compile",
	}
	info, err := pm.InstallDevPluginFromPath(b)
	require.Error(t, err)
	assert.Equal(t, b, info.DevPath)
	assert.Equal(t, string(lifecycle.PhaseBuildFailed), info.Phase)
	assert.NoFileExists(t, filepath.Join(pm.pluginsRoot.ResolvePath("kubernetes"), "bin", "plugin"),
		"a failed build of B must not leave A's executable available for restart")
}

func TestInstallDevPluginFromPath_DisabledManagerDoesNotInstall(t *testing.T) {
	pm := newTestManager(t)
	pm.SetDevServerManager(nil)
	source := devSourceFixture(t, uiOnlyYaml)
	_, err := pm.InstallDevPluginFromPath(source)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypeSettingsMissingConfig, appErr.Type)
	assert.Empty(t, pm.ListPlugins())
	assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))
}

type uninstallInventoryConsumer struct {
	refresh             func()
	onStateWriteFailure func()
}

func (consumer uninstallInventoryConsumer) Emit(event string, _ ...any) {
	if event == "plugin/inventory_changed" {
		consumer.refresh()
	}
	if event == "plugin/state_write_error" && consumer.onStateWriteFailure != nil {
		consumer.onStateWriteFailure()
	}
}

func TestUninstallPlugin_RefreshesInventoryOnlyAfterDurableDeletion(t *testing.T) {
	for _, phase := range []lifecycle.PluginPhase{lifecycle.PhaseFailed, lifecycle.PhaseStopped, lifecycle.PhaseRunning} {
		for _, dev := range []bool{false, true} {
			name := string(phase) + "/installed"
			if dev {
				name = string(phase) + "/dev"
			}
			t.Run(name, func(t *testing.T) {
				pm := newTestManager(t)
				installPluginFixture(t, pm, "flux", []string{"ui"}, false)
				require.NoError(t, os.MkdirAll(pm.pluginsRoot.ResolvePath("flux/assets"), 0755))
				_, err := pm.LoadPlugin("flux", nil)
				require.NoError(t, err)
				record := pm.records["flux"]
				record.Phase = phase
				record.StateMachine.ForcePhase(phase, "retained inventory fixture")
				record.DevMode = dev
				require.NoError(t, pm.writePluginStateJSON())

				visibleInventory := pm.ListPlugins()
				require.Len(t, visibleInventory, 1)
				refreshes := 0
				pm.emitter = uninstallInventoryConsumer{refresh: func() {
					refreshes++
					visibleInventory = pm.ListPlugins()
					persisted, readErr := pm.readPluginStateJSON()
					require.NoError(t, readErr)
					assert.Empty(t, persisted, "inventory notification must follow durable deletion")
					assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))
				}}

				if dev {
					_, err = pm.UnlinkDevPlugin("flux")
				} else {
					_, err = pm.UninstallPlugin("flux")
				}
				require.NoError(t, err)
				persisted, err := pm.readPluginStateJSON()
				require.NoError(t, err)
				assert.Empty(t, persisted)
				assert.Empty(t, pm.ListPlugins())
				assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))
				assert.Empty(t, visibleInventory, "an existing inventory consumer must observe successful removal")
				assert.Equal(t, 1, refreshes, "durable deletion must publish exactly one invalidation")
			})
		}
	}
}

func TestUninstallPlugin_DoesNotPublishInventorySuccessOnFailure(t *testing.T) {
	for _, failure := range []string{"unload", "remove", "persist", "missing", "not-dev"} {
		t.Run(failure, func(t *testing.T) {
			pm := newTestManager(t)
			installPluginFixture(t, pm, "flux", []string{"ui"}, false)
			require.NoError(t, os.MkdirAll(pm.pluginsRoot.ResolvePath("flux/assets"), 0755))
			_, err := pm.LoadPlugin("flux", nil)
			require.NoError(t, err)
			require.NoError(t, pm.writePluginStateJSON())
			visibleInventory := pm.ListPlugins()
			refreshes := 0
			pm.emitter = uninstallInventoryConsumer{refresh: func() {
				refreshes++
				visibleInventory = pm.ListPlugins()
			}}
			switch failure {
			case "unload":
				pm.connlessControllers[sdktypes.CapabilitySettings] = &transactionStopFailure{}
			case "remove":
				root := pm.pluginsRoot.ResolvePath("")
				require.NoError(t, os.Rename(root, root+"-saved"))
				require.NoError(t, os.WriteFile(root, []byte("blocked parent"), 0644))
				t.Cleanup(func() {
					require.NoError(t, os.Remove(root))
					require.NoError(t, os.Rename(root+"-saved", root))
				})
			case "persist":
				require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0755))
			}

			switch failure {
			case "missing":
				_, err = pm.UninstallPlugin("missing")
			case "not-dev":
				_, err = pm.UnlinkDevPlugin("flux")
			default:
				_, err = pm.UninstallPlugin("flux")
			}
			require.Error(t, err)
			assert.Equal(t, 0, refreshes, "failed uninstall must not advertise committed removal")
			require.Len(t, visibleInventory, 1)
			assert.Equal(t, "flux", visibleInventory[0].ID)
			persisted, readErr := pm.readPluginStateJSON()
			require.NoError(t, readErr)
			require.Len(t, persisted, 1)
			assert.Equal(t, "flux", persisted[0].ID)
		})
	}
}

func TestUninstallPlugin_PersistenceFailurePreservesRecoverableInstallation(t *testing.T) {
	for _, dev := range []bool{false, true} {
		name := "installed"
		if dev {
			name = "dev"
		}
		t.Run(name, func(t *testing.T) {
			pm := newTestManager(t)
			installPluginFixture(t, pm, "flux", []string{"ui"}, false)
			require.NoError(t, os.MkdirAll(pm.pluginsRoot.ResolvePath("flux/assets"), 0755))
			assetPath := pm.pluginsRoot.ResolvePath("flux/assets/entry.js")
			asset := []byte("retained compiled plugin asset")
			require.NoError(t, os.WriteFile(assetPath, asset, 0644))
			metaPath := pm.pluginsRoot.ResolvePath("flux/plugin.yaml")
			metadata, err := os.ReadFile(metaPath)
			require.NoError(t, err)
			_, err = pm.LoadPlugin("flux", nil)
			require.NoError(t, err)
			pm.records["flux"].DevMode = dev
			source := devSourceFixture(t, uiOnlyYaml)
			if dev {
				pm.records["flux"].DevPath = source
			}
			require.NoError(t, pm.writePluginStateJSON())
			refreshes := 0
			pm.emitter = uninstallInventoryConsumer{refresh: func() { refreshes++ }}
			require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0755))

			if dev {
				_, err = pm.UnlinkDevPlugin("flux")
			} else {
				_, err = pm.UninstallPlugin("flux")
			}
			require.Error(t, err)
			info, getErr := pm.GetPlugin("flux")
			assert.NoError(t, getErr, "failed persistence must retain a recoverable inventory record")
			assert.Contains(t, []string{"Stopped", "Failed"}, info.Phase, "unloaded plugin must not be reported as running")
			assert.Equal(t, dev, info.DevMode)
			if dev {
				assert.Equal(t, source, info.DevPath)
			}
			actualMetadata, readErr := os.ReadFile(metaPath)
			assert.NoError(t, readErr)
			assert.Equal(t, metadata, actualMetadata)
			actualAsset, readErr := os.ReadFile(assetPath)
			assert.NoError(t, readErr)
			assert.Equal(t, asset, actualAsset)
			persisted, readErr := pm.readPluginStateJSON()
			require.NoError(t, readErr)
			require.Len(t, persisted, 1, "failed persistence must not erase durable inventory")
			assert.Equal(t, "flux", persisted[0].ID)
			assert.Equal(t, 0, refreshes)

			require.NoError(t, pm.stateRoot.Remove(stateFileName+".tmp"))
			if dev {
				_, err = pm.UnlinkDevPlugin("flux")
			} else {
				_, err = pm.UninstallPlugin("flux")
			}
			assert.NoError(t, err, "the retained installation must support a canonical retry")
			assert.Equal(t, 1, refreshes)
			assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))
			persisted, readErr = pm.readPluginStateJSON()
			require.NoError(t, readErr)
			assert.Empty(t, persisted)
			assert.FileExists(t, filepath.Join(source, "plugin.yaml"))
		})
	}
}

func TestUninstallPlugin_RollbackPreservesForeignDestinationAndRecoveryFiles(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, os.MkdirAll(pm.pluginsRoot.ResolvePath("flux/assets"), 0755))
	asset := []byte("original installed asset")
	require.NoError(t, os.WriteFile(pm.pluginsRoot.ResolvePath("flux/assets/entry.js"), asset, 0644))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0755))
	refreshes := 0
	foreignCreated := false
	foreignPath := pm.pluginsRoot.ResolvePath("flux/foreign.txt")
	pm.emitter = uninstallInventoryConsumer{
		refresh: func() { refreshes++ },
		onStateWriteFailure: func() {
			if foreignCreated {
				return
			}
			foreignCreated = true
			require.NoError(t, os.MkdirAll(pm.pluginsRoot.ResolvePath("flux"), 0755))
			require.NoError(t, os.WriteFile(foreignPath, []byte("do not replace"), 0644))
		},
	}

	info, err := pm.UninstallPlugin("flux")
	require.Error(t, err)
	require.True(t, foreignCreated)
	assert.Equal(t, "Failed", info.Phase)
	retained, getErr := pm.GetPlugin("flux")
	require.NoError(t, getErr)
	assert.Equal(t, "Failed", retained.Phase)
	foreign, readErr := os.ReadFile(foreignPath)
	require.NoError(t, readErr)
	assert.Equal(t, "do not replace", string(foreign))
	assert.Equal(t, 0, refreshes)
	entries, readErr := pm.pluginsRoot.ReadDir(".")
	require.NoError(t, readErr)
	recoveryPath := ""
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == "flux" {
			continue
		}
		candidate := pm.pluginsRoot.ResolvePath(entry.Name())
		preserved, err := os.ReadFile(filepath.Join(candidate, "plugin", "assets", "entry.js"))
		if err == nil {
			assert.Equal(t, asset, preserved)
			recoveryPath = candidate
		}
	}
	require.NotEmpty(t, recoveryPath, "failed rollback must retain the original installation in private staging")
	assert.Contains(t, retained.LastError, recoveryPath, "local diagnostics must identify the recoverable files")
}

func TestUninstallPlugin_MissingInstallationStillCommitsInventoryRemoval(t *testing.T) {
	pm := newTestManager(t)
	pm.records["flux"] = plugintypes.NewPluginRecord("flux", config.PluginMeta{
		ID: "flux", Capabilities: []string{"ui"},
	}, lifecycle.PhaseFailed)
	require.NoError(t, pm.writePluginStateJSON())
	visibleInventory := pm.ListPlugins()
	refreshes := 0
	pm.emitter = uninstallInventoryConsumer{refresh: func() {
		refreshes++
		visibleInventory = pm.ListPlugins()
		persisted, err := pm.readPluginStateJSON()
		require.NoError(t, err)
		assert.Empty(t, persisted)
	}}

	_, err := pm.UninstallPlugin("flux")
	require.NoError(t, err)
	assert.Empty(t, visibleInventory)
	assert.Equal(t, 1, refreshes)
}

func TestUninstallPlugin_ForeignReplacementRemainsUnownedAcrossRetryAndRestart(t *testing.T) {
	for _, restart := range []bool{false, true} {
		name := "retry"
		if restart {
			name = "restart"
		}
		t.Run(name, func(t *testing.T) {
			pm := newTestManager(t)
			installPluginFixture(t, pm, "flux", []string{"ui"}, false)
			require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
			require.NoError(t, pm.pluginsRoot.WriteFile("flux/assets/entry.js", []byte("owned original asset"), 0644))
			_, err := pm.LoadPlugin("flux", nil)
			require.NoError(t, err)
			require.NoError(t, pm.writePluginStateJSON())
			require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0755))
			foreignCreated := false
			refreshes := 0
			pm.emitter = uninstallInventoryConsumer{
				refresh: func() { refreshes++ },
				onStateWriteFailure: func() {
					if foreignCreated {
						return
					}
					foreignCreated = true
					require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
					require.NoError(t, pm.pluginsRoot.WriteFile("flux/plugin.yaml", []byte("id: flux\nversion: 9.0.0\ncapabilities: [ui]\n"), 0644))
					require.NoError(t, pm.pluginsRoot.WriteFile("flux/foreign.txt", []byte("foreign replacement must survive"), 0644))
				},
			}
			_, err = pm.UninstallPlugin("flux")
			require.Error(t, err)
			require.True(t, foreignCreated)
			entries, err := pm.pluginsRoot.ReadDir(".")
			require.NoError(t, err)
			recoveryPath := ""
			for _, entry := range entries {
				if !entry.IsDir() || entry.Name() == "flux" {
					continue
				}
				if asset, err := pm.pluginsRoot.ReadFile(filepath.Join(entry.Name(), "plugin/assets/entry.js")); err == nil && string(asset) == "owned original asset" {
					recoveryPath = pm.pluginsRoot.ResolvePath(entry.Name())
				}
			}
			require.NotEmpty(t, recoveryPath)
			require.NoError(t, pm.stateRoot.Remove(stateFileName+".tmp"))
			if restart {
				restarted := newTestManager(t)
				restarted.stateRoot = pm.stateRoot
				restarted.pluginsRoot = pm.pluginsRoot
				restarted.pidTracker = NewPIDTracker(pm.stateRoot)
				require.NoError(t, restarted.Initialize(context.Background()))
				pm = restarted
				recovered, getErr := pm.GetPlugin("flux")
				assert.NoError(t, getErr)
				assert.Equal(t, "Failed", recovered.Phase, "startup must not load a replacement canonical directory")
			}
			pm.emitter = uninstallInventoryConsumer{refresh: func() { refreshes++ }}
			_, err = pm.UninstallPlugin("flux")
			assert.Error(t, err, "retry must not adopt and delete the foreign canonical replacement")
			foreign, readErr := pm.pluginsRoot.ReadFile("flux/foreign.txt")
			assert.NoError(t, readErr)
			assert.Equal(t, "foreign replacement must survive", string(foreign))
			original, readErr := os.ReadFile(filepath.Join(recoveryPath, "plugin/assets/entry.js"))
			assert.NoError(t, readErr)
			assert.Equal(t, "owned original asset", string(original))
			assert.Equal(t, 0, refreshes)

			// The test owns this adversarial fixture. Once its foreign entry is
			// deliberately removed, a normal retry may dispose of only our stage.
			require.NoError(t, pm.pluginsRoot.RemoveAll("flux"))
			_, err = pm.UninstallPlugin("flux")
			require.NoError(t, err)
			assert.NoDirExists(t, recoveryPath)
			assert.Empty(t, pm.ListPlugins())
			assert.Equal(t, 1, refreshes)
		})
	}
}

func TestUninstallPlugin_RejectsRecoveryProofFromAnotherProfile(t *testing.T) {
	source := newTestManager(t)
	installPluginFixture(t, source, "flux", []string{"ui"}, false)
	require.NoError(t, source.pluginsRoot.MkdirAll("flux/assets", 0755))
	_, err := source.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, source.writePluginStateJSON())
	require.NoError(t, source.stateRoot.MkdirAll(stateFileName+".tmp", 0755))
	_, err = source.UninstallPlugin("flux")
	require.Error(t, err)
	proof, err := source.stateRoot.ReadFile(uninstallRecoveryName("flux"))
	require.NoError(t, err)

	other := newTestManager(t)
	installPluginFixture(t, other, "flux", []string{"ui"}, false)
	require.NoError(t, other.pluginsRoot.MkdirAll("flux/assets", 0755))
	require.NoError(t, other.pluginsRoot.WriteFile("flux/assets/entry.js", []byte("other profile asset"), 0644))
	_, err = other.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, other.writePluginStateJSON())
	// This is well-formed, private, same-user proof, but it belongs to a
	// different profile/root capability and must never authorize deletion.
	require.NoError(t, other.stateRoot.WriteFile(uninstallRecoveryName("flux"), proof, 0600))
	_, err = other.UninstallPlugin("flux")
	require.Error(t, err)
	asset, err := other.pluginsRoot.ReadFile("flux/assets/entry.js")
	require.NoError(t, err)
	assert.Equal(t, "other profile asset", string(asset))

	restarted := newTestManager(t)
	restarted.stateRoot, restarted.pluginsRoot = other.stateRoot, other.pluginsRoot
	restarted.pidTracker = NewPIDTracker(other.stateRoot)
	assert.Error(t, restarted.Initialize(context.Background()), "foreign proof must fail closed before automatic loading")
	assert.Empty(t, restarted.ListPlugins())
	asset, err = other.pluginsRoot.ReadFile("flux/assets/entry.js")
	require.NoError(t, err)
	assert.Equal(t, "other profile asset", string(asset))
}

func TestUninstallPlugin_PartialDisposalNeverRestoresOrAdoptsCanonicalDirectory(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("real Unix permission-denied cleanup requires an unprivileged user")
	}
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/a-removed.txt", []byte("must be disposed before failure returns"), 0644))
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/z-blocked", 0700))
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/z-blocked/keep.txt", []byte("partial recovery bytes"), 0644))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	originalIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	refreshes := 0
	pm.emitter = uninstallInventoryConsumer{refresh: func() { refreshes++ }}
	require.NoError(t, os.Chmod(pm.pluginsRoot.ResolvePath("flux/z-blocked"), 0000))
	t.Cleanup(func() {
		_ = os.Chmod(pm.pluginsRoot.ResolvePath("flux/z-blocked"), 0700)
		entries, _ := pm.pluginsRoot.ReadDir(".")
		for _, entry := range entries {
			if entry.IsDir() {
				_ = os.Chmod(pm.pluginsRoot.ResolvePath(filepath.Join(entry.Name(), "plugin/z-blocked")), 0700)
			}
		}
	})

	info, err := pm.UninstallPlugin("flux")
	require.Error(t, err, "the real unreadable nonempty directory must fail recursive cleanup")
	assert.Equal(t, "Failed", info.Phase)
	assert.Equal(t, 0, refreshes)
	recovery, err := pm.readUninstallRecovery("flux")
	require.NoError(t, err)
	require.NotNil(t, recovery)
	staged := filepath.Join(recovery.Stage, "plugin")
	partial := staged
	if _, err := pm.pluginsRoot.Stat("flux"); err == nil {
		partial = "flux" // The old implementation incorrectly materializes this.
	}
	_, err = pm.pluginsRoot.Stat(filepath.Join(partial, "a-removed.txt"))
	assert.True(t, os.IsNotExist(err), "prove actual partial deletion, not merely a preflight refusal")
	require.NoError(t, os.Chmod(pm.pluginsRoot.ResolvePath(filepath.Join(partial, "z-blocked")), 0700))
	survivor, err := pm.pluginsRoot.ReadFile(filepath.Join(partial, "z-blocked/keep.txt"))
	require.NoError(t, err)
	assert.Equal(t, "partial recovery bytes", string(survivor))
	assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"), "partially disposed bytes must never be rolled back as an installation")

	// Deterministically reintroduce the exact original inode, avoiding allocator
	// reuse assumptions. Even a matching identity is untrusted after disposal.
	if partial == staged {
		require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace(staged, "flux"))
	}
	reappearedIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	require.Equal(t, originalIdentity, reappearedIdentity)
	restarted := newTestManager(t)
	restarted.stateRoot, restarted.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	restarted.pidTracker = NewPIDTracker(pm.stateRoot)
	require.NoError(t, restarted.Initialize(context.Background()))
	restarted.emitter = uninstallInventoryConsumer{refresh: func() { refreshes++ }}
	_, err = restarted.UninstallPlugin("flux")
	assert.Error(t, err, "durable cleanup phase must prohibit canonical adoption even when inode identity matches")
	survivor, readErr := restarted.pluginsRoot.ReadFile("flux/z-blocked/keep.txt")
	assert.NoError(t, readErr)
	assert.Equal(t, "partial recovery bytes", string(survivor))
	assert.Equal(t, 0, refreshes)
}
