package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devcontract"
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

func (d *transactionDevServers) SupervisorOwnsStartup() bool {
	return false
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

func TestInstallPluginFromPath_RefreshesInventoryOnlyAfterDurablePublication(t *testing.T) {
	for _, replacement := range []bool{false, true} {
		name := "fresh"
		if replacement {
			name = "replacement"
		}
		t.Run(name, func(t *testing.T) {
			pm := newTestManager(t)
			if replacement {
				installPluginFixture(t, pm, "flux", []string{"ui"}, false)
				require.NoError(t, os.MkdirAll(pm.pluginsRoot.ResolvePath("flux/assets"), 0755))
				_, err := pm.LoadPlugin("flux", nil)
				require.NoError(t, err)
				require.NoError(t, pm.writePluginStateJSON())
			}
			archive := writeTestTarball(t, []tarEntry{
				{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [ui]\n"},
				{name: "assets/", mode: 0755, dir: true},
				{name: "assets/entry.js", mode: 0644, body: "installed bundle"},
			})
			before, err := os.ReadFile(archive)
			require.NoError(t, err)
			visibleInventory := pm.ListPlugins()
			refreshes := 0
			pm.emitter = uninstallInventoryConsumer{refresh: func() {
				refreshes++
				visibleInventory = pm.ListPlugins()
				persisted, readErr := pm.readPluginStateJSON()
				require.NoError(t, readErr)
				require.Len(t, persisted, 1)
				assert.Equal(t, "0.4.0", persisted[0].Metadata.Version)
				assert.Equal(t, lifecycle.PhaseRunning, persisted[0].Phase)
				bundle, readErr := os.ReadFile(pm.pluginsRoot.ResolvePath("flux/assets/entry.js"))
				require.NoError(t, readErr)
				assert.Equal(t, "installed bundle", string(bundle))
			}}

			_, err = pm.InstallPluginFromPath(archive)
			require.NoError(t, err)
			require.Len(t, visibleInventory, 1, "an existing consumer must observe the committed installation")
			assert.Equal(t, "0.4.0", visibleInventory[0].Metadata.Version)
			assert.Equal(t, string(lifecycle.PhaseRunning), visibleInventory[0].Phase)
			assert.Equal(t, 1, refreshes, "install/replacement must publish exactly one durable inventory invalidation")
			after, err := os.ReadFile(archive)
			require.NoError(t, err)
			assert.Equal(t, before, after)
		})
	}
}

func TestInstallPluginFromPath_DoesNotPublishInventorySuccessOnFailure(t *testing.T) {
	for _, failure := range []string{"load", "persist"} {
		t.Run(failure, func(t *testing.T) {
			pm := newTestManager(t)
			metadata := uiOnlyYaml
			if failure == "load" {
				metadata = backendYaml
			} else {
				require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0700))
			}
			archive := writeTestTarball(t, []tarEntry{
				{name: "plugin.yaml", mode: 0644, body: metadata},
				{name: "assets/", mode: 0755, dir: true},
				{name: "assets/entry.js", mode: 0644, body: "installed bundle"},
			})
			refreshes := 0
			pm.emitter = uninstallInventoryConsumer{refresh: func() { refreshes++ }}

			_, err := pm.InstallPluginFromPath(archive)
			require.Error(t, err)
			assert.Zero(t, refreshes, "a failed load or durable publication must not announce successful inventory")
			assert.FileExists(t, archive)
		})
	}
}

