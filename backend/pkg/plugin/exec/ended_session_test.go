package exec

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// plugin-sdk v0.22.1 keeps the output of an exec session that ends by itself while nobody is attached
// (a command that prints and exits at once: echo hi, a failed kubectl exec), for the first AttachSession
// to it (at most 32 sessions, a minute). The window attaches after it has created the session, so for a
// short command the attach comes after the session has ended and said CLOSE, and the host used to forget
// the session at CLOSE: its own AttachSession answered "not found" before it asked the plugin.
//
// The host keeps the record of such a session, marked ended, until its first attach, its close, a detach,
// the unload of its plugin or 90 seconds after the CLOSE, and never more than 32. These tests drive a
// provider that keeps what the SDK's manager keeps, and the controller's own CLOSE branch.

// aKeepingPlugin is the exec provider of a plugin built on SDK v0.22.1 as far as the host can tell: a live
// session keeps what it wrote; when it ends by itself while nobody is attached it leaves that output for
// the first attach; a session the host closed, or one that was attached when it ended, leaves nothing.
type aKeepingPlugin struct {
	Provider // the methods a test does not use are nil

	mu    sync.Mutex
	live  map[string]*aLiveSession
	kept  map[string][]byte
	calls map[string]int

	// keepsNothing makes it a plugin built on an SDK that predates the retention (every v0.22.0 or older).
	keepsNothing bool
	// notFound is the answer for a session it does not know: the SDK's own error, as a provider in this
	// process returns it, unless a test says it comes over gRPC.
	notFound func(id string) error
	// closeAnswer is what CloseSession answers for a session that is live (nil: it closes it).
	closeAnswer error
}

type aLiveSession struct {
	attached, requested bool
	output              []byte
}

func newAKeepingPlugin() *aKeepingPlugin {
	return &aKeepingPlugin{
		Provider: nil, mu: sync.Mutex{}, live: make(map[string]*aLiveSession), kept: make(map[string][]byte),
		calls: make(map[string]int), keepsNothing: false, notFound: nil, closeAnswer: nil,
	}
}

func (*aKeepingPlugin) GetSupportedResources(*sdktypes.PluginContext) []sdkexec.Handler { return nil }
func (*aKeepingPlugin) Close()                                                          {}

func (p *aKeepingPlugin) CreateSession(_ *sdktypes.PluginContext, opts sdkexec.SessionOptions) (*sdkexec.Session, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls["create"]++
	p.live[opts.ID] = &aLiveSession{attached: false, requested: false, output: nil}

	return &sdkexec.Session{ID: opts.ID}, nil
}

func (p *aKeepingPlugin) AttachSession(_ *sdktypes.PluginContext, id string) (*sdkexec.Session, []byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls["attach"]++
	if live, ok := p.live[id]; ok {
		live.attached = true

		return &sdkexec.Session{ID: id, Attached: true}, slices.Clone(live.output), nil
	}
	if output, ok := p.kept[id]; ok {
		delete(p.kept, id)

		return &sdkexec.Session{ID: id, Attached: true}, output, nil
	}

	return nil, nil, p.notFoundFor(id)
}

func (p *aKeepingPlugin) DetachSession(_ *sdktypes.PluginContext, id string) (*sdkexec.Session, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls["detach"]++
	live, ok := p.live[id]
	if !ok {
		return nil, p.notFoundFor(id)
	}
	live.attached = false

	return &sdkexec.Session{ID: id}, nil
}

func (p *aKeepingPlugin) CloseSession(_ *sdktypes.PluginContext, id string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls["close"]++
	live, ok := p.live[id]
	if !ok {
		return p.notFoundFor(id)
	}
	live.requested = true // the host asked for the end: nothing is kept for an attach
	delete(p.live, id)

	return p.closeAnswer
}

func (p *aKeepingPlugin) notFoundFor(id string) error {
	if p.notFound != nil {
		return p.notFound(id)
	}

	return sdkexec.NewSessionNotFoundError(id)
}

// write is what the command behind the session printed.
func (p *aKeepingPlugin) write(id, text string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.live[id].output = append(p.live[id].output, text...)
}

