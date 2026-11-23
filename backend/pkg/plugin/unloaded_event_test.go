package plugin

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
)

// What the window is told when a plugin that was serving it stops (PU1, decision A21). The window draws a plugin's interface from files the host serves and calls the plugin's process
// through the host, so it cannot see the process end, the plugin reload, be uninstalled or be turned off: the host has to say so, once, with the plugin's id and why in four words, and
// never in the plugin's own text. These tests pin the wire (the event's name and the keys of its payload are written out, not read from the code under test) for each way a loaded plugin stops.

// toldUnloaded returns what the window was told of plugins that stopped serving it, in order: the JSON of each payload of the "plugin/unloaded" event, as it goes over the wire.
func toldUnloaded(t *testing.T, events []testEmittedEvent) []map[string]any {
	t.Helper()
	var told []map[string]any
	for _, event := range events {
		if event.event != "plugin/unloaded" {
			continue
		}
		require.Len(t, event.data, 1, "the event carries one payload")
		raw, err := json.Marshal(event.data[0])
		require.NoError(t, err)
		var payload map[string]any
		require.NoError(t, json.Unmarshal(raw, &payload))
		told = append(told, payload)
	}
	return told
}

// names lists the events a test recorded, so a failure says what the window was told instead.
func names(events []testEmittedEvent) []string {
	list := make([]string, 0, len(events))
	for _, event := range events {
		list = append(list, event.event)
	}
	return list
}

// indexOfEvent is the place of the first event with this name after `from`, or -1.
func indexOfEvent(events []testEmittedEvent, name string, from int) int {
	for i := from; i < len(events); i++ {
		if events[i].event == name {
			return i
		}
	}
	return -1
}

// runsAgainAfter is the place of the first "plugin/state_change" to Running after `from`: what the window reads to load the plugin's interface again.
func runsAgainAfter(t *testing.T, events []testEmittedEvent, from int) int {
	t.Helper()
	if from < 0 {
		return -1
	}
	for i := from; i < len(events); i++ {
		if events[i].event != EventStateChange {
			continue
		}
		payload, ok := events[i].data[0].(StateChangePayload)
		require.True(t, ok)
		if payload.To == lifecycle.PhaseRunning {
			return i
		}
	}
	return -1
}

// loadedPlugin is a plugin with an interface and no process (the fixture of the seam is one too), loaded and persisted, with the events of its first load set aside: only what happens next is under test.
func loadedPlugin(t *testing.T, id string) (*pluginManager, *testRecordingEmitter) {
	t.Helper()
	pm := newTestManager(t)
	pm.ctx = context.Background()
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	installPluginFixture(t, pm, id, []string{"ui"}, false)
	require.NoError(t, os.MkdirAll(pm.pluginsRoot.ResolvePath(id+"/assets"), 0o755))
	_, err := pm.LoadPlugin(id, nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	recorder.mu.Lock()
	recorder.events = nil
	recorder.mu.Unlock()
	return pm, recorder
}

func TestAReloadTellsTheWindowTheInterfaceIsGoneBeforeThePluginIsBack(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")

	_, err := pm.ReloadPlugin("acme")
	require.NoError(t, err)

	events := recorder.getEvents()
	assert.Equal(t, []map[string]any{{"pluginID": "acme", "cause": "reloaded"}}, toldUnloaded(t, events), "the window was told: %v", names(events))
	told := indexOfEvent(events, "plugin/unloaded", 0)
	back := runsAgainAfter(t, events, 0)
	require.GreaterOrEqual(t, back, 0, "the plugin runs again: %v", names(events))
	assert.Less(t, told, back, "the window is told it is gone before it is told it runs again, so the one it reads last is the true one")
}

func TestAnUpdateOrAReinstallTellsTheWindowTheInterfaceIsGone(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0o644, body: "id: acme\nversion: 0.4.0\ncapabilities: [ui]\n"},
		{name: "assets/", mode: 0o755, dir: true},
		{name: "assets/entry.js", mode: 0o644, body: "installed bundle"},
	})

	_, err := pm.InstallPluginFromPath(archive)
	require.NoError(t, err)

	events := recorder.getEvents()
	assert.Equal(t, []map[string]any{{"pluginID": "acme", "cause": "reloaded"}}, toldUnloaded(t, events), "the window was told: %v", names(events))
	told := indexOfEvent(events, "plugin/unloaded", 0)
	back := runsAgainAfter(t, events, 0)
	require.GreaterOrEqual(t, back, 0, "the plugin runs again: %v", names(events))
	assert.Less(t, told, back, "the window is told the old interface is gone before the new one runs")
}

