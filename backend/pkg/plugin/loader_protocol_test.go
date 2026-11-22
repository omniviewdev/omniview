package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// S4 (docs/ui-next/status/S4.md): a plugin whose process speaks a plugin protocol the host does not run is refused in words, by a decision the host makes from the NUMBER the handshake negotiated, and is told to
// the window as the cause `incompatible` with the two numbers. These tests start real plugin processes: a real go-plugin server that serves only the protocol a test names, so what the loader reads is what a
// plugin built on another protocol really says. The wire is written out here (the event's name, the keys and the words), not read from the code under test.

// causesOf is the causes the window was told, in order.
func causesOf(told []map[string]any) []string {
	causes := make([]string, 0, len(told))
	for _, payload := range told {
		cause, _ := payload["cause"].(string)
		causes = append(causes, cause)
	}
	return causes
}

// inventoryOf is what the host's inventory says of the plugin, as it goes over the wire: the JSON of the record's `PluginInfo`.
func inventoryOf(t *testing.T, pm *pluginManager, id string) map[string]any {
	t.Helper()
	info, err := pm.GetPlugin(id)
	require.NoError(t, err)
	raw, err := json.Marshal(info)
	require.NoError(t, err)
	var listed map[string]any
	require.NoError(t, json.Unmarshal(raw, &listed))
	return listed
}

func TestAProcessThatSpeaksAProtocolTheHostDoesNotRunIsRefusedAsIncompatibleWithBothVersions(t *testing.T) {
	pm := newTestManager(t)
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	pidFile := protocolPlugin(t, pm, "acme", 2)

	started := time.Now()
	_, err := pm.LoadPlugin("acme", nil)
	took := time.Since(started)

	require.Error(t, err)
	assert.Less(t, took, 10*time.Second, "the refusal is made when the plugin has said its protocol: it never waits for the start timeout")
	events := recorder.getEvents()
	assert.Equal(t, []map[string]any{{
		"pluginID": "acme",
		"cause":    "incompatible",
		"incompatibility": map[string]any{
			"pluginProtocol": float64(2),
			"accepted":       map[string]any{"oldest": float64(1), "newest": float64(1)},
		},
	}}, toldUnloaded(t, events), "the window is told the cause and the two versions, as numbers: %v", names(events))
	failedRecord(t, pm, "acme")
	assert.Equal(t, map[string]any{
		"pluginProtocol": float64(2),
		"accepted":       map[string]any{"oldest": float64(1), "newest": float64(1)},
	}, inventoryOf(t, pm, "acme")["incompatible"], "a window that opens later reads the same facts from the inventory")
	assert.NotContains(t, err.Error(), "Client versions", "the words are the host's: nothing of go-plugin's own text")
	assert.NotContains(t, inventoryOf(t, pm, "acme")["lastError"], "Client versions")
	processEnds(t, pidFile)
}