// end is the end of the session by itself: it leaves the manager and, if nobody was attached, leaves its
// output. It returns the CLOSE signal the session then sends, the last thing it says.
func (p *aKeepingPlugin) end(id string) sdkexec.StreamOutput {
	p.mu.Lock()
	defer p.mu.Unlock()
	if live, ok := p.live[id]; ok {
		delete(p.live, id)
		if !live.attached && !live.requested && !p.keepsNothing {
			p.kept[id] = live.output
		}
	}

	return aCloseSignal(id)
}

func aCloseSignal(id string) sdkexec.StreamOutput {
	return sdkexec.StreamOutput{
		SessionID: id, Target: sdkexec.StreamTargetStdOut, Data: []byte("\nSession closed\n"), Signal: sdkexec.StreamSignalClose,
	}
}

func (p *aKeepingPlugin) callCount(name string) int {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.calls[name]
}

// aFakeClock is the controller's time in a test.
type aFakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *aFakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.now
}

func (c *aFakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// aWindow is what the controller emits to the windows, by name.
type aWindow struct {
	mu     sync.Mutex
	events []string
}

func (w *aWindow) Emit(name string, _ ...any) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.events = append(w.events, name)

	return false
}

func (w *aWindow) told(name string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()

	return slices.Contains(w.events, name)
}

type anEndedSessionFixture struct {
	t      *testing.T
	ctrl   *controller
	clock  *aFakeClock
	plugin *aKeepingPlugin
	window *aWindow
}

const (
	endedFixturePlugin     = "keeping-plugin"
	endedFixtureConnection = "connection"
)

func newEndedSessionFixture(t *testing.T) *anEndedSessionFixture {
	t.Helper()
	ctrl, ok := NewController(logging.NewNop(), nil, aConnectionTheHostHolds{}).(*controller)
	require.True(t, ok, "NewController returns the controller")
	ctrl.ctx = context.Background()
	clock := &aFakeClock{mu: sync.Mutex{}, now: time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)}
	ctrl.now = clock.Now
	window := &aWindow{mu: sync.Mutex{}, events: nil}
	ctrl.events = window
	fixture := &anEndedSessionFixture{t: t, ctrl: ctrl, clock: clock, plugin: newAKeepingPlugin(), window: window}
	fixture.install(endedFixturePlugin, fixture.plugin)

	return fixture
}

// install puts a plugin's provider where OnPluginStart would.
func (f *anEndedSessionFixture) install(pluginID string, provider Provider) {
	f.t.Helper()
	f.ctrl.OnPluginInit(pluginID, config.PluginMeta{})
	f.ctrl.mu.Lock()
	f.ctrl.clients[pluginID] = provider
	f.ctrl.inChans[pluginID] = make(chan sdkexec.StreamInput, 8) // what a window writes to a session goes to the plugin by it
	f.ctrl.mu.Unlock()
}

// start creates a session through the controller, as a window does.
func (f *anEndedSessionFixture) start(id string) {
	f.t.Helper()
	f.startOn(endedFixturePlugin, id)
}

func (f *anEndedSessionFixture) startOn(pluginID, id string) {
	f.t.Helper()
	session, err := f.ctrl.CreateSession(context.Background(), pluginID, endedFixtureConnection, sdkexec.SessionOptions{ID: id})
	require.NoError(f.t, err)
	require.Equal(f.t, id, session.ID)
}

// endByItself is a session that ends while the window is away: the plugin ends it and its CLOSE reaches
// the host's dispatch.
func (f *anEndedSessionFixture) endByItself(id string) {
	f.t.Helper()
	f.ctrl.dispatchOutput(f.plugin.end(id))
	require.True(f.t, f.window.told("core/exec/signal/CLOSE/"+id), "the windows are told the session closed")
}

// indexed is the IDs of the sessions the controller holds a record of.
func (f *anEndedSessionFixture) indexed() []string {
	f.ctrl.mu.RLock()
	defer f.ctrl.mu.RUnlock()
	ids := make([]string, 0, len(f.ctrl.sessionIndex))
	for id := range f.ctrl.sessionIndex {
		ids = append(ids, id)
	}
	slices.Sort(ids)

	return ids
}

func requireSessionNotFound(t *testing.T, err error, id string) {
	t.Helper()
	var app *apperror.AppError
	require.ErrorAs(t, err, &app, "the host says the session is not found in its own words")
	require.Equal(t, apperror.TypeSessionNotFound, app.Type)
	require.Contains(t, app.Detail, id)
}

