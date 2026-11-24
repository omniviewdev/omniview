//go:build !windows

package exec

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostresource "github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// THE RACES OF OWNERSHIP (T2c-go.md, CodeRabbit on #677). Each is a place where a window's right to a session is
// read in one step and used in another, and a retirement, a claim or an end falls between. Every test below forces
// the two orders by hand: a call is held at the one point where the other must land, so no outcome is decided by
// timing, and each states what must hold at the end whichever order it was.

// aGate holds the first call that reaches it, in the middle of the call, until the test lets it go: the call says
// it is in (entered) and waits for release to be closed. Later calls pass.
type aGate struct {
	entered chan struct{}
	release chan struct{}
	used    atomic.Bool
}

func newGate() *aGate { return &aGate{entered: make(chan struct{}, 1), release: make(chan struct{})} }

func (g *aGate) hold() {
	if g == nil || !g.used.CompareAndSwap(false, true) {
		return
	}
	g.entered <- struct{}{}
	<-g.release
}

// aHeldPlugin is the plugin of aKeepingPlugin with two calls a test can hold in the middle: the one that makes a
// session and the one that ends it. A close can also fail the way a plugin that cannot be reached does, leaving the
// session where it was.
type aHeldPlugin struct {
	*aKeepingPlugin
	createGate *aGate
	closeGate  *aGate
	closeFails error
}

func (p *aHeldPlugin) CreateSession(ctx *sdktypes.PluginContext, opts execsdk.SessionOptions) (*execsdk.Session, error) {
	p.createGate.hold()
	return p.aKeepingPlugin.CreateSession(ctx, opts)
}

func (p *aHeldPlugin) CloseSession(ctx *sdktypes.PluginContext, id string) error {
	p.closeGate.hold()
	if p.closeFails != nil {
		return p.closeFails
	}
	return p.aKeepingPlugin.CloseSession(ctx, id)
}

// aGatedConnection is the host's record of the connection a session is opened on, and the point between a call's
// check of who may make it and its call of the plugin: every call that reaches the plugin asks for the connection in
// between, and the test holds the first one that does after it armed the gate.
type aGatedConnection struct {
	aConnectionTheHostHolds
	gate atomic.Pointer[aGate]
}

func (c *aGatedConnection) GetConnection(ctx context.Context, plugin, connectionID string) (sdktypes.Connection, error) {
	if gate := c.gate.Load(); gate != nil {
		gate.hold()
	}
	return c.aConnectionTheHostHolds.GetConnection(ctx, plugin, connectionID)
}

var _ hostresource.ConnectionReader = (*aGatedConnection)(nil)

// holdTheNextConnectionLookup arms the gate and says which one it is.
func (c *aGatedConnection) holdTheNextConnectionLookup() *aGate {
	gate := newGate()
	c.gate.Store(gate)
	return gate
}

// anOwnershipRaceFixture is the exec lane with one plugin whose calls can be held, a window realm with native windows
// (a native window retires synchronously, when the test closes it), and the wrapper a window calls.
type anOwnershipRaceFixture struct {
	*anEndedSessionFixture
	plugin  *aHeldPlugin
	conn    *aGatedConnection
	realm   *invocation.WindowRealm
	wrapper *ServiceWrapper
}

func newOwnershipRaceFixture(t *testing.T) *anOwnershipRaceFixture {
	t.Helper()
	base := newEndedSessionFixture(t)
	held := &aHeldPlugin{aKeepingPlugin: base.plugin, createGate: nil, closeGate: nil, closeFails: nil}
	base.install(endedFixturePlugin, held)
	conn := &aGatedConnection{aConnectionTheHostHolds: aConnectionTheHostHolds{}, gate: atomic.Pointer[aGate]{}}
	base.ctrl.resourceClient = conn
	realm := invocation.NewWindowRealm(nil)
	return &anOwnershipRaceFixture{
		anEndedSessionFixture: base, plugin: held, conn: conn, realm: realm, wrapper: &ServiceWrapper{Ctrl: base.ctrl, Realm: realm},
	}
}