func TestAProcessBeyondTheProtocolsTheHostOffersFailsWithTheHostsSentenceAndGoPluginsWordsGoToTheLogOnly(t *testing.T) {
	// S4 decision: a plugin further ahead than the ceiling the host offers go-plugin is refused by go-plugin itself, with a string that holds the number and no type. The host does not read it (a fact only a library's text
	// carries is not a fact the host has), so the cause stays `failed`: no incompatibility, no two numbers, and no Retry taken away. What the page and the record say of it is the host's own fixed sentence for a handshake
	// that failed; go-plugin's words, which list the protocols the host offered in the order of a map (a different one on each run) and can quote what the plugin wrote, go to the host's log and nowhere else. The ceiling is a
	// policy, and this is its edge: the cure is the producer's (S4-01: the plugin stating its protocol where the host reads it before go-plugin does).
	const runs = 6
	for _, protocol := range []int{offeredProtocolCeiling + 1, 400} {
		t.Run(fmt.Sprintf("protocol %d", protocol), func(t *testing.T) {
			pm := newTestManager(t)
			recorder := &testRecordingEmitter{}
			pm.emitter = recorder
			logs := newManagerRecordingBackend()
			pm.logger = logging.New(logging.Config{Name: "omniview", Backend: logs, Level: logging.NewLevelController(logging.LevelDebug)})
			protocolPlugin(t, pm, "acme", protocol)

			var texts, recorded []string
			var lastErr error
			for range runs {
				_, err := pm.LoadPlugin("acme", nil)
				require.Error(t, err)
				var appErr *apperror.AppError
				require.ErrorAs(t, err, &appErr)
				texts = append(texts, appErr.Detail)
				recorded = append(recorded, fmt.Sprint(inventoryOf(t, pm, "acme")["lastError"]))
				lastErr = err
			}

			for run := range runs {
				assert.Equal(t, handshakeSentence, texts[run], "run %d: what the page and the error say of it is one sentence of the host's, the same on every run", run)
				assert.Contains(t, recorded[run], handshakeSentence, "run %d: and the record of the plugin says it", run)
				assert.Equal(t, recorded[0], recorded[run], "run %d: word for word, as on the first", run)
			}
			assert.NotContains(t, recorded[0], "Client versions", "nothing of go-plugin's own words")
			assert.NotContains(t, recorded[0], strconv.Itoa(protocol))
			events := recorder.getEvents()
			assert.Equal(t, slices.Repeat(toldOf("acme", "failed"), runs), toldUnloaded(t, events), "the cause stays failed on every run: %v", names(events))
			assert.Nil(t, inventoryOf(t, pm, "acme")["incompatible"], "and no two numbers")
			_, typed := plugintypes.IncompatibilityOf(lastErr)
			assert.False(t, typed, "and no typed decision: the host has no number it can state")

			var logged []string
			for _, line := range logs.rendered() {
				if strings.HasPrefix(line, "go-plugin refused the handshake of the plugin's process") {
					logged = append(logged, line)
				}
			}
			require.Len(t, logged, runs, "the host's log has go-plugin's words, once for each run: %q", logs.rendered())
			for _, line := range logged {
				assert.Contains(t, line, fmt.Sprintf("Plugin version: %d", protocol), "go-plugin's own words, with the number only they carry")
				assert.Contains(t, line, "pluginID=acme")
			}
		})
	}
}

func TestAProcessOnTheProtocolTheHostRunsStillLoadsAndNegotiatesIt(t *testing.T) {
	// The control of the refusal: the same child on protocol 1, the one the host runs, is admitted by the same handshake and dialled as before.
	pm := newTestManager(t)
	protocolPlugin(t, pm, "acme", 1)

	backend, err := pm.createBackend("acme", config.PluginMeta{ID: "acme"}, pm.pluginsRoot.ResolvePath("acme"))

	require.NoError(t, err)
	defer backend.Kill()
	assert.Equal(t, 1, backend.NegotiatedVersion())
	assert.True(t, backend.Healthy(), "the lifecycle service answers over the authenticated channel")
}

func TestTheRefusalIsTypedAndItsFactsAreFoundByTypeAnywhereInTheChain(t *testing.T) {
	pm := newTestManager(t)
	protocolPlugin(t, pm, "acme", 2)

	_, err := pm.createBackend("acme", config.PluginMeta{ID: "acme"}, pm.pluginsRoot.ResolvePath("acme"))

	var refused *plugintypes.IncompatibleError
	require.ErrorAs(t, err, &refused, "the handshake's refusal is a typed decision of the host")
	assert.Equal(t, plugintypes.Incompatibility{PluginProtocol: 2, Accepted: plugintypes.ProtocolRange{Oldest: 1, Newest: 1}}, refused.Incompatibility)
	assert.Equal(t, "This plugin was built for a different version of Omniview. It uses plugin protocol 2; this Omniview accepts protocol 1.", err.Error(),
		"the words are the host's, composed from the two numbers")
	for name, wrapped := range map[string]error{
		"wrapped by the loader as an AppError": apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "x"),
		"joined with another error":            errors.Join(errors.New("cleanup"), err),
		"wrapped with %w":                      fmt.Errorf("start: %w", err),
	} {
		facts, ok := plugintypes.IncompatibilityOf(wrapped)
		assert.True(t, ok, name)
		assert.Equal(t, refused.Incompatibility, facts, name)
		assert.Equal(t, UnloadIncompatible, loadFailureCause(wrapped), name)
	}
}