// (a) A session that ended with nobody attached: the first attach gets its output, the second finds nothing,
// and the controller holds nothing.
func TestTheOutputOfASessionThatEndedUnattachedReachesTheFirstAttachOnly(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.start("short")
	fx.plugin.write("short", "hi\n")
	fx.endByItself("short")
	require.Equal(t, []string{"short"}, fx.indexed(), "the controller keeps what the plugin keeps: the session's record")

	session, output, err := fx.ctrl.AttachSession("short")
	require.NoError(t, err)
	require.Equal(t, "short", session.ID)
	require.Equal(t, "hi\n", string(output))
	require.Empty(t, fx.indexed(), "the first attach used the record up")

	_, _, err = fx.ctrl.AttachSession("short")
	requireSessionNotFound(t, err, "short")
	require.Equal(t, 1, fx.plugin.callCount("attach"), "the second attach did not trouble the plugin")
}

// (b) A session that was attached when it ended is over for everyone: its record goes at CLOSE, as it did.
func TestASessionThatEndedWhileAttachedLeavesNoRecord(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.start("attached")
	_, _, err := fx.ctrl.AttachSession("attached")
	require.NoError(t, err)
	fx.plugin.write("attached", "seen live\n")
	fx.endByItself("attached")
	require.Empty(t, fx.indexed())

	_, _, err = fx.ctrl.AttachSession("attached")
	requireSessionNotFound(t, err, "attached")
	require.Equal(t, 1, fx.plugin.callCount("attach"), "only the live attach reached the plugin")
}

// A window that attached and detached before the session ended is a window that is away: the plugin keeps the
// output for the next attach (the tab that is shown again), and so does the host.
func TestASessionThatEndedAfterItsWindowDetachedKeepsItsRecord(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.start("away")
	_, _, err := fx.ctrl.AttachSession("away")
	require.NoError(t, err)
	_, err = fx.ctrl.DetachSession("away")
	require.NoError(t, err)
	fx.plugin.write("away", "while away\n")
	fx.endByItself("away")

	_, output, err := fx.ctrl.AttachSession("away")
	require.NoError(t, err)
	require.Equal(t, "while away\n", string(output))
	require.Empty(t, fx.indexed())
}

// (c) The record of an ended session expires 90 seconds after its CLOSE, checked when it is looked up and
// when another is made, with no timer.
func TestTheRecordOfAnEndedSessionExpiresNinetySecondsAfterItsClose(t *testing.T) {
	fx := newEndedSessionFixture(t)
	for _, id := range []string{"early", "late", "swept"} {
		fx.start(id)
		fx.plugin.write(id, id)
		fx.endByItself(id)
	}

	fx.clock.Advance(89 * time.Second)
	_, output, err := fx.ctrl.AttachSession("early")
	require.NoError(t, err, "89 seconds after the close the record is still there")
	require.Equal(t, "early", string(output))

	fx.clock.Advance(2 * time.Second) // 91 seconds
	_, _, err = fx.ctrl.AttachSession("late")
	requireSessionNotFound(t, err, "late")
	require.Equal(t, 1, fx.plugin.callCount("attach"), "an expired record does not send the attach to the plugin")
	require.Equal(t, []string{"swept"}, fx.indexed(), "the lookup removed the record it found expired, and only that one")

	fx.start("fresh")
	fx.endByItself("fresh")
	require.Equal(t, []string{"fresh"}, fx.indexed(), "the next session to end swept the record that expired")
}

// (c) At most 32 ended sessions are kept, as the SDK keeps at most 32 outputs; the 33rd evicts the oldest.
func TestTheThirtyThirdEndedSessionEvictsTheOldest(t *testing.T) {
	fx := newEndedSessionFixture(t)
	ids := make([]string, 0, endedSessionLimit+1)
	for i := range endedSessionLimit + 1 {
		id := fmt.Sprintf("ended-%02d", i)
		ids = append(ids, id)
		fx.start(id)
		fx.plugin.write(id, id)
		fx.endByItself(id)
		fx.clock.Advance(time.Second) // 33 seconds in all: nothing expires
	}
	require.Len(t, fx.indexed(), endedSessionLimit)
	require.NotContains(t, fx.indexed(), ids[0], "the oldest was evicted")

	_, _, err := fx.ctrl.AttachSession(ids[0])
	requireSessionNotFound(t, err, ids[0])
	require.Zero(t, fx.plugin.callCount("attach"), "an evicted record does not send the attach to the plugin")
	_, output, err := fx.ctrl.AttachSession(ids[1])
	require.NoError(t, err)
	require.Equal(t, ids[1], string(output))
}