func (fx *anOwnershipRaceFixture) window(id uint) *terminalNativeWindow {
	return &terminalNativeWindow{Window: nil, id: id, mu: sync.Mutex{}, onClosed: nil}
}

func (fx *anOwnershipRaceFixture) as(window application.Window) context.Context {
	return context.WithValue(context.Background(), application.WindowKey, window)
}

// created is what a call of CreateSession through the wrapper answered.
type created struct {
	session *execsdk.Session
	err     error
}

// createAsync asks for a session through the wrapper, as the window, and answers on the channel when the call returns.
func (fx *anOwnershipRaceFixture) createAsync(window application.Window, id string) <-chan created {
	fx.t.Helper()
	encoded, err := json.Marshal(execsdk.SessionOptions{ID: id})
	require.NoError(fx.t, err)
	done := make(chan created, 1)
	go func() {
		session, createErr := fx.wrapper.CreateSession(fx.as(window), endedFixturePlugin, endedFixtureConnection, string(encoded))
		done <- created{session: session, err: createErr}
	}()
	return done
}

// closeAsync ends a session through the controller as owner, and answers on the channel when the call returns.
func (fx *anOwnershipRaceFixture) closeAsync(owner terminal.Owner, id string) <-chan error {
	done := make(chan error, 1)
	go func() { done <- fx.ctrl.CloseSession(owner, id) }()
	return done
}

// listedTo is the ids of the sessions the wrapper lists to the window.
func (fx *anOwnershipRaceFixture) listedTo(window application.Window) []string {
	fx.t.Helper()
	sessions, err := fx.wrapper.ListSessions(fx.as(window))
	require.NoError(fx.t, err)
	ids := make([]string, 0, len(sessions))
	for _, session := range sessions {
		ids = append(ids, session.ID)
	}
	return ids
}

// make creates a session of the plugin for owner, through the controller.
func (fx *anOwnershipRaceFixture) make(owner terminal.Owner, id string) {
	fx.t.Helper()
	session, err := fx.ctrl.CreateSession(context.Background(), owner, endedFixturePlugin, endedFixtureConnection, execsdk.SessionOptions{ID: id})
	require.NoError(fx.t, err)
	require.Equal(fx.t, id, session.ID)
}

// 1. THE PUBLICATION OF A SESSION AND THE RETIREMENT OF ITS WINDOW.
//
// A window that retires while the plugin makes its session found nothing to release, and when the plugin answered the
// session was recorded as the retired window's: nobody could list it, claim it or end it, and nobody would ever
// release it. Whichever of the two came first, the session ends up held by no window, and any window takes it. A
// window that stays holds its session from the instant it is visible, and no other window can see it before.

// holdsNothingOf is what a window that retired holds of a session that exists: nothing.
func holdsNothingOf(t *testing.T, fx *anOwnershipRaceFixture, window application.Window, id string) {
	t.Helper()
	requireSessionNotFound(t, fx.wrapper.WriteSession(fx.as(window), id, []byte("x")), id)
	requireSessionNotFound(t, fx.wrapper.ResizeSession(fx.as(window), id, 24, 80), id)
}