func TestInstallPluginFromPath_FailedReplacementRestoresUsableInstallation(t *testing.T) {
	for _, dev := range []bool{false, true} {
		for _, failure := range []string{"load", "persist"} {
			name := failure + "/installed"
			if dev {
				name = failure + "/dev"
			}
			t.Run(name, func(t *testing.T) {
				pm := newTestManager(t)
				installPluginFixture(t, pm, "flux", []string{"resource", "ui"}, true)
				require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
				require.NoError(t, pm.pluginsRoot.WriteFile("flux/assets/entry.js", []byte("original bundle"), 0644))
				require.NoError(t, pm.pluginsRoot.MkdirAll("flux/store", 0700))
				require.NoError(t, pm.pluginsRoot.WriteFile("flux/store/survivor", []byte("original user data"), 0600))
				pm.backendFactory = func(metadata config.PluginMeta, _ string) (plugintypes.PluginBackend, error) {
					if failure == "load" && metadata.Version == "0.4.0" {
						return nil, errors.New("candidate RPC startup rejected")
					}
					return plugintypes.NewInProcessBackend(map[string]interface{}{"resource": metadata.Version}), nil
				}
				var opts *LoadPluginOptions
				servers := &transactionDevServers{}
				if dev {
					source := devSourceFixture(t, "id: flux\nversion: 1.0.0\ncapabilities: [resource, ui]\n")
					pm.devServerMgr = servers
					_, err := servers.StartDevServerForPath("flux", source)
					require.NoError(t, err)
					opts = &LoadPluginOptions{DevMode: true, DevModePath: source}
				}
				_, err := pm.LoadPlugin("flux", opts)
				require.NoError(t, err)
				require.NoError(t, pm.writePluginStateJSON())
				before := pm.records["flux"].ToStateRecord()
				beforeIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
				require.NoError(t, err)
				beforeDurable, err := pm.stateRoot.ReadFile(stateFileName)
				require.NoError(t, err)
				archive := writeTestTarball(t, []tarEntry{
					{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [resource, ui]\n"},
					{name: "assets/", mode: 0755, dir: true},
					{name: "assets/entry.js", mode: 0644, body: "candidate bundle"},
					{name: "bin/", mode: 0755, dir: true},
					{name: "bin/plugin", mode: 0755, body: "candidate executable"},
				})
				beforeArchive, err := os.ReadFile(archive)
				require.NoError(t, err)
				if failure == "persist" {
					require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0700))
				}
				emitter := &testRecordingEmitter{}
				pm.emitter = emitter

				_, err = pm.InstallPluginFromPath(archive)
				require.Error(t, err)
				require.Contains(t, pm.records, "flux")
				restored := pm.records["flux"]
				assert.Equal(t, before, restored.ToStateRecord(), "rejection must restore original source and inventory, not retain the candidate")
				if assert.NotNil(t, restored.Backend, "the original runtime must be usable again") {
					resource, dispenseErr := restored.Backend.Dispense("resource")
					require.NoError(t, dispenseErr)
					assert.Equal(t, before.Metadata.Version, resource, "runtime must serve the original installation, not the rejected candidate")
				}
				afterIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
				require.NoError(t, err)
				assert.Equal(t, beforeIdentity, afterIdentity, "rollback must restore the complete original directory, not recreate selected files")
				bundle, err := pm.pluginsRoot.ReadFile("flux/assets/entry.js")
				require.NoError(t, err)
				assert.Equal(t, "original bundle", string(bundle))
				data, err := pm.pluginsRoot.ReadFile("flux/store/survivor")
				require.NoError(t, err)
				assert.Equal(t, "original user data", string(data))
				afterDurable, err := pm.stateRoot.ReadFile(stateFileName)
				require.NoError(t, err)
				assert.Equal(t, beforeDurable, afterDurable)
				if dev {
					assert.True(t, servers.IsManaged("flux"))
					assert.Equal(t, before.DevPath, servers.state.DevPath)
				}
				afterArchive, err := os.ReadFile(archive)
				require.NoError(t, err)
				assert.Equal(t, beforeArchive, afterArchive)
				for _, event := range emitter.getEvents() {
					assert.NotEqual(t, EventInventoryChanged, event.event)
					assert.NotEqual(t, EventInstallFinished, event.event)
				}
			})
		}
	}
}

