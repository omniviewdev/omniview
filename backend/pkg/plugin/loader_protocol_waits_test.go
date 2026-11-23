package plugin

import (
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

// The waits of the host on a plugin process it has not decided to trust, or that stopped behaving (S4, review of #659: is there any other path where the host waits with no deadline on such a plugin?). Each wait
// on a started plugin is listed in docs/ui-next/status/S4.md with what bounds it; these are the tests of the two that matter most:
//
//   - a plugin that never finishes its handshake line is bounded by the loader's start timeout (go-plugin's StartTimeout, 15 s), and its process ends;
//   - an ACCEPTED plugin that never answers go-plugin's request to stop it is NOT bounded: Stop and Kill wait for it until its process ends. That is the same wait that held the load of a refused plugin before it was
//     killed first (finding S4-07: on the tree before this change too, and for the unload, the reload, the uninstall and the quit of the host, not for a load).

func TestAHandshakeLineThatNeverEndsIsBoundedByTheStartTimeoutAndTheProcessEnds(t *testing.T) {
	for name, raw := range map[string]string{
		"a handshake line with no end":     "1|1|unix|/tmp/nowhere|grpc",
		"a handshake line with no content": "",
	} {
		t.Run(name, func(t *testing.T) {
			pm := newTestManager(t)
			recorder := &testRecordingEmitter{}
			pm.emitter = recorder
			pm.startTimeout = 500 * time.Millisecond
			fixture := installProtocolPlugin(t, pm, "acme", 1, modeRaw)
			t.Setenv(protocolChildRawEnv, raw)
			loaded := make(chan error, 1)
			started := time.Now()
			go func() {
				_, err := pm.LoadPlugin("acme", nil)
				loaded <- err
			}()

			select {
			case err := <-loaded:
				require.Error(t, err)
			case <-time.After(10 * time.Second):
				for _, pid := range pidsIn(t, fixture.pids) {
					killProcess(pid)
				}
				require.FailNow(t, "the load did not answer: a handshake line that never ends held it past the start timeout")
			}

			assert.Less(t, time.Since(started), 5*time.Second, "bounded by the start timeout, which this manager has lowered to 500 ms")
			assert.Equal(t, []string{"timeout"}, causesOf(toldUnloaded(t, recorder.getEvents())), "the window was told: %v", names(recorder.getEvents()))
			processEnds(t, fixture.pids)
		})
	}
}

// stopObservation is how long the next test waits for Stop to return before it says it is blocked. S4_OBSERVE_STOP=<seconds> lengthens it, to measure.
func stopObservation(t *testing.T) time.Duration {
	t.Helper()
	text := os.Getenv("S4_OBSERVE_STOP")
	if text == "" {
		return 3 * time.Second
	}
	seconds, err := strconv.Atoi(text)
	require.NoError(t, err)
	return time.Duration(seconds) * time.Second
}

// TestAnAcceptedPluginThatNeverAnswersShutdownBlocksStopAndKillUntilItsProcessEnds pins what the host does today, as a tripwire for the day it is bounded (finding S4-07 of docs/ui-next/status/S4.md). Stop is
// go-plugin's Close, and Kill is go-plugin's Kill, which closes the client the same way: each asks the plugin to shut down with a context that has no deadline, and ends only with the plugin's process. The unload, the
// reload, the uninstall, the cleanup of a start that failed and the quit of the host call them (shutdownBackend, shutdownPlugin) for every plugin that runs. A plugin whose server is wedged (it still holds its
// process, and its connection, and answers nothing) holds them all. It is not new and not a part of the refusal of a plugin (which this change makes never ask anything of a plugin it does not run), so it is recorded
// and not fixed here: when either is bounded, this test fails, and is to be turned into the test of the bound.
func TestAnAcceptedPluginThatNeverAnswersShutdownBlocksStopAndKillUntilItsProcessEnds(t *testing.T) {
	for name, stop := range map[string]func(backend plugintypes.PluginBackend){
		"Stop": func(backend plugintypes.PluginBackend) { _ = backend.Stop() },
		"Kill": func(backend plugintypes.PluginBackend) { backend.Kill() },
	} {
		t.Run(name, func(t *testing.T) {
			pm := newTestManager(t)
			fixture := installProtocolPlugin(t, pm, "acme", 1, modeHangShutdown)
			backend, _, err := createWithin(t, pm, fixture, 10*time.Second)
			require.NoError(t, err, "a plugin of the protocol the host runs is accepted: the wedge is in what it does when it is asked to stop")
			stopped := make(chan struct{})
			go func() {
				stop(backend)
				close(stopped)
			}()
			window := stopObservation(t)

			select {
			case <-stopped:
				require.FailNow(t, name+" returned: it is bounded now (S4-07 is fixed): this test is to become the test of the bound")
			case <-time.After(window):
				t.Logf("S4_OBSERVE %s of an accepted plugin whose Shutdown never answers: still blocked after %v", name, window)
			}

			// What ends it is the end of the plugin's process: the request fails, and the call returns.
			for _, pid := range pidsIn(t, fixture.pids) {
				killProcess(pid)
			}
			select {
			case <-stopped:
			case <-time.After(30 * time.Second):
				require.FailNow(t, name+" was still blocked 30 s after the plugin's process ended")
			}
			backend.Kill()
		})
	}
}