func TestASessionOfAPluginIsLeftToNoWindowWhenItsWindowRetiresWhileThePluginMakesItAndWhenItRetiresAfter(t *testing.T) {
	for _, order := range []struct {
		name string
		// retireInsideTheCreate retires the window while the plugin makes the session; otherwise it retires after the
		// session was made.
		retireInsideTheCreate bool
	}{
		{"the window retires while the plugin makes the session", true},
		{"the window retires after the session was made", false},
	} {
		t.Run(order.name, func(t *testing.T) {
			fx := newOwnershipRaceFixture(t)
			a, b := fx.window(1), fx.window(2)
			fx.plugin.createGate = newGate()
			made := fx.createAsync(a, "made")
			<-fx.plugin.createGate.entered // the plugin has the call: the session is not recorded yet

			assert.Empty(t, fx.listedTo(b), "a session that is being made is nobody's to see")
			_, _, err := fx.wrapper.AttachSession(fx.as(b), "made")
			requireSessionNotFound(t, err, "made")

			if order.retireInsideTheCreate {
				a.closes() // the retirement runs to its end here, and finds no session of the window to release
			}
			close(fx.plugin.createGate.release)
			answer := <-made
			require.NoError(t, answer.err)
			require.Equal(t, "made", answer.session.ID)
			if !order.retireInsideTheCreate {
				a.closes()
			}

			assert.Equal(t, []string{"made"}, fx.listedTo(b), "no window holds it now: any window lists it")
			holdsNothingOf(t, fx, a, "made")
			_, _, err = fx.wrapper.AttachSession(fx.as(b), "made")
			require.NoError(t, err, "and the window that attaches it first holds it from then on")
			require.NoError(t, fx.wrapper.WriteSession(fx.as(b), "made", []byte("x")))
			c := fx.window(3)
			_, _, err = fx.wrapper.AttachSession(fx.as(c), "made")
			requireSessionNotFound(t, err, "made")
		})
	}
}

// A window that does not retire holds its session as soon as anyone can see it: no other window lists it, attaches it
// or uses it, before the plugin answered and after.
func TestASessionOfAPluginIsHeldByItsWindowFromTheInstantItIsVisible(t *testing.T) {
	fx := newOwnershipRaceFixture(t)
	a, b := fx.window(1), fx.window(2)
	fx.plugin.createGate = newGate()
	made := fx.createAsync(a, "mine")
	<-fx.plugin.createGate.entered

	assert.Empty(t, fx.listedTo(a), "the window that is making it does not list it before the plugin answered")
	assert.Empty(t, fx.listedTo(b))
	close(fx.plugin.createGate.release)
	require.NoError(t, (<-made).err)

	assert.Equal(t, []string{"mine"}, fx.listedTo(a))
	assert.Empty(t, fx.listedTo(b), "another window does not list what a window that is still there holds")
	_, _, err := fx.wrapper.AttachSession(fx.as(b), "mine")
	requireSessionNotFound(t, err, "mine")
	holdsNothingOf(t, fx, b, "mine")
	require.NoError(t, fx.wrapper.WriteSession(fx.as(a), "mine", []byte("x")))
}

// 2. THE CHECK OF WHO MAY END A SESSION AND ITS END.
//
// CloseSession checked the window against a copy of the session's record and acted on it later, with the plugin asked
// in between: a window that took the session meanwhile (an orphan adopted, an offer used) had it ended by a window
// that no longer held it. The check is made again where the end is decided, in one step with the decision, and a
// session whose end is decided is no longer anyone's to take.

// A window that offers its session and loses it to the window that claims it, while its own close is on its way, does
// not end it: the close was authorized for a window that held it, and does not count now.
func TestAWindowThatLostASessionWhileItsCloseWasOnItsWayDoesNotEndIt(t *testing.T) {
	fx := newOwnershipRaceFixture(t)
	fx.make("wA", "moving")
	require.NoError(t, fx.ctrl.OfferSession("wA", "moving"))
	held := fx.conn.holdTheNextConnectionLookup() // the lookup is made between A's check and the plugin's call
	closed := fx.closeAsync("wA", "moving")
	<-held.entered // A's close has passed its check and has not reached the plugin

	_, _, err := fx.ctrl.AttachSession("wB", "moving")
	require.NoError(t, err, "B claims what A offered, while A's close is held")
	close(held.release)

	requireSessionNotFound(t, <-closed, "moving")
	assert.Zero(t, fx.plugin.callCount("close"), "the plugin was never asked to end it")
	require.NoError(t, fx.ctrl.WriteSession("wB", "moving", []byte("x")), "it is B's, and alive")
	requireSessionNotFound(t, fx.ctrl.WriteSession("wA", "moving", []byte("x")), "moving")
}