func TestInstallPluginFromPath_RollbackNeverAdoptsForeignCanonicalDirectory(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/store", 0700))
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/store/survivor", []byte("original user data"), 0600))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0700))
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [ui]\n"},
		{name: "assets/", mode: 0755, dir: true},
		{name: "assets/entry.js", mode: 0644, body: "candidate bundle"},
	})
	beforeArchive, err := os.ReadFile(archive)
	require.NoError(t, err)
	foreignIntroduced := false
	pm.emitter = uninstallInventoryConsumer{
		refresh: func() { t.Error("failed replacement must not publish inventory success") },
		onStateWriteFailure: func() {
			if foreignIntroduced {
				return
			}
			foreignIntroduced = true
			require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace("flux", "displaced-candidate"))
			require.NoError(t, pm.pluginsRoot.MkdirAll("flux", 0700))
			require.NoError(t, pm.pluginsRoot.WriteFile("flux/plugin.yaml", []byte(uiOnlyYaml), 0600))
			require.NoError(t, pm.pluginsRoot.WriteFile("flux/foreign-survivor", []byte("do not remove"), 0600))
		},
	}

	_, err = pm.InstallPluginFromPath(archive)
	require.Error(t, err)
	require.True(t, foreignIntroduced)
	foreignIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	require.Contains(t, pm.records, "flux")
	assert.Equal(t, lifecycle.PhaseFailed, pm.records["flux"].Phase)
	assert.Contains(t, pm.records["flux"].LastError, pm.pluginsRoot.ResolvePath(""), "compound failure must expose its actual private recovery location")
	recoveryFiles := []string{}
	require.NoError(t, filepath.WalkDir(pm.pluginsRoot.ResolvePath(""), func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() && entry.Name() == "survivor" {
			contents, readErr := os.ReadFile(path)
			require.NoError(t, readErr)
			if string(contents) == "original user data" {
				recoveryFiles = append(recoveryFiles, path)
			}
		}
		return nil
	}))
	assert.Len(t, recoveryFiles, 1, "the complete original installation must remain recoverable after a foreign entry blocks rollback")
	_, err = pm.LoadPlugin("flux", nil)
	require.Error(t, err, "pending recovery must not adopt a new canonical entry")
	_, err = pm.InstallPluginFromPath(archive)
	require.Error(t, err)
	_, err = pm.UninstallPlugin("flux")
	require.Error(t, err, "a later uninstall must not recapture and delete foreign bytes")
	afterIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	assert.Equal(t, foreignIdentity, afterIdentity)
	foreign, err := pm.pluginsRoot.ReadFile("flux/foreign-survivor")
	require.NoError(t, err)
	assert.Equal(t, "do not remove", string(foreign))
	afterArchive, err := os.ReadFile(archive)
	require.NoError(t, err)
	assert.Equal(t, beforeArchive, afterArchive)
}

func TestInstallPluginFromPath_PreflightRejectionLeavesOriginalRuntimeUntouched(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"resource", "ui"}, true)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/assets/entry.js", []byte("original bundle"), 0644))
	pm.backendFactory = func(metadata config.PluginMeta, _ string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(map[string]interface{}{"resource": metadata.Version}), nil
	}
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	before := pm.records["flux"]
	beforeIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	beforeState, err := pm.stateRoot.ReadFile(stateFileName)
	require.NoError(t, err)
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [resource, ui]\n"},
		{name: "assets/", mode: 0755, dir: true},
		{name: "assets/entry.js", mode: 0644, body: "candidate bundle"},
		{name: "bin/", mode: 0755, dir: true},
		{name: "bin/plugin", mode: 0755, body: "candidate executable"},
	})
	t.Setenv(devcontract.WorkspaceEnvironment, filepath.Join(t.TempDir(), "missing-workspace.json"))

	_, err = pm.InstallPluginFromPath(archive)
	require.Error(t, err, "workspace ownership/trusted-artifact preflight must reject before old runtime teardown")
	assert.Same(t, before, pm.records["flux"])
	assert.True(t, before.Backend.Healthy())
	resource, err := before.Backend.Dispense("resource")
	require.NoError(t, err)
	assert.Equal(t, before.Metadata.Version, resource)
	afterIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	assert.Equal(t, beforeIdentity, afterIdentity)
	bundle, err := pm.pluginsRoot.ReadFile("flux/assets/entry.js")
	require.NoError(t, err)
	assert.Equal(t, "original bundle", string(bundle))
	afterState, err := pm.stateRoot.ReadFile(stateFileName)
	require.NoError(t, err)
	assert.Equal(t, beforeState, afterState)
	assert.FileExists(t, archive)
}

func TestInstallPluginFromPath_FailedFreshInstallLeavesNoInstallation(t *testing.T) {
	for _, failure := range []string{"load", "persist"} {
		t.Run(failure, func(t *testing.T) {
			pm := newTestManager(t)
			require.NoError(t, pm.writePluginStateJSON())
			pm.backendFactory = func(_ config.PluginMeta, _ string) (plugintypes.PluginBackend, error) {
				if failure == "load" {
					return nil, errors.New("candidate RPC startup rejected")
				}
				return plugintypes.NewInProcessBackend(nil), nil
			}
			archive := writeTestTarball(t, []tarEntry{
				{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [resource, ui]\n"},
				{name: "assets/", mode: 0755, dir: true},
				{name: "assets/entry.js", mode: 0644, body: "candidate bundle"},
				{name: "bin/", mode: 0755, dir: true},
				{name: "bin/plugin", mode: 0755, body: "candidate executable"},
			})
			if failure == "persist" {
				require.NoError(t, pm.stateRoot.MkdirAll(stateFileName+".tmp", 0700))
			}
			_, err := pm.InstallPluginFromPath(archive)
			require.Error(t, err)
			assert.Empty(t, pm.records)
			assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))
			states, err := pm.readPluginStateJSON()
			require.NoError(t, err)
			assert.Empty(t, states)
			assert.FileExists(t, archive)
		})
	}
}

