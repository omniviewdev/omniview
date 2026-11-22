package plugin

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

// A plugin the host refuses is never spoken to (S4, review of #659). The decision is made from the number the handshake names, and what the host owes a plugin it will not run is nothing: its process is killed before
// anything is dialled, so that a plugin that does not answer, that accepts a connection and says nothing, or that presents a certificate that fails cannot hold the load. The first version of the refusal asked such a
// plugin to stop (go-plugin's Kill makes three requests on an authenticated channel, the first of them with no deadline), and the load of a plugin whose Shutdown never answers never returned: the plugin's lock was held for
// ever, and the start of the host waits for every load. These tests start real processes that misbehave in each of those ways (loader_protocol_child_test.go) and require what the host did to be nothing.

// refusalBound is how long the load of a refused plugin may take. Measured: 50 to 90 ms (a process start, its handshake line, and its end). The refusals that waited on the plugin took for ever (a request nobody
// answers), 22 s (a listener that accepts and says nothing) and 2 s (a certificate that fails, then go-plugin's wait for a graceful exit).
const refusalBound = 3 * time.Second

// socketsIn is the sockets of go-plugin servers that are left in a plugin's temporary directory: the files called plugin and a number.
func socketsIn(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	var left []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "plugin") {
			left = append(left, entry.Name())
		}
	}
	return left
}

type refusalRow struct {
	name     string
	protocol int
	mode     string
}

// refusalRows are the plugins the host refuses for their protocol that do not behave: the reviewer's fixtures (a Shutdown that never answers, a listener that says nothing, a certificate that fails) and the two
// that behave, at the edges of what the host offers.
func refusalRows() []refusalRow {
	return []refusalRow{
		{name: "a plugin that answers everything", protocol: 2, mode: ""},
		{name: "the last protocol the host offers", protocol: 16, mode: ""},
		{name: "a plugin whose Shutdown never answers", protocol: 2, mode: modeHangShutdown},
		{name: "a plugin that accepts a connection and never speaks", protocol: 2, mode: modeTarpit},
		{name: "a plugin that presents another certificate than the one it advertised", protocol: 2, mode: modeImpostor},
	}
}

func TestAPluginTheHostRefusesForItsProtocolIsNeverSpokenToAndIsGoneWhenTheLoadReturns(t *testing.T) {
	for _, row := range refusalRows() {
		t.Run(row.name, func(t *testing.T) {
			pm := newTestManager(t)
			fixture := installProtocolPlugin(t, pm, "acme", row.protocol, row.mode)

			backend, took, err := createWithin(t, pm, fixture, refusalBound)

			if backend != nil {
				backend.Kill()
			}
			var refused *plugintypes.IncompatibleError
			require.ErrorAs(t, err, &refused, "the host refuses it by the number it named")
			assert.Equal(t, row.protocol, refused.PluginProtocol)
			assert.Less(t, took, refusalBound, "the refusal waits on nothing the plugin does")
			assert.Empty(t, heardBy(t, fixture), "nothing was said to the plugin: not a connection, not one request (go-plugin's Kill makes three, on an authenticated channel)")
			assert.Len(t, pidsIn(t, fixture.pids), 1, "one process was started")
			processEnds(t, fixture.pids)
			assert.Empty(t, socketsIn(t, fixture.sockets), "and the process left no socket behind")
		})
	}
}

func TestTheLoadOfARefusedPluginWhoseShutdownNeverAnswersEndsAndTellsTheWindowAndFreesThePlugin(t *testing.T) {
	// The whole load, as the manager makes it: its lock is the plugin's, so a load that never ended blocked the reload, the retry, the update and the uninstall of the plugin, and the start of the host.
	pm := newTestManager(t)
	recorder := &testRecordingEmitter{}
	pm.emitter = recorder
	fixture := installProtocolPlugin(t, pm, "acme", 2, modeHangShutdown)
	loaded := make(chan error, 1)
	go func() {
		_, err := pm.LoadPlugin("acme", nil)
		loaded <- err
	}()

	select {
	case err := <-loaded:
		require.Error(t, err)
	case <-time.After(refusalBound):
		for _, pid := range pidsIn(t, fixture.pids) {
			killProcess(pid)
		}
		require.FailNow(t, "the load did not answer: the host waited on a plugin it had refused, with the plugin's lock held")
	}

	assert.Equal(t, []string{"incompatible"}, causesOf(toldUnloaded(t, recorder.getEvents())), "the window was told: %v", names(recorder.getEvents()))
	again := make(chan error, 1)
	go func() {
		_, err := pm.ReloadPlugin("acme")
		again <- err
	}()
	select {
	case err := <-again:
		require.Error(t, err, "a second load is refused the same way")
	case <-time.After(refusalBound):
		for _, pid := range pidsIn(t, fixture.pids) {
			killProcess(pid)
		}
		require.FailNow(t, "the reload did not answer: the plugin's lock was never released")
	}
	assert.Empty(t, heardBy(t, fixture), "and neither load said anything to the plugin")
	processEnds(t, fixture.pids)
}