// The other order: the window that ends its session decided to end it before another window claimed it, so the
// claim is refused, and the session ends, for everyone.
func TestASessionOfAPluginWhoseEndIsDecidedCannotBeClaimedByAnotherWindow(t *testing.T) {
	fx := newOwnershipRaceFixture(t)
	fx.make("wA", "going")
	require.NoError(t, fx.ctrl.OfferSession("wA", "going"))
	fx.plugin.closeGate = newGate() // the plugin holds A's close in the middle: the end is decided, and not yet done
	closed := fx.closeAsync("wA", "going")
	<-fx.plugin.closeGate.entered

	_, _, err := fx.ctrl.AttachSession("wB", "going")
	requireSessionNotFound(t, err, "going")
	close(fx.plugin.closeGate.release)
	require.NoError(t, <-closed)

	assert.Equal(t, 1, fx.plugin.callCount("close"))
	assert.Empty(t, fx.indexed(), "the session is gone for everyone")
	requireSessionNotFound(t, fx.ctrl.WriteSession("wB", "going", []byte("x")), "going")
	requireSessionNotFound(t, fx.ctrl.WriteSession("wA", "going", []byte("x")), "going")
}

// A session that no window holds is anyone's to end, and the same re-check applies: when another window adopts it
// between the first window's check and its end, the first window does not end what the second holds.
func TestAWindowDoesNotEndASessionNoWindowHeldWhenAnotherAdoptedItAfterTheCheck(t *testing.T) {
	fx := newOwnershipRaceFixture(t)
	fx.make(nil, "left-behind")
	held := fx.conn.holdTheNextConnectionLookup()
	closed := fx.closeAsync("wA", "left-behind")
	<-held.entered

	_, _, err := fx.ctrl.AttachSession("wB", "left-behind")
	require.NoError(t, err, "B adopts it while A's close is held")
	close(held.release)

	requireSessionNotFound(t, <-closed, "left-behind")
	assert.Zero(t, fx.plugin.callCount("close"))
	require.NoError(t, fx.ctrl.WriteSession("wB", "left-behind", []byte("x")))
}

// A close that the plugin answered with an error was still decided: the SDK's close that times out still ends the
// session, and its CLOSE is its end (TestASessionTheHostClosedLeavesNoRecordWhenItsCloseComes). The window that asked
// still holds the session until then, and no other window is handed it.
func TestASessionWhoseCloseTheHostCouldNotCarryOutIsStillBeingClosedAndIsNotHandedToAnotherWindow(t *testing.T) {
	fx := newOwnershipRaceFixture(t)
	fx.make("wA", "stuck")
	require.NoError(t, fx.ctrl.OfferSession("wA", "stuck"))
	fx.plugin.closeFails = errors.New("CloseSession timed out waiting for session stuck goroutines")
	require.Error(t, fx.ctrl.CloseSession("wA", "stuck"))

	require.NoError(t, fx.ctrl.WriteSession("wA", "stuck", []byte("x")), "still A's until its CLOSE comes")
	_, _, err := fx.ctrl.AttachSession("wB", "stuck")
	requireSessionNotFound(t, err, "stuck")
}

