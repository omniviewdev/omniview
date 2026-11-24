//go:build !windows

package exec

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// M4 of the review of 6052c031. The host keeps one record for each session id (B-113) and a page chooses the id of a session it
// creates. A channel terminal has no record in the index of the events lane, so the check for an id in use did not see it: a
// plugin session could be made with the id a channel terminal held, and the other way round. Both lanes decide under the one lock
// of the controller, from the one predicate: the index, the channel terminals being made, and the terminals the manager holds.

// openChannelWithID opens a channel terminal with the id the test chooses.
func (fx *terminalFixture) openChannelWithID(id string) *terminal.Session {
	fx.t.Helper()
	info, err := fx.wrapper.CreateTerminal(context.Background(),
		execsdk.SessionOptions{ID: id, Command: append(shell(fx.t), "-c", "sleep 600")}, terminal.Launch{Channel: true})
	require.NoError(fx.t, err)
	require.Equal(fx.t, id, info.ID)
	return info
}

// requireTheChannelTerminalIsUntouched says its capability still opens it.
func (fx *terminalFixture) requireTheChannelTerminalIsUntouched(info *terminal.Session) {
	fx.t.Helper()
	_, err := fx.wrapper.ChannelTerminalCwd(info.Cap)
	require.NoError(fx.t, err, "the channel terminal is still there for its capability")
}

// A window that learned the id of a channel terminal (a label: it is the id the page chose) asks a plugin for a session with it. The
// terminal keeps its id: the call is refused, and the plugin is not asked.
func TestCreateSessionRefusesTheIDOfAChannelTerminalAndNoPluginIsAsked(t *testing.T) {
	fx := newTerminalFixture(t)
	plugin := newAKeepingPlugin()
	fx.install("plugin", plugin)
	info := fx.openChannelWithID("a-channel-terminal")

	_, err := fx.createSessionAs(fx.page(2), "plugin", sdkexecOptions(info.ID))
	guarded(t, "channel-id-held", func() {
		requireIDInUse(t, err)
		require.Zero(t, plugin.callCount("create"), "the plugin was not asked to make a session that the host would refuse")
	})
	fx.requireTheChannelTerminalIsUntouched(info)
}

// The channel terminal can take the id after the plugin has made its session and before the host records it: the order is forced
// by the plugin, which holds its answer. The plugin's session is the one that is refused, and it is closed with its plugin.
func TestAPluginSessionThatAnswersTheIDOfAChannelTerminalMadeMeanwhileIsRefusedAndClosed(t *testing.T) {
	fx := newTerminalFixture(t)
	plugin := newAPluginThatHoldsItsAnswer()
	fx.install("plugin", plugin)
	created := make(chan aCreateResult, 1)
	go func() {
		session, err := fx.createSessionAs(fx.page(2), "plugin", sdkexecOptionsHeld("contested", "held"))
		created <- aCreateResult{session: session, err: err}
	}()
	plugin.madeBy(t, "held")
	info := fx.openChannelWithID("contested")
	plugin.answer("held")

	var result aCreateResult
	select {
	case result = <-created:
	case <-time.After(createIDBound):
		t.Fatal("CreateSession did not answer")
	}
	guarded(t, "channel-id-held", func() {
		requireIDInUse(t, result.err)
		require.Nil(t, result.session)
		require.Equal(t, 1, plugin.callCount("close"), "the plugin's session is closed with the plugin")
	})
	fx.requireTheChannelTerminalIsUntouched(info)
}

// The other way: a plugin session that the host has recorded holds its id, and a channel terminal with it is refused, with no shell
// started for it.
func TestCreateTerminalForAChannelRefusesTheIDOfARecordedPluginSession(t *testing.T) {
	fx := newTerminalFixture(t)
	plugin := newAKeepingPlugin()
	fx.install("plugin", plugin)
	session, err := fx.createSessionAs(fx.page(2), "plugin", sdkexecOptions("a-plugin-session"))
	require.NoError(t, err)

	_, err = fx.wrapper.CreateTerminal(context.Background(),
		execsdk.SessionOptions{ID: session.ID, Command: append(shell(t), "-c", "sleep 600")}, terminal.Launch{Channel: true})
	requireIDInUse(t, err)
}