// A session that is live does not count against the limit and is never evicted by it.
func TestLiveSessionsAreNotEvictedByEndedOnes(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.start("live")
	for i := range 2 * endedSessionLimit {
		id := fmt.Sprintf("ended-%02d", i)
		fx.start(id)
		fx.endByItself(id)
	}
	require.Len(t, fx.indexed(), endedSessionLimit+1)
	require.Contains(t, fx.indexed(), "live")
}

// (d) Unloading a plugin forgets its sessions, ended or live, and only its own.
func TestUnloadingAPluginClearsItsEndedSessions(t *testing.T) {
	fx := newEndedSessionFixture(t)
	other := newAKeepingPlugin()
	fx.install("other-plugin", other)
	fx.start("ended-here")
	fx.endByItself("ended-here")
	fx.start("live-here")
	fx.startOn("other-plugin", "ended-there")
	other.mu.Lock()
	other.live["ended-there"].output = []byte("there")
	other.mu.Unlock()
	fx.ctrl.dispatchOutput(other.end("ended-there"))
	require.ElementsMatch(t, []string{"ended-here", "live-here", "ended-there"}, fx.indexed())

	require.NoError(t, fx.ctrl.OnPluginStop(endedFixturePlugin, config.PluginMeta{}))
	require.Equal(t, []string{"ended-there"}, fx.indexed())
	_, output, err := fx.ctrl.AttachSession("ended-there")
	require.NoError(t, err)
	require.Equal(t, "there", string(output))
}

// (e) An attach that races the CLOSE of its session gets the output, or finds nothing, and the controller
// never keeps a record for it: run it under -race.
func TestAnAttachRacingTheCloseOfASessionGetsItsOutputAndLeavesNoRecord(t *testing.T) {
	fx := newEndedSessionFixture(t)
	for i := range 300 {
		id := fmt.Sprintf("race-%03d", i)
		fx.start(id)
		fx.plugin.write(id, "hi\n")
		var (
			wg        sync.WaitGroup
			output    []byte
			attachErr error
		)
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, output, attachErr = fx.ctrl.AttachSession(id)
		}()
		go func() {
			defer wg.Done()
			fx.endByItself(id)
		}()
		wg.Wait()
		if attachErr == nil {
			require.Equal(t, "hi\n", string(output), "an attach that succeeded has the output, live or kept (%s)", id)
		} else {
			requireSessionNotFound(t, attachErr, id)
		}
		require.Empty(t, fx.indexed(), "a record was left behind (%s)", id)
	}
}

// An ended session is over: a window cannot write to it, resize it or read it, as it could not after its CLOSE
// before; only the attach that asks for its output, a close and a detach find its record.
func TestAnEndedSessionTakesNoInput(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.start("live")
	fx.start("over")
	fx.endByItself("over")
	input := fx.ctrl.inChans[endedFixturePlugin]

	require.NoError(t, fx.ctrl.WriteSession("live", []byte("ls\n")), "a live session takes input")
	require.Len(t, input, 1)
	requireSessionNotFound(t, fx.ctrl.WriteSession("over", []byte("ls\n")), "over")
	require.Len(t, input, 1, "nothing was sent to the plugin for the ended session")
	requireSessionNotFound(t, fx.ctrl.ResizeSession("over", 24, 80), "over")
	_, err := fx.ctrl.GetSession("over")
	requireSessionNotFound(t, err, "over")
	require.Equal(t, []string{"live", "over"}, fx.indexed(), "none of them touched the records")
}

// Closing a session whose window never attached: it has ended and there is nothing to close. The record
// goes, and the plugin is not asked.
func TestClosingAnEndedSessionIsClosedAlready(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.start("over")
	fx.endByItself("over")

	require.NoError(t, fx.ctrl.CloseSession("over"))
	require.Empty(t, fx.indexed())
	require.Zero(t, fx.plugin.callCount("close"))
	requireSessionNotFound(t, fx.ctrl.CloseSession("over"), "over") // unknown now: as for any session the host does not know
}

// A detach of an ended session finds nothing, as before, and the record goes.
func TestDetachingAnEndedSessionFindsNothingAndForgetsIt(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.start("over")
	fx.endByItself("over")

	_, err := fx.ctrl.DetachSession("over")
	requireSessionNotFound(t, err, "over")
	require.Empty(t, fx.indexed())
	require.Zero(t, fx.plugin.callCount("detach"))
}