func TestInstallPluginFromPath_UnrelatedPersistenceKeepsArchivePreimageUntilCommit(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"resource", "ui"}, true)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
	installPluginFixture(t, pm, "other", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("other/assets", 0755))
	pm.backendFactory = func(metadata config.PluginMeta, _ string) (plugintypes.PluginBackend, error) {
		if metadata.Version == "0.4.0" {
			pm.recordsMu.Lock()
			pm.records["other"].Metadata.Version = "9.0.0"
			pm.recordsMu.Unlock()
			require.NoError(t, pm.writePluginStateJSON())
			states, readErr := pm.readPluginStateJSON()
			require.NoError(t, readErr)
			versions := map[string]string{}
			for _, state := range states {
				versions[state.ID] = state.Metadata.Version
			}
			assert.Equal(t, "1.0.0", versions["flux"], "another plugin's write must not publish an in-flight archive candidate or omit its previous state")
			assert.Equal(t, "9.0.0", versions["other"])
			return nil, errors.New("candidate RPC startup rejected")
		}
		return plugintypes.NewInProcessBackend(map[string]interface{}{"resource": metadata.Version}), nil
	}
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	_, err = pm.LoadPlugin("other", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [resource, ui]\n"},
		{name: "assets/", mode: 0755, dir: true},
		{name: "assets/entry.js", mode: 0644, body: "candidate bundle"},
		{name: "bin/", mode: 0755, dir: true},
		{name: "bin/plugin", mode: 0755, body: "candidate executable"},
	})

	_, err = pm.InstallPluginFromPath(archive)
	require.Error(t, err)
	states, err := pm.readPluginStateJSON()
	require.NoError(t, err)
	versions := map[string]string{}
	for _, state := range states {
		versions[state.ID] = state.Metadata.Version
	}
	assert.Equal(t, "1.0.0", versions["flux"])
	assert.Equal(t, "9.0.0", versions["other"], "rollback must not replace another plugin's legitimate durable update with a whole-file snapshot")
	assert.True(t, pm.records["flux"].Backend != nil && pm.records["flux"].Backend.Healthy())
}