func TestTheCauseIsReadFromTheTypeAndNeverFromTheText(t *testing.T) {
	// go-plugin's own sentence, as a plain error, is only a failed load: the host never reads the words of an error, which may be the plugin's.
	goPluginText := errors.New("incompatible API version with plugin. Plugin version: 2, Client versions: [1]")
	assert.Equal(t, UnloadFailed, loadFailureCause(goPluginText))
	assert.Equal(t, UnloadFailed, loadFailureCause(errors.New("incompatible")))
	assert.Equal(t, UnloadFailed, loadFailureCause(errors.New(plugintypes.IncompatibleSentence)), "not even the host's own sentence, as text, says anything")
	_, ok := plugintypes.IncompatibilityOf(goPluginText)
	assert.False(t, ok)
	// The typed value says it, and the type outranks a timeout in the chain: the refusal is made after the plugin answered.
	typed := &plugintypes.IncompatibleError{Incompatibility: plugintypes.Incompatibility{PluginProtocol: 2, Accepted: plugintypes.AcceptedProtocols()}}
	assert.Equal(t, UnloadIncompatible, loadFailureCause(typed))
	assert.Equal(t, UnloadIncompatible, loadFailureCause(errors.Join(startTimeoutError{err: errors.New("late")}, typed)))
}

func TestTheHostAcceptsTheProtocolItRunsAndRefusesEveryOtherByNumber(t *testing.T) {
	require.NoError(t, admitProtocol(plugintypes.CurrentProtocolVersion))
	require.NoError(t, admitProtocol(plugintypes.OldestProtocolVersion))
	for _, protocol := range []int{0, 2, 3, 16, 17, 400, -1} {
		refused, ok := plugintypes.IncompatibilityOf(admitProtocol(protocol))
		require.True(t, ok, "protocol %d", protocol)
		assert.Equal(t, protocol, refused.PluginProtocol)
		assert.Equal(t, plugintypes.AcceptedProtocols(), refused.Accepted)
	}
}

func TestTheAcceptedRangeIsDeclaredOnceAndEveryThingElseIsDerivedFromIt(t *testing.T) {
	accepted := plugintypes.AcceptedProtocols()
	// What the host accepts today is what it accepted before this step: exactly protocol 1. (The step that reads a second protocol edits the declaration, and this test with it.)
	assert.Equal(t, plugintypes.ProtocolRange{Oldest: 1, Newest: 1}, accepted)

	offer := versionedPlugins()
	assert.Len(t, offer, offeredProtocolCeiling, "go-plugin is offered every protocol from the oldest up to the ceiling, so that it names the plugin's protocol")
	for protocol := 1; protocol <= offeredProtocolCeiling; protocol++ {
		set, offered := offer[protocol]
		require.True(t, offered, "protocol %d", protocol)
		if accepted.Contains(protocol) {
			assert.Len(t, set, len(capabilityClients()), "protocol %d is run: it carries the clients the host speaks", protocol)
		} else {
			assert.Empty(t, set, "protocol %d is only named: it carries no client, so nothing can be dispensed from a plugin that negotiates it", protocol)
		}
	}
	assert.ElementsMatch(t, []string{"resource", "exec", "networker", "log", "metric", "settings", "tools", "lifecycle"}, mapKeys(offer[plugintypes.CurrentProtocolVersion]))
}

func mapKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	return keys
}