// SDK v0.22.1: CloseSession of a session that has ended by itself, in the instant before the host's CLOSE
// has come, answers not-found. The session is closed: that is no error, and the window shows none.
func TestClosingASessionThatJustEndedIsNotAnError(t *testing.T) {
	for _, form := range []struct {
		name     string
		notFound func(string) error
	}{
		{"as a provider in the host's process returns it", nil},
		{"as a plugin's gRPC server sends it", func(id string) error {
			return status.Errorf(codes.NotFound, "[SESSION_NOT_FOUND] session %s: session not found", id)
		}},
	} {
		t.Run(form.name, func(t *testing.T) {
			fx := newEndedSessionFixture(t)
			fx.plugin.notFound = form.notFound
			fx.start("just-ended")
			fx.plugin.end("just-ended") // the session has left the plugin; its CLOSE is still on its way

			require.NoError(t, fx.ctrl.CloseSession("just-ended"))
			require.Empty(t, fx.indexed())
			fx.ctrl.dispatchOutput(aCloseSignal("just-ended")) // and then it arrives
			require.Empty(t, fx.indexed(), "the late CLOSE of a session that was closed made no record")
		})
	}
}

// Only not-found means closed: any other answer is the plugin's, and the session is not forgotten.
func TestAFailedCloseIsStillAnError(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.start("stuck")
	fx.plugin.closeAnswer = errors.New("CloseSession timed out waiting for session stuck goroutines")

	require.ErrorContains(t, fx.ctrl.CloseSession("stuck"), "timed out")
	require.Equal(t, []string{"stuck"}, fx.indexed())
}

// The SDK keeps nothing of a session the host asked to close, and the host keeps no record of it: a close that
// timed out still ends the session, and its CLOSE is its end.
func TestASessionTheHostClosedLeavesNoRecordWhenItsCloseComes(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.start("closed")
	fx.plugin.closeAnswer = errors.New("CloseSession timed out waiting for session closed goroutines")
	require.Error(t, fx.ctrl.CloseSession("closed"))

	fx.ctrl.dispatchOutput(aCloseSignal("closed"))
	require.Empty(t, fx.indexed())
}

// A plugin built on an SDK that keeps nothing (every release before v0.22.1; the Kubernetes plugin is on
// one until it is rebuilt) says not-found to the attach: the window gets the host's own not-found, as it
// did when the host forgot the session at CLOSE, and the record goes at once.
func TestAnAttachToAPluginThatKeptNothingFindsNothing(t *testing.T) {
	fx := newEndedSessionFixture(t)
	fx.plugin.keepsNothing = true
	fx.start("old")
	fx.plugin.write("old", "lost")
	fx.endByItself("old")

	_, _, err := fx.ctrl.AttachSession("old")
	requireSessionNotFound(t, err, "old")
	require.Equal(t, 1, fx.plugin.callCount("attach"))
	require.Empty(t, fx.indexed())
}

// A call about a session the plugin no longer has (it ended while a window was attached, and its CLOSE has not
// reached the host yet) gets the plugin's answer, and the host stops keeping a record of a session there is
// nothing to attach to.
func TestACallAboutASessionThePluginNoLongerHasForgetsItsRecord(t *testing.T) {
	for _, call := range []struct {
		name string
		do   func(*controller, string) error
	}{
		{"attach", func(c *controller, id string) error { _, _, err := c.AttachSession(id); return err }},
		{"detach", func(c *controller, id string) error { _, err := c.DetachSession(id); return err }},
	} {
		t.Run(call.name, func(t *testing.T) {
			fx := newEndedSessionFixture(t)
			fx.start("gone")
			_, _, err := fx.ctrl.AttachSession("gone")
			require.NoError(t, err)
			fx.plugin.end("gone") // attached when it ended: nothing is kept; its CLOSE is still on its way

			err = call.do(fx.ctrl, "gone")
			require.ErrorIs(t, err, sdkexec.ErrSessionNotFound, "the plugin's own answer")
			require.Empty(t, fx.indexed())
			fx.ctrl.dispatchOutput(aCloseSignal("gone")) // and then it arrives
			require.Empty(t, fx.indexed())
		})
	}
}