func TestUninstallingTellsTheWindowThePluginIsGone(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")

	_, err := pm.UninstallPlugin("acme")
	require.NoError(t, err)

	events := recorder.getEvents()
	assert.Equal(t, []map[string]any{{"pluginID": "acme", "cause": "uninstalled"}}, toldUnloaded(t, events), "the window was told: %v", names(events))
}

func TestTurningAPluginOffTellsTheWindowAndTurningItOnDoesNot(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")

	_, err := pm.SetPluginEnabled("acme", false)
	require.NoError(t, err)
	assert.Equal(t, []map[string]any{{"pluginID": "acme", "cause": "disabled"}}, toldUnloaded(t, recorder.getEvents()), "the window was told: %v", names(recorder.getEvents()))

	_, err = pm.SetPluginEnabled("acme", true)
	require.NoError(t, err)
	assert.Len(t, toldUnloaded(t, recorder.getEvents()), 1, "turning it on stops nothing: the window learns that from the inventory and from the plugin running")
}

// exhaustedRecovery is a manager whose crash recovery has no attempts left, so a crash ends at once in a failed plugin instead of waiting to restart it.
func exhaustedRecovery(t *testing.T, pm *pluginManager, id string) *HealthChecker {
	t.Helper()
	checker := NewHealthChecker(testLogger(t), pm)
	checker.recoveryStates[id] = &CrashRecoveryState{Attempts: maxCrashRetries, NextBackoff: maxCrashBackoff}
	pm.healthChecker = checker
	return checker
}

func TestACrashTellsTheWindowThePluginIsGone(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")
	exhaustedRecovery(t, pm, "acme")

	pm.HandlePluginCrash("acme")

	events := recorder.getEvents()
	assert.Equal(t, []map[string]any{{"pluginID": "acme", "cause": "crashed"}}, toldUnloaded(t, events), "the window was told: %v", names(events))
	assert.GreaterOrEqual(t, indexOfEvent(events, EventCrash, 0), 0, "the event that carries the plugin's last log line is still sent, for the readers that want it")
}

func TestEveryCrashTellsTheWindowNotOnlyTheFirstOfACycle(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")
	checker := exhaustedRecovery(t, pm, "acme")
	// A plugin that crashed a moment ago and was brought back crashes again: "plugin/crash" is sent for the first crash of a cycle only, but the plugin it brought back is gone from the window again.
	checker.crashBudgets["acme"] = &crashBudget{count: 1, windowStart: time.Now()}

	pm.HandlePluginCrash("acme")

	events := recorder.getEvents()
	assert.Equal(t, -1, indexOfEvent(events, EventCrash, 0), "this is not the first crash of its cycle")
	assert.Equal(t, []map[string]any{{"pluginID": "acme", "cause": "crashed"}}, toldUnloaded(t, events), "the window was told: %v", names(events))
}

func TestACrashThatTheHostRecoversIsToldFirstAsACrashAndThenAsTheReloadThatRecoversIt(t *testing.T) {
	pm, recorder := loadedPlugin(t, "acme")
	// No health checker: the plugin is brought back by the manager's own single retry, a second later. That retry is a reload, a stop of its own, and the window is told of it too:
	// what it reads is the crash first, then the reload, then the plugin running again, so the cause it shows for as long as the plugin is gone is the one the plugin went away with.
	pm.healthChecker = nil

	pm.HandlePluginCrash("acme")

	events := recorder.getEvents()
	assert.Equal(t, []map[string]any{{"pluginID": "acme", "cause": "crashed"}, {"pluginID": "acme", "cause": "reloaded"}}, toldUnloaded(t, events), "the window was told: %v", names(events))
	crashed := indexOfEvent(events, "plugin/unloaded", 0)
	reloaded := indexOfEvent(events, "plugin/unloaded", crashed+1)
	back := runsAgainAfter(t, events, reloaded)
	assert.True(t, crashed >= 0 && reloaded > crashed && back > reloaded, "crash, then reload, then running: %v", names(events))
}