// Two windows that offer and claim at once, and one that ends: whatever the order, a session is held by exactly one
// window, an offer is used once, and a session that was ended is held by none. Each of the eight rounds starts every
// call at the same instant and asserts what must hold at the end, not which call won.
func TestAnOfferIsUsedOnceAndAnEndedSessionIsHeldByNoneWhateverTheOrder(t *testing.T) {
	const claimants = 8
	for round := range 8 {
		fx := newOwnershipRaceFixture(t)
		fx.make("wA", "contested")
		require.NoError(t, fx.ctrl.OfferSession("wA", "contested"))

		start := make(chan struct{})
		var wg sync.WaitGroup
		var claimed atomic.Int32
		winner := make([]atomic.Bool, claimants)
		for i := range claimants {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				if _, _, err := fx.ctrl.AttachSession(terminal.Owner(i), "contested"); err == nil {
					claimed.Add(1)
					winner[i].Store(true)
				}
			}()
		}
		var closeErr error
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			closeErr = fx.ctrl.CloseSession("wA", "contested")
		}()
		close(start)
		wg.Wait()

		holders := 0
		for i := range claimants {
			if fx.ctrl.WriteSession(terminal.Owner(i), "contested", []byte("x")) == nil {
				holders++
				assert.True(t, winner[i].Load(), "round %d: only the window that claimed holds it", round)
			}
		}
		if fx.plugin.callCount("close") == 0 {
			// A's close was refused: a claimant held it by then. It is alive, and one window holds it.
			requireSessionNotFound(t, closeErr, "contested")
			assert.Equal(t, 1, holders, "round %d: an offer is used once, and the session was not ended", round)
			assert.Equal(t, int32(1), claimed.Load(), "round %d", round)
		} else {
			// The close was decided first: it went through, and nobody holds the session.
			require.NoError(t, closeErr, "round %d", round)
			assert.Zero(t, holders, "round %d: an ended session is held by none", round)
			assert.Empty(t, fx.indexed(), "round %d", round)
		}
	}
}

// A local terminal through the wrapper, as the window sees it: the window that offered it and lost it to the window that
// attached it does not end it, and the window that holds it does. (The terminal manager decides who ends a terminal in
// one step, and its tests force the order; this is the path a page takes to it.)
func TestAWindowThatGaveALocalTerminalAwayCannotEndItAndTheWindowThatHoldsItCan(t *testing.T) {
	fx := newTerminalFixture(t)
	a, b := fx.page(1), fx.page(2)
	info := fx.open(a, terminal.Options{Command: append(shell(t), "-c", "stty -echo; cat")})
	require.NoError(t, fx.wrapper.OfferSession(fx.ctx(a), info.ID))
	_, _, err := fx.wrapper.AttachSession(fx.ctx(b), info.ID)
	require.NoError(t, err, "B claims what A offered")

	requireNotFound(t, fx.wrapper.CloseSession(fx.ctx(a), info.ID), "A gave it away")
	assert.False(t, gone(info.PID), "A's close did not end it")
	require.NoError(t, fx.wrapper.CloseSession(fx.ctx(b), info.ID), "B holds it")
	require.Eventually(t, func() bool { return gone(info.PID) }, 20*time.Second, 5*time.Millisecond)
}

// An offer of a session of a plugin is taken back by the window that made it and by no other; the next window to attach
// it finds none, and the session is still the offering window's.
func TestAnOfferOfASessionOfAPluginIsTakenBackByItsWindowAndByNoOther(t *testing.T) {
	fx := newOwnershipRaceFixture(t)
	fx.make("wA", "moving")

	require.NoError(t, fx.ctrl.RevokeSession("wA", "moving"), "there is no offer to take back, and that is no error")
	require.NoError(t, fx.ctrl.OfferSession("wA", "moving"))
	for _, stranger := range []terminal.Owner{"wB", nil} {
		requireSessionNotFound(t, fx.ctrl.RevokeSession(stranger, "moving"), "moving")
	}
	requireSessionNotFound(t, fx.ctrl.RevokeSession("wA", "no-such-session"), "no-such-session")
	require.NoError(t, fx.ctrl.RevokeSession("wA", "moving"))

	_, _, err := fx.ctrl.AttachSession("wB", "moving")
	requireSessionNotFound(t, err, "moving")
	require.NoError(t, fx.ctrl.WriteSession("wA", "moving", []byte("x")), "it is still A's")
	require.NoError(t, fx.ctrl.OfferSession("wA", "moving"), "and it can be offered again")
	_, _, err = fx.ctrl.AttachSession("wB", "moving")
	require.NoError(t, err)
	requireSessionNotFound(t, fx.ctrl.RevokeSession("wA", "moving"), "moving")
}