// Two creates of one id at once, from the two lanes and from one: the plugin has made its session and holds its answer; four
// channel creates of the id come at the same instant, and one makes the terminal; the plugin's answer is then refused. One winner.
func TestTwoCreatesOfOneIDAtOnceFromAChannelAndAPluginHaveOneWinner(t *testing.T) {
	fx := newTerminalFixture(t)
	plugin := newAPluginThatHoldsItsAnswer()
	fx.install("plugin", plugin)
	created := make(chan aCreateResult, 1)
	go func() {
		session, err := fx.createSessionAs(fx.page(2), "plugin", sdkexecOptionsHeld("contested", "held"))
		created <- aCreateResult{session: session, err: err}
	}()
	plugin.madeBy(t, "held")

	type outcome struct {
		info *terminal.Session
		err  error
	}
	results := make(chan outcome, 4)
	start := make(chan struct{})
	for range 4 {
		go func() {
			<-start
			info, err := fx.wrapper.CreateTerminal(context.Background(),
				execsdk.SessionOptions{ID: "contested", Command: append(shell(t), "-c", "sleep 600")}, terminal.Launch{Channel: true})
			results <- outcome{info: info, err: err}
		}()
	}
	close(start)
	var winner *terminal.Session
	wins := 0
	for range 4 {
		select {
		case got := <-results:
			if got.err == nil {
				wins++
				winner = got.info
			} else {
				requireIDInUse(t, got.err)
			}
		case <-time.After(createIDBound):
			t.Fatal("a create did not answer")
		}
	}
	require.Equal(t, 1, wins, "of four creates of one id at the same instant, one made the terminal")

	plugin.answer("held")
	var result aCreateResult
	select {
	case result = <-created:
	case <-time.After(createIDBound):
		t.Fatal("CreateSession did not answer")
	}
	guarded(t, "channel-id-held", func() {
		requireIDInUse(t, result.err)
		require.Equal(t, 1, plugin.callCount("close"), "the plugin's session is closed with the plugin")
	})
	fx.requireTheChannelTerminalIsUntouched(winner)
}

// An id that a channel terminal is being made with is held while its shell starts, against the plugin lane and against another
// channel create: what createChannelTerminal does for the time between its check and the manager's, which no call can be forced
// into, is put in place here.
func TestAnIDThatAChannelTerminalIsBeingMadeWithIsHeldAgainstEveryLane(t *testing.T) {
	fx := newTerminalFixture(t)
	plugin := newAKeepingPlugin()
	fx.install("plugin", plugin)
	fx.ctrl.mu.Lock()
	fx.ctrl.channelMaking["making"] = true
	fx.ctrl.mu.Unlock()

	_, err := fx.createSessionAs(fx.page(2), "plugin", sdkexecOptions("making"))
	guarded(t, "channel-id-held", func() {
		requireIDInUse(t, err)
		require.Zero(t, plugin.callCount("create"), "the plugin was not asked")
	})
	_, err = fx.wrapper.CreateTerminal(context.Background(),
		execsdk.SessionOptions{ID: "making", Command: append(shell(t), "-c", "sleep 600")}, terminal.Launch{Channel: true})
	guarded(t, "channel-id-held", func() { requireIDInUse(t, err) })
}

func sdkexecOptions(id string) execsdk.SessionOptions {
	return execsdk.SessionOptions{ID: id, Command: []string{"plain"}} //nolint:exhaustruct // The test names what it needs.
}

func sdkexecOptionsHeld(id, tag string) execsdk.SessionOptions {
	return execsdk.SessionOptions{ID: id, Command: []string{tag}} //nolint:exhaustruct // The test names what it needs.
}

// A. The plugin session that the host refused (a channel terminal holds its id) still exists in the plugin until the host's close
// reaches it, and it can speak for that time. The host routes a frame by its session id, and an id that a channel terminal holds
// is held by another session as much as an id the index records for a terminal of a window: the frame is dropped. Output and
// signals under that id reach no window, and the plugin's CLOSE neither ends anything nor tells a window that something closed.
func TestAPluginFrameUnderTheIDOfAChannelTerminalIsDropped(t *testing.T) {
	fx := newTerminalFixture(t)
	plugin := newAKeepingPlugin()
	fx.install("plugin", plugin)
	info := fx.openChannelWithID("held-by-a-channel-terminal")

	frameFrom(t, fx.ctrl, "plugin", aStdoutFrame(info.ID, "output of a session the host refused"))
	guarded(t, "channel-id-frames-dropped", func() {
		require.Empty(t, fx.eventsOf(info.ID), "nothing of a plugin goes out under the id of a channel terminal")
	})
	fx.requireTheChannelTerminalIsUntouched(info)
}

func TestAPluginsCloseUnderTheIDOfAChannelTerminalNeitherEndsItNorReachesAWindow(t *testing.T) {
	fx := newTerminalFixture(t)
	plugin := newAKeepingPlugin()
	fx.install("plugin", plugin)
	info := fx.openChannelWithID("held-by-a-channel-terminal")

	frameFrom(t, fx.ctrl, "plugin", aCloseSignal(info.ID))
	guarded(t, "channel-id-frames-dropped", func() {
		require.Empty(t, fx.eventsOf(info.ID), "no window is told that a session with the id of a channel terminal closed")
		require.False(t, fx.ctrl.sessionClosed(info.ID, "plugin"), "the decision is taken with the record, in one step: the id is not that plugin's")
	})
	fx.requireTheChannelTerminalIsUntouched(info)
}