func TestARelinkedDevelopmentPluginTellsTheWindowTheOldBuildIsGoneAndAFirstLinkTellsNoOne(t *testing.T) {
	pm := newTestManager(t)
	pm.ctx = context.Background()
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	pm.devServerMgr = &transactionDevServers{}
	source := devSourceFixture(t, uiOnlyYaml)

	_, err := pm.InstallDevPluginFromPath(source)
	require.NoError(t, err)
	assert.Empty(t, toldUnloaded(t, recorder.getEvents()), "nothing was loaded before the first link, so no window holds an interface of it: %v", names(recorder.getEvents()))

	_, err = pm.InstallDevPluginFromPath(source)
	require.NoError(t, err)
	assert.Equal(t, []map[string]any{{"pluginID": "flux", "cause": "reloaded"}}, toldUnloaded(t, recorder.getEvents()), "the window was told: %v", names(recorder.getEvents()))
}

func TestAFirstInstallFromAnArchiveTellsNoOne(t *testing.T) {
	pm := newTestManager(t)
	pm.ctx = context.Background()
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	archive := writeTestTarball(t, []tarEntry{
		{name: "plugin.yaml", mode: 0o644, body: "id: acme\nversion: 0.4.0\ncapabilities: [ui]\n"},
		{name: "assets/", mode: 0o755, dir: true},
		{name: "assets/entry.js", mode: 0o644, body: "installed bundle"},
	})

	_, err := pm.InstallPluginFromPath(archive)
	require.NoError(t, err)

	assert.Empty(t, toldUnloaded(t, recorder.getEvents()), "nothing was loaded before it, so there is nothing to drop: %v", names(recorder.getEvents()))
}

func TestTheEventIsAPluginIDAndACauseCodeAndNothingElse(t *testing.T) {
	// The wire is written out: the name the window listens to, and the keys of the payload: the id and the cause, and for a refusal by protocol number the two numbers the host decided on. Anything else would be text, and the
	// window must not be handed a plugin's words.
	assert.Equal(t, "plugin/unloaded", EventUnloaded)
	assert.Equal(t, 3, reflect.TypeOf(UnloadedPayload{}).NumField())
	raw, err := json.Marshal(UnloadedPayload{PluginID: "acme", Cause: UnloadCrashed})
	require.NoError(t, err)
	assert.JSONEq(t, `{"pluginID":"acme","cause":"crashed"}`, string(raw), "a cause that is not a refusal carries no facts: the member is left out")
	for _, cause := range []UnloadCause{UnloadCrashed, UnloadReloaded, UnloadUninstalled, UnloadDisabled, UnloadFailed, UnloadTimedOut, UnloadIncompatible} {
		assert.Regexp(t, `^[a-z]+$`, string(cause), "a cause is one lower-case word")
	}
	// The one member beside them is numbers all the way down: not one string, so no word of a plugin or of go-plugin can travel in it.
	var numbersOnly func(reflect.Type) bool
	numbersOnly = func(kind reflect.Type) bool {
		if kind.Kind() == reflect.Pointer {
			return numbersOnly(kind.Elem())
		}
		if kind.Kind() == reflect.Int {
			return true
		}
		if kind.Kind() != reflect.Struct {
			return false
		}
		for i := range kind.NumField() {
			if !numbersOnly(kind.Field(i).Type) {
				return false
			}
		}
		return true
	}
	member, found := reflect.TypeOf(UnloadedPayload{}).FieldByName("Incompatibility")
	require.True(t, found)
	assert.True(t, numbersOnly(member.Type), "the facts of a refusal are two integers and a range of integers, and nothing that could hold text")
}