func TestInstallPluginFromPath_PartialBackupDisposalRetainsCommittedCandidate(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("real Unix permission-denied cleanup requires an unprivileged user")
	}
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"ui"}, false)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/a-removed.txt", []byte("old disposable"), 0644))
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/z-blocked", 0700))
	require.NoError(t, pm.pluginsRoot.WriteFile("flux/z-blocked/keep.txt", []byte("old partial backup"), 0644))
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	originalIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	require.NoError(t, os.Chmod(pm.pluginsRoot.ResolvePath("flux/z-blocked"), 0000))
	t.Cleanup(func() {
		_ = os.Chmod(pm.pluginsRoot.ResolvePath("flux/z-blocked"), 0700)
		entries, _ := pm.pluginsRoot.ReadDir(".")
		for _, entry := range entries {
			if entry.IsDir() {
				_ = os.Chmod(pm.pluginsRoot.ResolvePath(filepath.Join(entry.Name(), "previous/z-blocked")), 0700)
			}
		}
	})
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [ui]\n"},
		{name: "assets/", mode: 0755, dir: true},
		{name: "assets/entry.js", mode: 0644, body: "committed candidate bundle"},
	})
	refreshes := 0
	pm.emitter = uninstallInventoryConsumer{refresh: func() { refreshes++ }}

	_, err = pm.InstallPluginFromPath(archive)
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, "omniview:plugin/committed-cleanup-pending", appErr.Type)
	require.Contains(t, pm.records, "flux")
	assert.Equal(t, "0.4.0", pm.records["flux"].Metadata.Version)
	assert.Equal(t, lifecycle.PhaseRunning, pm.records["flux"].Phase)
	assert.Equal(t, 1, refreshes, "durable candidate publication must invalidate the UI even if subsequent maintenance fails")
	states, err := pm.readPluginStateJSON()
	require.NoError(t, err)
	require.Len(t, states, 1)
	assert.Equal(t, "0.4.0", states[0].Metadata.Version)
	var recovery struct {
		Committed uint8 `json:"committed"`
		Record    struct {
			Stage string `json:"stage"`
		} `json:"record"`
	}
	proof, err := pm.stateRoot.ReadFile(".archive-recovery-flux.json")
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(proof, &recovery))
	require.Equal(t, uint8(1), recovery.Committed)
	staged := filepath.Join(recovery.Record.Stage, "previous")
	_, err = pm.pluginsRoot.Stat(filepath.Join(staged, "a-removed.txt"))
	assert.True(t, os.IsNotExist(err), "prove actual partial backup deletion before the failure")
	require.NoError(t, os.Chmod(pm.pluginsRoot.ResolvePath(filepath.Join(staged, "z-blocked")), 0700))
	partial, err := pm.pluginsRoot.ReadFile(filepath.Join(staged, "z-blocked/keep.txt"))
	require.NoError(t, err)
	assert.Equal(t, "old partial backup", string(partial))
	candidate, err := pm.pluginsRoot.ReadFile("flux/assets/entry.js")
	require.NoError(t, err)
	assert.Equal(t, "committed candidate bundle", string(candidate))

	// Deterministically reintroduce the old inode after irreversible disposal.
	// Its identity still matches, but it is no longer a complete installation.
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace("flux", "held-committed-candidate"))
	require.NoError(t, pm.pluginsRoot.RenameDirectoryNoReplace(staged, "flux"))
	reappearedIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
	require.NoError(t, err)
	require.Equal(t, originalIdentity, reappearedIdentity)
	restarted := newTestManager(t)
	restarted.stateRoot, restarted.pluginsRoot = pm.stateRoot, pm.pluginsRoot
	restarted.pidTracker = NewPIDTracker(pm.stateRoot)
	require.NoError(t, restarted.Initialize(context.Background()))
	_, err = restarted.LoadPlugin("flux", nil)
	require.Error(t, err)
	_, err = restarted.UninstallPlugin("flux")
	require.Error(t, err, "committed recovery must never adopt or dispose of the partially deleted original inode")
	partial, err = pm.pluginsRoot.ReadFile("flux/z-blocked/keep.txt")
	require.NoError(t, err)
	assert.Equal(t, "old partial backup", string(partial))
	assert.FileExists(t, archive)
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

func TestInstallPluginFromPath_DoesNotStopLiveRuntimeWithoutRestorableDirectory(t *testing.T) {
	pm := newTestManager(t)
	installPluginFixture(t, pm, "flux", []string{"resource", "ui"}, true)
	require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
	pm.backendFactory = func(metadata config.PluginMeta, _ string) (plugintypes.PluginBackend, error) {
		return plugintypes.NewInProcessBackend(map[string]interface{}{"resource": metadata.Version}), nil
	}
	_, err := pm.LoadPlugin("flux", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	original := pm.records["flux"]
	before, err := pm.stateRoot.ReadFile(stateFileName)
	require.NoError(t, err)
	require.NoError(t, pm.pluginsRoot.RemoveAll("flux"))
	require.True(t, original.Backend.Healthy(), "an already-running private snapshot can outlive its installation directory")
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [resource, ui]\n"},
		{name: "assets/", mode: 0755, dir: true},
		{name: "assets/entry.js", mode: 0644, body: "candidate bundle"},
		{name: "bin/", mode: 0755, dir: true},
		{name: "bin/plugin", mode: 0755, body: "candidate executable"},
	})

	_, err = pm.InstallPluginFromPath(archive)
	require.Error(t, err, "do not destroy the only usable runtime when no complete original can be staged")
	assert.Same(t, original, pm.records["flux"])
	assert.True(t, original.Backend.Healthy())
	provider, err := original.Backend.Dispense("resource")
	require.NoError(t, err)
	assert.Equal(t, original.Metadata.Version, provider)
	after, err := pm.stateRoot.ReadFile(stateFileName)
	require.NoError(t, err)
	assert.Equal(t, before, after)
	assert.NoDirExists(t, pm.pluginsRoot.ResolvePath("flux"))
	assert.FileExists(t, archive)
}