func TestTheEventOfARefusalCarriesTwoNumbersAndNoTextAndOtherEventsCarryNone(t *testing.T) {
	facts := plugintypes.Incompatibility{PluginProtocol: 2, Accepted: plugintypes.ProtocolRange{Oldest: 1, Newest: 1}}
	recorder := &testRecordingEmitter{}
	typed := apperror.Wrap(&plugintypes.IncompatibleError{Incompatibility: facts}, apperror.TypePluginLoadFailed, http.StatusUnprocessableEntity, "x")

	emitLoadFailed(recorder, "acme", typed)
	emitLoadFailed(recorder, "acme", errors.New(leakedText))
	emitUnloaded(recorder, "acme", UnloadReloaded)

	told := toldUnloaded(t, recorder.getEvents())
	require.Len(t, told, 3)
	assert.Equal(t, map[string]any{
		"pluginID": "acme", "cause": "incompatible",
		"incompatibility": map[string]any{"pluginProtocol": float64(2), "accepted": map[string]any{"oldest": float64(1), "newest": float64(1)}},
	}, told[0])
	assert.Equal(t, map[string]any{"pluginID": "acme", "cause": "failed"}, told[1], "a load that failed for another reason carries no facts, and none of the text that failed it")
	assert.Equal(t, map[string]any{"pluginID": "acme", "cause": "reloaded"}, told[2])
	raw, err := json.Marshal(told[0])
	require.NoError(t, err)
	assert.Regexp(t, `^\{"cause":"incompatible","incompatibility":\{"accepted":\{"newest":1,"oldest":1\},"pluginProtocol":2\},"pluginID":"acme"\}$`, string(raw))
}

func TestACrashWhoseRecoveryMeetsAPluginOfAnotherProtocolIsNotRetried(t *testing.T) {
	pm := newTestManager(t)
	pm.ctx = t.Context()
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	backendPlugin(t, pm, "acme")
	_, err := pm.LoadPlugin("acme", nil)
	require.NoError(t, err)
	require.NoError(t, pm.writePluginStateJSON())
	// The plugin's files are replaced by a build on another protocol and its process crashes: the recovery reloads it from the files, through the real loader, and the host refuses what it finds.
	protocolPlugin(t, pm, "acme", 2)
	pm.backendFactory = nil
	hc := NewHealthChecker(testLogger(t), pm)
	pm.healthChecker = hc
	state := &CrashRecoveryState{NextBackoff: time.Millisecond}
	hc.recoveryStates["acme"] = state
	recorder.mu.Lock()
	recorder.events = nil
	recorder.mu.Unlock()

	pm.HandlePluginCrash("acme")

	assert.Equal(t, 1, state.Attempts, "one attempt, and no second one begun: the loop does not come back for another backoff")
	events := recorder.getEvents()
	assert.Equal(t, []string{"crashed", "reloaded", "incompatible"}, causesOf(toldUnloaded(t, events)), "the window is told the crash, the one reload and its refusal, and nothing after: %v", names(events))
	hc.mu.Lock()
	assert.Empty(t, hc.recoveryStates, "no recovery is left standing")
	assert.Empty(t, hc.recoveryCancels, "and no cancel for a timer that was never started again")
	assert.Equal(t, 1, hc.crashBudgets["acme"].count, "the crash counted once and the budget was not spent on attempts that cannot help")
	hc.mu.Unlock()
	failedInfo := inventoryOf(t, pm, "acme")
	assert.Equal(t, "Failed", failedInfo["phase"])
	assert.NotNil(t, failedInfo["incompatible"], "the plugin keeps the record the refused load stored, with its facts")
	var recovery PluginErrorPayload
	for _, event := range events {
		if event.event == EventCrashRecoveryFailed {
			recovery, _ = event.data[0].(PluginErrorPayload)
		}
	}
	assert.Equal(t, "This plugin was built for a different version of Omniview. It uses plugin protocol 2; this Omniview accepts protocol 1.", recovery.Error,
		"the event that carries the recovery's error says the host's own sentence, and none of go-plugin's")
	// Nothing comes back later: no timer is left to fire another attempt.
	time.Sleep(100 * time.Millisecond)
	assert.Len(t, recorder.getEvents(), len(events), "no later event")
	assert.Equal(t, 1, state.Attempts)
}
