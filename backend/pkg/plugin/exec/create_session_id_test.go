package exec

import (
	"context"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// B-113: the host keeps one record for each session id, and the page chooses the id of a session it creates
// (it listens first). CreateSession wrote the record of the session the plugin answered over the record of an
// id that was already in use, so the session that had the id (a terminal of this host, a session of another
// plugin) lost its route to the next session that used it, and the host deleted that record when the other
// session ended. CreateTerminal has always refused an id that is in the index; these tests are the other way.

const createIDBound = 10 * time.Second

// aPluginThatHoldsItsAnswer makes a session and then waits, so that a test decides what happens between a plugin
// having made a session and the host having recorded it. Each call is told apart by the first word of its command
// and answers when the test says so.
type aPluginThatHoldsItsAnswer struct {
	*aKeepingPlugin

	made  chan string // the tag of a call whose session exists in the plugin and whose answer is held
	mu    sync.Mutex
	gates map[string]chan struct{}
}

func newAPluginThatHoldsItsAnswer() *aPluginThatHoldsItsAnswer {
	return &aPluginThatHoldsItsAnswer{
		aKeepingPlugin: newAKeepingPlugin(), made: make(chan string, 4), mu: sync.Mutex{}, gates: make(map[string]chan struct{}),
	}
}

func (p *aPluginThatHoldsItsAnswer) gate(tag string) chan struct{} {
	p.mu.Lock()
	defer p.mu.Unlock()
	gate, ok := p.gates[tag]
	if !ok {
		gate = make(chan struct{})
		p.gates[tag] = gate
	}

	return gate
}

func (p *aPluginThatHoldsItsAnswer) CreateSession(ctx *sdktypes.PluginContext, opts sdkexec.SessionOptions) (*sdkexec.Session, error) {
	session, err := p.aKeepingPlugin.CreateSession(ctx, opts)
	tag := opts.Command[0]
	p.made <- tag
	<-p.gate(tag)

	return session, err
}

// answer lets the call with this tag return what the plugin made.
func (p *aPluginThatHoldsItsAnswer) answer(tag string) { close(p.gate(tag)) }

// madeBy waits for the calls with these tags to have made their session in the plugin.
func (p *aPluginThatHoldsItsAnswer) madeBy(t *testing.T, tags ...string) {
	t.Helper()
	var got []string
	for range tags {
		select {
		case tag := <-p.made:
			got = append(got, tag)
		case <-time.After(createIDBound):
			t.Fatalf("the plugin made %v of the sessions %v", got, tags)
		}
	}
	slices.Sort(got)
	want := slices.Clone(tags)
	slices.Sort(want)
	require.Equal(t, want, got)
}

type aCreateResult struct {
	session *sdkexec.Session
	err     error
}

// createInTheBackground is a window's CreateSession of id on the plugin, with a tag the plugin tells it by.
func (f *anEndedSessionFixture) createInTheBackground(pluginID, id, tag string) <-chan aCreateResult {
	done := make(chan aCreateResult, 1)
	go func() {
		session, err := f.ctrl.CreateSession(context.Background(), pluginID, endedFixtureConnection,
			sdkexec.SessionOptions{ID: id, Command: []string{tag}})
		done <- aCreateResult{session: session, err: err}
	}()

	return done
}

func (f *anEndedSessionFixture) resultOf(results <-chan aCreateResult) aCreateResult {
	f.t.Helper()
	select {
	case result := <-results:
		return result
	case <-time.After(createIDBound):
		f.t.Fatal("CreateSession did not answer")
	}

	return aCreateResult{session: nil, err: nil}
}

// recordOf is the record the host holds for the id, and whether it holds one.
func (f *anEndedSessionFixture) recordOf(id string) (sessionIndex, bool) {
	f.ctrl.mu.RLock()
	defer f.ctrl.mu.RUnlock()
	record, found := f.ctrl.sessionIndex[id]

	return record, found
}

// frameFrom is what plugin pluginID's stream delivers to the host's dispatch: a frame of a session, as the plugin
// names it.
func frameFrom(t *testing.T, ctrl *controller, pluginID string, output sdkexec.StreamOutput) {
	t.Helper()
	ctrl.mu.Lock()
	if ctrl.streams == nil {
		ctrl.streams = make(map[string]execProviderStream)
	}
	stream, ok := ctrl.streams[pluginID]
	if !ok {
		stream = execProviderStream{ctx: context.Background(), cancel: func() {}, done: make(chan struct{})}
		ctrl.streams[pluginID] = stream
	}
	ctrl.mu.Unlock()
	ctrl.dispatchProviderOutput(execProviderOutput{StreamOutput: output, pluginID: pluginID, done: stream.done})
}

func (f *anEndedSessionFixture) frame(pluginID string, output sdkexec.StreamOutput) {
	f.t.Helper()
	frameFrom(f.t, f.ctrl, pluginID, output)
}

func aStdoutFrame(id, text string) sdkexec.StreamOutput {
	return sdkexec.StreamOutput{SessionID: id, Target: sdkexec.StreamTargetStdOut, Data: []byte(text)}
}

func requireIDInUse(t *testing.T, err error) {
	t.Helper()
	require.ErrorIs(t, err, terminal.ErrIDInUse, "the refusal is the one CreateTerminal gives for an id in use")
	var typed *apperror.AppError
	require.ErrorAs(t, err, &typed)
	require.Equal(t, "ALREADY_EXISTS", typed.Code)
	require.Equal(t, http.StatusConflict, typed.Status)
}

// A session of one plugin keeps its id: another plugin that is asked to make a session with it is refused in the
// typed words, and is never asked, so no process starts for a request that is refused.
func TestCreateSessionRefusesAnIDThatASessionOfAnotherPluginHasWithoutAskingThePlugin(t *testing.T) {
	f := newEndedSessionFixture(t)
	second := newAKeepingPlugin()
	f.install("second", second)
	f.startOn(endedFixturePlugin, "shared")

	_, err := f.ctrl.CreateSession(context.Background(), "second", endedFixtureConnection, sdkexec.SessionOptions{ID: "shared"})
	requireIDInUse(t, err)
	require.Zero(t, second.callCount("create"), "the plugin was not asked to make a session that the host would refuse")

	record, found := f.recordOf("shared")
	require.True(t, found)
	require.Equal(t, endedFixturePlugin, record.pluginID, "the record still routes to the session that had the id")

	// The route still works: the session that had the id is attached through its own plugin.
	_, _, err = f.ctrl.AttachSession("shared")
	require.NoError(t, err)
	require.Equal(t, 1, f.plugin.callCount("attach"))
	require.Zero(t, second.callCount("attach"))
}

// The same plugin is refused too: its answer is for the session that has the id.
func TestCreateSessionRefusesAnIDThatASessionOfTheSamePluginHasWithoutAskingThePlugin(t *testing.T) {
	f := newEndedSessionFixture(t)
	f.startOn(endedFixturePlugin, "shared")

	_, err := f.ctrl.CreateSession(context.Background(), endedFixturePlugin, endedFixtureConnection, sdkexec.SessionOptions{ID: "shared"})
	requireIDInUse(t, err)
	require.Equal(t, 1, f.plugin.callCount("create"))
	require.Zero(t, f.plugin.callCount("close"), "a refusal ends no session")
}

// Two creates of one id reach two plugins before either answer is recorded: a window that learned an id from the
// events asks a plugin to make a session with it while its owner's own create is on its way. The order the answers
// come back in is forced, and in both orders the first one recorded keeps the id; the other is refused and its
// session is closed with the plugin that made it, never with the one that has the id.
func TestCreateSessionRefusesAnIDThatAnotherPluginTookWhileThisOneAnswered(t *testing.T) {
	for _, order := range [][2]string{{"first", "second"}, {"second", "first"}} {
		winner, loser := order[0], order[1]
		t.Run(winner+" answers first", func(t *testing.T) {
			f := newEndedSessionFixture(t)
			plugins := map[string]*aPluginThatHoldsItsAnswer{"first": newAPluginThatHoldsItsAnswer(), "second": newAPluginThatHoldsItsAnswer()}
			results := map[string]<-chan aCreateResult{}
			for id, plugin := range plugins {
				f.install(id, plugin)
				results[id] = f.createInTheBackground(id, "shared", id)
			}
			// Both plugins made a session with the id, and the host has recorded neither.
			for tag, plugin := range plugins {
				plugin.madeBy(t, tag)
			}

			plugins[winner].answer(winner)
			won := f.resultOf(results[winner])
			require.NoError(t, won.err)
			require.Equal(t, "shared", won.session.ID)

			plugins[loser].answer(loser)
			lost := f.resultOf(results[loser])
			requireIDInUse(t, lost.err)
			require.Nil(t, lost.session)

			require.Equal(t, 1, plugins[loser].callCount("close"), "the session the host refused is closed, with the plugin that made it")
			require.Zero(t, plugins[winner].callCount("close"), "the session that has the id is not touched")
			record, found := f.recordOf("shared")
			require.True(t, found)
			require.Equal(t, winner, record.pluginID)
			require.False(t, record.closing, "the record of the session that has the id was not marked by the refusal")

			// The loser's session says CLOSE as it ends: that is not the end of the session that has the id.
			f.frame(loser, aCloseSignal("shared"))
			require.False(t, f.window.told("core/exec/signal/CLOSE/shared"), "the other session's CLOSE is not told as the end of this one")
			record, found = f.recordOf("shared")
			require.True(t, found)
			require.False(t, record.ended)
			require.Equal(t, winner, record.pluginID)
			// The session that has the id is heard.
			f.frame(winner, aCloseSignal("shared"))
			require.True(t, f.window.told("core/exec/signal/CLOSE/shared"))
		})
	}
}

// A plugin that does not refuse a duplicate id (the SDK's does; a plugin that is not built on it may not) holds ONE
// session under the id, so closing "the one that was refused" by its id ends the session that has the id. The
// refusal must not close it.
func TestTheRefusalOfADuplicateIDNeverClosesTheSessionThePluginHoldsUnderThatID(t *testing.T) {
	f := newEndedSessionFixture(t)
	plugin := newAPluginThatHoldsItsAnswer()
	f.install("holding", plugin)
	first := f.createInTheBackground("holding", "shared", "first")
	second := f.createInTheBackground("holding", "shared", "second")
	plugin.madeBy(t, "first", "second")

	plugin.answer("first")
	require.NoError(t, f.resultOf(first).err)
	plugin.answer("second")
	requireIDInUse(t, f.resultOf(second).err)

	require.Zero(t, plugin.callCount("close"), "the plugin holds one session for the id, and it is the recorded one's")
	plugin.mu.Lock()
	_, held := plugin.live["shared"]
	plugin.mu.Unlock()
	require.True(t, held)
	record, found := f.recordOf("shared")
	require.True(t, found)
	require.Equal(t, "holding", record.pluginID)
}

// The host dispatches a frame to the windows by the id it names. A plugin speaks for the sessions it made: a frame
// of a plugin whose id the host recorded for a terminal of its own, or for a session of another plugin, is not
// delivered and does not end that session's record.
func TestAFrameOfAPluginThatNamesTheIDOfAnotherSessionIsNotDelivered(t *testing.T) {
	f := newEndedSessionFixture(t)
	f.install("second", newAKeepingPlugin())
	f.startOn(endedFixturePlugin, "plugin-session")
	f.ctrl.mu.Lock()
	f.ctrl.sessionIndex["terminal"] = sessionIndex{pluginID: "", connectionID: "", local: true}
	f.ctrl.mu.Unlock()

	for _, id := range []string{"plugin-session", "terminal"} {
		f.frame("second", aStdoutFrame(id, "spoofed"))
		f.frame("second", aCloseSignal(id))
		require.False(t, f.window.told("core/exec/stream/stdout/"+id), "output of a plugin that does not hold %s", id)
		require.False(t, f.window.told("core/exec/signal/CLOSE/"+id), "the end of a session that is not this plugin's")
		record, found := f.recordOf(id)
		require.True(t, found, "the record of %s is still there", id)
		require.False(t, record.ended)
	}

	// The control: the plugin that holds the session is delivered, and a session nobody recorded is delivered as before.
	f.frame(endedFixturePlugin, aStdoutFrame("plugin-session", "hello"))
	require.True(t, f.window.told("core/exec/stream/stdout/plugin-session"))
	f.frame("second", aStdoutFrame("not-recorded-yet", "early"))
	require.True(t, f.window.told("core/exec/stream/stdout/not-recorded-yet"), "output that comes before the host has recorded its session is delivered")
	f.frame(endedFixturePlugin, aCloseSignal("plugin-session"))
	require.True(t, f.window.told("core/exec/signal/CLOSE/plugin-session"))
}