// The same for a local terminal through the wrapper, and for a window that never held it.
func TestAnOfferOfALocalTerminalIsTakenBackThroughTheWrapper(t *testing.T) {
	fx := newTerminalFixture(t)
	a, b := fx.page(1), fx.page(2)
	info := fx.open(a, terminal.Options{Command: append(shell(t), "-c", "stty -echo; cat")})
	require.NoError(t, fx.wrapper.OfferSession(fx.ctx(a), info.ID))

	requireNotFound(t, fx.wrapper.RevokeSession(fx.ctx(b), info.ID), "a window that does not hold it")
	requireNotFound(t, fx.wrapper.RevokeSession(context.Background(), info.ID), "no window")
	require.NoError(t, fx.wrapper.RevokeSession(fx.ctx(a), info.ID))
	_, _, err := fx.wrapper.AttachSession(fx.ctx(b), info.ID)
	requireNotFound(t, err, "the offer was taken back")
	require.NoError(t, fx.wrapper.WriteTerminal(fx.ctx(a), info.ID, 0, []byte("still mine\n")))
}

// A session whose end the host has decided is nobody's to list, read or end (CodeRabbit): it is going, and a window that is
// shown it would be refused when it attached it. The window that holds it keeps its access until the CLOSE comes. This holds
// for a close that is on its way and for one the plugin answered with an error (the end stays decided).
func TestASessionWhoseEndIsDecidedIsNotListedReadOrEndedByAWindowThatDoesNotHoldIt(t *testing.T) {
	t.Run("a close that is on its way", func(t *testing.T) {
		fx := newOwnershipRaceFixture(t)
		fx.make(nil, "going")
		fx.plugin.closeGate = newGate()
		closed := fx.closeAsync("wA", "going")
		<-fx.plugin.closeGate.entered

		ids, err := fx.ctrl.ListSessions("wB")
		require.NoError(t, err)
		assert.Empty(t, ids, "the session is going: it is not listed to a window that does not hold it")
		_, err = fx.ctrl.GetSession("wB", "going")
		requireSessionNotFound(t, err, "going")
		requireSessionNotFound(t, fx.ctrl.CloseSession("wB", "going"), "going")
		close(fx.plugin.closeGate.release)
		require.NoError(t, <-closed)
		assert.Empty(t, fx.indexed())
	})
	t.Run("a close that the plugin answered with an error", func(t *testing.T) {
		fx := newOwnershipRaceFixture(t)
		fx.make(nil, "stuck")
		fx.plugin.closeFails = errors.New("CloseSession timed out waiting for session stuck goroutines")
		require.Error(t, fx.ctrl.CloseSession("wA", "stuck"))

		ids, err := fx.ctrl.ListSessions("wB")
		require.NoError(t, err)
		assert.Empty(t, ids)
		_, err = fx.ctrl.GetSession("wB", "stuck")
		requireSessionNotFound(t, err, "stuck")
		_, _, err = fx.ctrl.AttachSession("wB", "stuck")
		requireSessionNotFound(t, err, "stuck")
	})
	t.Run("the window that holds it keeps listing and using it", func(t *testing.T) {
		fx := newOwnershipRaceFixture(t)
		fx.make("wA", "mine")
		fx.plugin.closeFails = errors.New("CloseSession timed out waiting for session mine goroutines")
		require.Error(t, fx.ctrl.CloseSession("wA", "mine"))

		ids, err := fx.ctrl.ListSessions("wA")
		require.NoError(t, err)
		require.Len(t, ids, 1, "its own session is listed until its CLOSE comes")
		require.NoError(t, fx.ctrl.WriteSession("wA", "mine", []byte("x")))
	})
}

// forgettingRealm is a realm that has forgotten its retired windows: it admits whatever it is asked about. The real one keeps a
// closed window for a minute and then admits it again (window_realm.go), and a plugin has no deadline for making a session.
type forgettingRealm struct{ WindowRealm }

func (forgettingRealm) AdmitWindow(application.Window) (*invocation.Scope, error) {
	return invocation.NewScope(invocation.TrustedUI), nil
}

