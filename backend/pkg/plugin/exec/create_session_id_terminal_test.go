//go:build !windows

package exec

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// install puts a plugin's provider where OnPluginStart would, in the controller of a terminal fixture.
func (fx *terminalFixture) install(pluginID string, provider Provider) {
	fx.t.Helper()
	fx.ctrl.resourceClient = aConnectionTheHostHolds{}
	fx.ctrl.OnPluginInit(pluginID, config.PluginMeta{})
	fx.ctrl.mu.Lock()
	fx.ctrl.clients[pluginID] = provider
	fx.ctrl.inChans[pluginID] = make(chan sdkexec.StreamInput, 8)
	fx.ctrl.mu.Unlock()
}

// createSessionAs is a page's CreateSession through the wrapper, as the bindings call it.
func (fx *terminalFixture) createSessionAs(window application.Window, pluginID string, opts sdkexec.SessionOptions) (*sdkexec.Session, error) {
	fx.t.Helper()
	encoded, err := json.Marshal(opts)
	require.NoError(fx.t, err)

	return fx.wrapper.CreateSession(fx.ctx(window), pluginID, endedFixtureConnection, string(encoded))
}

// requireStillTheLocalTerminal says the id is still the terminal's: the host knows it as a local shell, writes
// reach it, and the one close that ends it is its own and reaches the shell, not a plugin.
func (fx *terminalFixture) requireStillTheLocalTerminal(id string, plugin *aKeepingPlugin, pluginCloses int) {
	fx.t.Helper()
	fx.ctrl.mu.RLock()
	record, found := fx.ctrl.sessionIndex[id]
	fx.ctrl.mu.RUnlock()
	require.True(fx.t, found, "the host still has a record for the terminal")
	require.True(fx.t, record.local, "and it is the record of a local shell")

	busy, err := fx.wrapper.IsBusy(id)
	require.NoError(fx.t, err)
	require.Equal(fx.t, terminal.StateIdle, busy.State, "the host asks the shell, and is not told 'unknown: remote'")

	require.NoError(fx.t, fx.wrapper.WriteTerminal(id, 0, []byte("echo alive-$((40+2))\n")))
	require.Eventually(fx.t, func() bool { return strings.Contains(fx.output(id), "alive-42") }, 20*time.Second, 5*time.Millisecond)

	require.NoError(fx.t, fx.wrapper.CloseSession(id))
	require.Eventually(fx.t, func() bool { return len(fx.closes(id)) == 1 }, 20*time.Second, 5*time.Millisecond)
	require.Equal(fx.t, terminal.ClosedByRequest, fx.closes(id)[0].ClosedBy, "the shell was ended by the close")
	require.Equal(fx.t, pluginCloses, plugin.callCount("close"), "the close did not go to a plugin")
}

// Window B learned the id of window A's terminal (every window is sent the events that name it) and asks a plugin
// for a session with it. The terminal keeps its id: B is refused, the plugin is not asked, and A's terminal is
// still the local shell it was.
func TestCreateSessionRefusesTheIDOfATerminalOfAnotherWindow(t *testing.T) {
	fx := newTerminalFixture(t)
	plugin := newAKeepingPlugin()
	fx.install("plugin", plugin)
	a, b := fx.page(1), fx.page(2)
	info := fx.open(a, terminal.Options{ID: "a-terminal"})

	_, err := fx.createSessionAs(b, "plugin", sdkexec.SessionOptions{ID: info.ID})
	requireIDInUse(t, err)
	require.Zero(t, plugin.callCount("create"), "the plugin was not asked to make a session that the host would refuse")

	fx.requireStillTheLocalTerminal(info.ID, plugin, 0)
}

// The terminal can take the id after the plugin has made its session and before the host records it: the plugin
// has answered nothing yet, so the id is free in the host's index, and the order is forced. The plugin's session is
// the one that is refused: it is closed with its plugin, and its CLOSE does not end the terminal's record or tell
// the windows that the terminal closed.
func TestAPluginSessionThatAnswersTheIDOfATerminalMadeMeanwhileIsRefusedAndClosed(t *testing.T) {
	fx := newTerminalFixture(t)
	plugin := newAPluginThatHoldsItsAnswer()
	fx.install("plugin", plugin)
	a, b := fx.page(1), fx.page(2)

	created := make(chan aCreateResult, 1)
	go func() {
		session, err := fx.createSessionAs(b, "plugin", sdkexec.SessionOptions{ID: "contested", Command: []string{"held"}})
		created <- aCreateResult{session: session, err: err}
	}()
	plugin.madeBy(t, "held")
	info := fx.open(a, terminal.Options{ID: "contested"})
	plugin.answer("held")

	var result aCreateResult
	select {
	case result = <-created:
	case <-time.After(createIDBound):
		t.Fatal("CreateSession did not answer")
	}
	requireIDInUse(t, result.err)
	require.Nil(t, result.session)
	require.Equal(t, 1, plugin.callCount("close"), "the plugin's session is closed with the plugin")

	// The plugin's session says CLOSE as it ends.
	frameFrom(t, fx.ctrl, "plugin", aCloseSignal(info.ID))
	for _, event := range fx.eventsOf(info.ID) {
		require.NotEqual(t, localCloseEvent+info.ID, event.name, "the windows were not told that the terminal closed")
	}

	fx.requireStillTheLocalTerminal(info.ID, plugin.aKeepingPlugin, 1)
}
