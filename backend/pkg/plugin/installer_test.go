package plugin

import (
	"errors"
	"os"
	"path/filepath"
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