func TestInstallPluginFromPath_ExtractedMetadataControlsPreflightBeforeTeardown(t *testing.T) {
	for _, dev := range []bool{false, true} {
		for _, shadow := range []string{"backend-capability", "different-id"} {
			name := shadow + "/installed"
			if dev {
				name = shadow + "/dev"
			}
			t.Run(name, func(t *testing.T) {
				pm := newTestManager(t)
				installPluginFixture(t, pm, "flux", []string{"resource", "ui"}, true)
				require.NoError(t, pm.pluginsRoot.MkdirAll("flux/assets", 0755))
				require.NoError(t, pm.pluginsRoot.WriteFile("flux/assets/entry.js", []byte("original bundle"), 0644))
				pm.backendFactory = func(metadata config.PluginMeta, _ string) (plugintypes.PluginBackend, error) {
					if metadata.Version == "0.4.0" {
						return nil, errors.New("candidate RPC boundary rejected")
					}
					return plugintypes.NewInProcessBackend(map[string]interface{}{"resource": metadata.Version}), nil
				}
				var opts *LoadPluginOptions
				if dev {
					source := devSourceFixture(t, "id: flux\nversion: 1.0.0\ncapabilities: [resource, ui]\n")
					servers := &transactionDevServers{}
					pm.devServerMgr = servers
					_, err := servers.StartDevServerForPath("flux", source)
					require.NoError(t, err)
					opts = &LoadPluginOptions{DevMode: true, DevModePath: source}
				}
				_, err := pm.LoadPlugin("flux", opts)
				require.NoError(t, err)
				require.NoError(t, pm.writePluginStateJSON())
				original := pm.records["flux"]
				originalBackend := original.Backend
				originalState := original.ToStateRecord()
				originalIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
				require.NoError(t, err)
				durableBefore, err := pm.stateRoot.ReadFile(stateFileName)
				require.NoError(t, err)
				lastMetadata := "id: flux\nversion: 0.4.0\ncapabilities: [resource, ui]\n"
				if shadow == "different-id" {
					lastMetadata = "id: other\nversion: 0.4.0\ncapabilities: [ui]\n"
				}
				archive := writeTestTarball(t, []tarEntry{
					{name: "plugin.yaml", mode: 0644, body: "id: flux\nversion: 0.4.0\ncapabilities: [ui]\n"},
					{name: "assets/", mode: 0755, dir: true},
					{name: "assets/entry.js", mode: 0644, body: "candidate bundle"},
					{name: "bin/", mode: 0755, dir: true},
					{name: "bin/plugin", mode: 0755, body: "candidate executable"},
					{name: "./plugin.yaml", mode: 0644, body: lastMetadata},
				})
				archiveBefore, err := os.ReadFile(archive)
				require.NoError(t, err)
				t.Setenv(devcontract.WorkspaceEnvironment, filepath.Join(t.TempDir(), "missing-workspace.json"))
				emitter := &testRecordingEmitter{}
				pm.emitter = emitter

				_, err = pm.InstallPluginFromPath(archive)
				require.Error(t, err)
				assert.Same(t, original, pm.records["flux"], "metadata preflight rejection must not tear down/recreate the original runtime")
				assert.True(t, originalBackend.Healthy())
				assert.False(t, originalBackend.Exited())
				provider, providerErr := originalBackend.Dispense("resource")
				assert.NoError(t, providerErr)
				assert.Equal(t, originalState.Metadata.Version, provider)
				if restored := pm.records["flux"]; assert.NotNil(t, restored) {
					assert.Equal(t, originalState, restored.ToStateRecord())
				}
				afterIdentity, err := pm.pluginsRoot.DirectoryIdentity("flux")
				require.NoError(t, err)
				assert.Equal(t, originalIdentity, afterIdentity)
				bundle, err := pm.pluginsRoot.ReadFile("flux/assets/entry.js")
				require.NoError(t, err)
				assert.Equal(t, "original bundle", string(bundle))
				durableAfter, err := pm.stateRoot.ReadFile(stateFileName)
				require.NoError(t, err)
				assert.Equal(t, durableBefore, durableAfter)
				archiveAfter, err := os.ReadFile(archive)
				require.NoError(t, err)
				assert.Equal(t, archiveBefore, archiveAfter)
				for _, event := range emitter.getEvents() {
					assert.NotEqual(t, EventInventoryChanged, event.event)
					assert.NotEqual(t, EventInstallFinished, event.event)
				}
			})
		}
	}
}
