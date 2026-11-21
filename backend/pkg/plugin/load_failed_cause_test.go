package plugin

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The two causes a failed load has (PU2): "failed" for a load that ended in an error and "timeout" for a plugin that did not answer within the loader's own start timeout (pluginStartTimeout, go-plugin's
// StartTimeout for the process). The cause is read from what timed out, never from the words of an error, which may be the plugin's own.

func TestTheCausesOfAFailedLoadAreTwoCodes(t *testing.T) {
	// The wire is written out: a load that failed is "failed" and a load that ran out of the loader's start timeout is "timeout", both lower-case words, and a cause is never text.
	assert.Equal(t, "failed", string(UnloadFailed))
	assert.Equal(t, "timeout", string(UnloadTimedOut))
	for _, cause := range []UnloadCause{UnloadFailed, UnloadTimedOut} {
		assert.Regexp(t, `^[a-z]+$`, string(cause), "a cause is one lower-case word")
	}
	raw, err := json.Marshal(UnloadedPayload{PluginID: "acme", Cause: UnloadTimedOut})
	require.NoError(t, err)
	assert.JSONEq(t, `{"pluginID":"acme","cause":"timeout"}`, string(raw))
}

func TestTheCauseOfAFailureIsReadFromWhatTimedOutAndNotFromItsText(t *testing.T) {
	assert.Equal(t, UnloadFailed, loadFailureCause(errors.New("timeout while waiting for plugin to start")), "words say nothing: a plugin's own text may say anything")
	assert.Equal(t, UnloadFailed, loadFailureCause(errors.New("deadline exceeded")))
	assert.Equal(t, UnloadTimedOut, loadFailureCause(startTimeoutError{err: errors.New("the process did not answer")}))
	assert.Equal(t, UnloadTimedOut, loadFailureCause(errors.Join(errors.New("start"), startTimeoutError{err: errors.New("x")})), "and it is found in an error that wraps it")
}

// slowPlugin is a plugin whose process starts and never says anything: it neither completes its handshake nor ends, so the only thing that ends its load is the loader's own start timeout.
func slowPlugin(t *testing.T, pm *pluginManager, id string) {
	t.Helper()
	installPluginFixture(t, pm, id, []string{"resource"}, true)
	writePluginFixture(t, filepath.Join(pm.pluginsRoot.ResolvePath(id), "bin"), &pluginFixtureBehaviour{SleepSeconds: 30})
}

func TestAProcessThatDoesNotAnswerWithinTheLoadersStartTimeoutEndsTheLoadAsTimedOut(t *testing.T) {
	pm := newTestManager(t)
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	slowPlugin(t, pm, "acme")
	pm.startTimeout = 400 * time.Millisecond

	started := time.Now()
	_, err := pm.LoadPlugin("acme", nil)
	took := time.Since(started)

	require.Error(t, err)
	assert.Less(t, took, 10*time.Second, "the load ends: it is bounded by the loader's own timeout, which this manager has lowered")
	events := recorder.getEvents()
	assert.Equal(t, toldOf("acme", "timeout"), toldUnloaded(t, events), "the window was told: %v", names(events))
	failedRecord(t, pm, "acme")
}

func TestAProcessThatEndsAtOnceIsNotATimeout(t *testing.T) {
	pm := newTestManager(t)
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	installPluginFixture(t, pm, "acme", []string{"resource"}, true)
	writePluginFixture(t, filepath.Join(pm.pluginsRoot.ResolvePath("acme"), "bin"), &pluginFixtureBehaviour{ExitCode: 3})
	pm.startTimeout = 30 * time.Second

	started := time.Now()
	_, err := pm.LoadPlugin("acme", nil)

	require.Error(t, err)
	assert.Less(t, time.Since(started), 10*time.Second, "it ended with the process, long before the timeout")
	assert.Equal(t, toldOf("acme", "failed"), toldUnloaded(t, recorder.getEvents()), "a process that exits is a plugin that did not start, not one that took too long: %v", names(recorder.getEvents()))
}