// A window that retired long before the plugin answered (longer than the realm remembers it) leaves its session to no
// window all the same (CodeRabbit): the controller keeps the retirement for as long as a session is being made for the
// window, and does not ask the realm, which may have forgotten. Another window that retires meanwhile changes nothing for it.
func TestASessionIsLeftToNoWindowWhenItsWindowRetiredLongerAgoThanTheRealmRemembers(t *testing.T) {
	fx := newOwnershipRaceFixture(t)
	fx.wrapper = &ServiceWrapper{Ctrl: fx.ctrl, Realm: forgettingRealm{WindowRealm: fx.realm}}
	a, b := fx.window(1), fx.window(2)
	fx.plugin.createGate = newGate()
	made := fx.createAsync(a, "late")
	<-fx.plugin.createGate.entered

	fx.ctrl.ReleaseOwnedTerminals(invocation.IdentityOf(a), terminal.ClosedByWindow) // what the realm announces when A retires
	close(fx.plugin.createGate.release)
	require.NoError(t, (<-made).err)

	assert.Equal(t, []string{"late"}, fx.listedTo(b), "no window holds it: any window lists it")
	_, _, err := fx.wrapper.AttachSession(fx.as(b), "late")
	require.NoError(t, err, "and the first to attach holds it")
}

func TestTheRetirementOfAnotherWindowWhileASessionIsMadeLeavesItToItsWindow(t *testing.T) {
	fx := newOwnershipRaceFixture(t)
	a, b, c := fx.window(1), fx.window(2), fx.window(3)
	fx.plugin.createGate = newGate()
	made := fx.createAsync(a, "mine")
	<-fx.plugin.createGate.entered

	fx.ctrl.ReleaseOwnedTerminals(invocation.IdentityOf(b), terminal.ClosedByWindow) // B retires; it has nothing here
	close(fx.plugin.createGate.release)
	require.NoError(t, (<-made).err)

	assert.Empty(t, fx.listedTo(c), "the session is still A's")
	_, _, err := fx.wrapper.AttachSession(fx.as(c), "mine")
	requireSessionNotFound(t, err, "mine")
	require.NoError(t, fx.wrapper.WriteSession(fx.as(a), "mine", []byte("x")))
}

// Input that the plugin has not taken when the session changes hands is not let in after the new holder's claim: the window
// that held the session asked while it held it, and the call is refused when it comes to be sent after the claim (CodeRabbit).
// The input of the window that holds it is sent as before.
func TestInputThatThePluginHasNotTakenWhenASessionChangesHandsIsRefusedAndNeverSentAfterTheClaim(t *testing.T) {
	fx := newOwnershipRaceFixture(t)
	inputs := make(chan execsdk.StreamInput) // unbuffered: the plugin takes input when it reads, and not before
	fx.ctrl.mu.Lock()
	fx.ctrl.inChans[endedFixturePlugin] = inputs
	fx.ctrl.mu.Unlock()
	fx.make("wA", "moving")
	require.NoError(t, fx.ctrl.OfferSession("wA", "moving"))

	inside := make(chan struct{})
	var once sync.Once
	fx.ctrl.beforeSend = func(string) { once.Do(func() { close(inside) }) }
	typed := make(chan error, 1)
	go func() { typed <- fx.ctrl.WriteSession("wA", "moving", []byte("A1")) }()
	<-inside // A has been checked, and the plugin does not take its input: the claim lands after the check
	_, _, err := fx.ctrl.AttachSession("wB", "moving")
	require.NoError(t, err, "B claims the session that A offered")

	received := make(chan string, 8)
	go func() {
		for input := range inputs {
			received <- string(input.Data)
		}
		close(received)
	}()
	requireSessionNotFound(t, <-typed, "moving")
	require.NoError(t, fx.ctrl.WriteSession("wB", "moving", []byte("B1")))
	fx.ctrl.mu.Lock()
	delete(fx.ctrl.inChans, endedFixturePlugin)
	fx.ctrl.mu.Unlock()
	close(inputs)
	var all []string
	for word := range received {
		all = append(all, word)
	}
	assert.Equal(t, []string{"B1"}, all, "the plugin has B's input and none of A's, which was not taken when B claimed")
}
