package plugin

import (
	"encoding/json"
	"errors"
	"os"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// What the window is told when a plugin's load ends in a failure (PU2: findings PU1-01 and PU1-02 of status/PU1.md). A window that is told the plugin stopped to start again waits for it to run, so a load
// that fails must say so, in the same words as every other stop ("plugin/unloaded", a plugin id and a cause that is a code and never text), and the plugin must keep a record in a failed state so the person's
// Retry (RetryFailedPlugin) has something to retry instead of answering "not loaded". As in unloaded_event_test.go the wire is written out here, not read from the code under test.

const (
	// A plugin's own words in the error of a failed start: a path of the person's machine and a credential. Neither may ever reach the window.
	leakedText = "panic: dial unix /Users/someone/.omniview/plugins/acme/sock: token=abc123"
)

// toldOf is what the window was told of the plugin id, in order: one payload for each cause, with the plugin's id and the cause and no other member.
func toldOf(id string, causes ...string) []map[string]any {
	told := make([]map[string]any, 0, len(causes))
	for _, cause := range causes {
		told = append(told, map[string]any{"pluginID": id, "cause": cause})
	}
	return told
}

// backendPlugin is a plugin with a process, which the manager's factory stands in for: the process starts while `failing` is false, and refuses to start with `leakedText` in its error while it is true.
func backendPlugin(t *testing.T, pm *pluginManager, id string) *atomic.Bool {
	t.Helper()
	installPluginFixture(t, pm, id, []string{"resource"}, true)
	failing := &atomic.Bool{}
	pm.backendFactory = func(config.PluginMeta, string) (plugintypes.PluginBackend, error) {
		if failing.Load() {
			return nil, errors.New(leakedText)
		}
		return plugintypes.NewInProcessBackend(plugintypes.InProcessBackendConfig{Providers: map[string]interface{}{"resource": "mock"}}), nil
	}
	return failing
}

// loadedBackendPlugin is a plugin with a process, loaded and persisted, with the events of its first load set aside.
func loadedBackendPlugin(t *testing.T, id string) (*pluginManager, *testRecordingEmitter, *atomic.Bool) {
	t.Helper()
	pm := newTestManager(t)
	pm.ctx = t.Context()
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	failing := backendPlugin(t, pm, id)
	_, err := pm.LoadPlugin(id, nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	recorder.mu.Lock()
	recorder.events = nil
	recorder.mu.Unlock()
	return pm, recorder, failing
}

// failedRecord is what the manager says of the plugin: the phase of the record it holds, which a retry needs one of.
func failedRecord(t *testing.T, pm *pluginManager, id string) {
	t.Helper()
	info, err := pm.GetPlugin(id)
	require.NoError(t, err, "the plugin keeps a record, so that a retry has something to retry and the plugin is still listed")
	assert.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	listed := false
	for _, plugin := range pm.ListPlugins() {
		listed = listed || plugin.ID == id
	}
	assert.True(t, listed, "and the inventory lists it")
}

// retried is the person's Retry: it answers a plugin that runs, and the window is told it does (the last it reads of the two events is the true one).
func retried(t *testing.T, pm *pluginManager, recorder *testRecordingEmitter, id string) {
	t.Helper()
	recorder.mu.Lock()
	recorder.events = nil
	recorder.mu.Unlock()
	info, err := pm.RetryFailedPlugin(id)
	require.NoError(t, err, "a retry of a plugin whose load failed is not answered \"not currently loaded\"")
	assert.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	events := recorder.getEvents()
	assert.Equal(t, toldOf(id, "reloaded"), toldUnloaded(t, events), "the window was told: %v", names(events))
	assert.Greater(t, runsAgainAfter(t, events, 0), indexOfEvent(events, "plugin/unloaded", 0), "and then that the plugin runs: %v", names(events))
}

func TestAReloadWhoseNewBuildFailsValidationTellsTheWindowAndKeepsARecordSoThatRetryWorks(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")
	assets := pm.pluginsRoot.ResolvePath("acme/assets")
	require.NoError(t, os.RemoveAll(assets), "the new build has no interface: the plugin fails validation before anything starts")

	_, err := pm.ReloadPlugin("acme")
	require.Error(t, err)

	events := recorder.getEvents()
	assert.Equal(t, toldOf("acme", "reloaded", "failed"), toldUnloaded(t, events), "the window was told: %v", names(events))
	assert.Equal(t, -1, runsAgainAfter(t, events, 0), "and it does not run: %v", names(events))
	failedRecord(t, pm, "acme")

	require.NoError(t, os.MkdirAll(assets, 0o755))
	retried(t, pm, recorder, "acme")
}

func TestAReloadWhoseProcessWillNotStartTellsTheWindowAndKeepsARecordSoThatRetryWorks(t *testing.T) {
	pm, recorder, failing := loadedBackendPlugin(t, "acme")
	failing.Store(true)

	_, err := pm.ReloadPlugin("acme")
	require.Error(t, err)

	events := recorder.getEvents()
	assert.Equal(t, toldOf("acme", "reloaded", "failed"), toldUnloaded(t, events), "the window was told: %v", names(events))
	assert.Equal(t, -1, runsAgainAfter(t, events, 0), "and it does not run: %v", names(events))
	failedRecord(t, pm, "acme")

	failing.Store(false)
	retried(t, pm, recorder, "acme")
}

func TestAReloadOfAPluginWhoseFilesAreGoneTellsTheWindowAndKeepsARecord(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")
	require.NoError(t, os.RemoveAll(pm.pluginsRoot.ResolvePath("acme")))

	_, err := pm.ReloadPlugin("acme")
	require.Error(t, err)

	events := recorder.getEvents()
	assert.Equal(t, toldOf("acme", "reloaded", "failed"), toldUnloaded(t, events), "the window was told: %v", names(events))
	failedRecord(t, pm, "acme")
	info, getErr := pm.GetPlugin("acme")
	require.NoError(t, getErr)
	assert.Equal(t, "acme", info.Metadata.ID, "the record names the plugin by the metadata the host held")
}

func TestAFirstLoadThatFailsTellsTheWindowAndKeepsARecordSoThatRetryWorks(t *testing.T) {
	t.Run("validation", func(t *testing.T) {
		pm := newTestManager(t)
		recorder := &testRecordingEmitter{}
		pm.emitter = recorder
		installPluginFixture(t, pm, "acme", []string{"ui"}, false)

		_, err := pm.LoadPlugin("acme", nil)
		require.Error(t, err)

		events := recorder.getEvents()
		assert.Equal(t, toldOf("acme", "failed"), toldUnloaded(t, events), "the window was told: %v", names(events))
		failedRecord(t, pm, "acme")
		require.NoError(t, os.MkdirAll(pm.pluginsRoot.ResolvePath("acme/assets"), 0o755))
		retried(t, pm, recorder, "acme")
	})

	t.Run("process", func(t *testing.T) {
		pm := newTestManager(t)
		recorder := &testRecordingEmitter{}
		pm.emitter = recorder
		failing := backendPlugin(t, pm, "acme")
		failing.Store(true)

		_, err := pm.LoadPlugin("acme", nil)
		require.Error(t, err)

		events := recorder.getEvents()
		assert.Equal(t, toldOf("acme", "failed"), toldUnloaded(t, events), "the window was told: %v", names(events))
		failedRecord(t, pm, "acme")
		failing.Store(false)
		retried(t, pm, recorder, "acme")
	})
}

func TestALoadThatIsNotAPluginTellsNoOneAndKeepsNoRecord(t *testing.T) {
	pm := newTestManager(t)
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder

	_, err := pm.LoadPlugin("nonexistent", nil)
	require.Error(t, err)
	require.NoError(t, pm.pluginsRoot.MkdirAll("no-meta", 0o755))
	_, err = pm.LoadPlugin("no-meta", nil)
	require.Error(t, err)

	assert.Empty(t, toldUnloaded(t, recorder.getEvents()), "there is nothing there to name, and no window holds anything of it: %v", names(recorder.getEvents()))
	assert.Empty(t, pm.ListPlugins())
}

func TestWhatTheWindowIsToldOfAFailedLoadIsACodeAndNoText(t *testing.T) {
	pm, recorder, failing := loadedBackendPlugin(t, "acme")
	failing.Store(true)

	_, err := pm.ReloadPlugin("acme")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "token=abc123", "the error of the call has the plugin's words: it is the host's to log, and the window is not told them")

	events := recorder.getEvents()
	require.Equal(t, toldOf("acme", "reloaded", "failed"), toldUnloaded(t, events))
	for _, event := range events {
		raw, marshalErr := json.Marshal(event.data)
		require.NoError(t, marshalErr)
		assert.NotContains(t, string(raw), "abc123", "%s carries the plugin's words", event.event)
		assert.NotContains(t, string(raw), "/Users/someone", "%s carries a path", event.event)
	}
	for _, payload := range toldUnloaded(t, events) {
		assert.Len(t, payload, 2, "the id and the cause, and no other member")
	}
}

func TestACrashWhoseRecoveryDoesNotStartTellsTheWindowTheCrashThenTheReloadThenThatItFailed(t *testing.T) {
	pm, recorder, failing := loadedBackendPlugin(t, "acme")
	// No health checker: the manager's own single retry brings the plugin back a second later, as the crash recovery of the host does for a plugin that cannot start again.
	pm.healthChecker = nil
	failing.Store(true)

	pm.HandlePluginCrash("acme")

	events := recorder.getEvents()
	assert.Equal(t, toldOf("acme", "crashed", "reloaded", "failed"), toldUnloaded(t, events), "the window was told: %v", names(events))
	assert.GreaterOrEqual(t, indexOfEvent(events, EventCrashRecoveryFailed, 0), 0, "and the event that carries the recovery's error is still sent, for the readers that want it")
	failedRecord(t, pm, "acme")
}

func TestARelinkedDevelopmentPluginWhoseBuildFailsTellsTheWindowAndKeepsARecord(t *testing.T) {
	pm := newTestManager(t)
	pm.ctx = t.Context()
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	servers := &transactionDevServers{}
	pm.devServerMgr = servers
	source := devSourceFixture(t, uiOnlyYaml)
	_, err := pm.InstallDevPluginFromPath(source)
	require.NoError(t, err)
	recorder.mu.Lock()
	recorder.events = nil
	recorder.mu.Unlock()
	servers.buildError = "go build: main.go:12: undefined: nothing"

	_, err = pm.InstallDevPluginFromPath(source)
	require.Error(t, err)

	events := recorder.getEvents()
	assert.Equal(t, toldOf("flux", "reloaded", "failed"), toldUnloaded(t, events), "the window was told: %v", names(events))
	info, getErr := pm.GetPlugin("flux")
	require.NoError(t, getErr)
	assert.Equal(t, string(lifecycle.PhaseBuildFailed), info.Phase)
}

func TestADevelopmentLinkWhoseLoadFailsTellsTheWindowOnceAndNotTwice(t *testing.T) {
	pm := newTestManager(t)
	pm.ctx = t.Context()
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	pm.devServerMgr = &transactionDevServers{}
	// The build the fake server reports passes, builds no binary, and the plugin that declares a process cannot load: the load fails, which the link then reports as its own failure.
	source := devSourceFixture(t, "id: flux\nversion: 0.3.0\ncapabilities:\n  - resource\n")

	_, err := pm.InstallDevPluginFromPath(source)
	require.Error(t, err)

	events := recorder.getEvents()
	assert.Equal(t, toldOf("flux", "failed"), toldUnloaded(t, events), "the load told the window it failed, and the link that wraps it does not tell it again: %v", names(events))
}

func TestAReloadThatTheHostRefusesBeforeTheLoadBeginsStillTellsTheWindow(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")
	// A marker of an uninstall that did not finish, which the host cannot read: the load of the plugin is refused before it begins, and the reload has already stopped the plugin and told the window it starts again.
	marker := pm.stateRoot.ResolvePath(uninstallRecoveryName("acme"))
	require.NoError(t, os.WriteFile(marker, []byte("not a marker"), 0o600))

	_, err := pm.ReloadPlugin("acme")
	require.Error(t, err)

	events := recorder.getEvents()
	assert.Equal(t, toldOf("acme", "reloaded", "failed"), toldUnloaded(t, events), "the window waits for the plugin to run or to fail, so it is told: %v", names(events))
	assert.Equal(t, -1, runsAgainAfter(t, events, 0), "and it does not run: %v", names(events))
}
