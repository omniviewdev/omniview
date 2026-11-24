//go:build !windows

package exec

import (
	"context"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// WHO HOLDS A SESSION (T2c-go.md): every binding that names a session by its id alone answers a window that does
// not hold it what it answers for an id that never was.

// bareIDCalls is every binding of the exec service that addresses a session by its id, each as a call that answers
// only whether it succeeded. A new binding of this kind belongs here, and in the list of denied methods of the audit
// policy.
func bareIDCalls(fx *terminalFixture, typed string) map[string]func(ctx context.Context, id string) error {
	w := fx.wrapper
	return map[string]func(ctx context.Context, id string) error{
		"GetSession":     func(ctx context.Context, id string) error { _, err := w.GetSession(ctx, id); return err },
		"AttachSession":  func(ctx context.Context, id string) error { _, _, err := w.AttachSession(ctx, id); return err },
		"DetachSession":  func(ctx context.Context, id string) error { _, err := w.DetachSession(ctx, id); return err },
		"WriteSession":   func(ctx context.Context, id string) error { return w.WriteSession(ctx, id, []byte(typed)) },
		"WriteTerminal":  func(ctx context.Context, id string) error { return w.WriteTerminal(ctx, id, 0, []byte(typed)) },
		"ResizeSession":  func(ctx context.Context, id string) error { return w.ResizeSession(ctx, id, 10, 10) },
		"ResizeTerminal": func(ctx context.Context, id string) error { return w.ResizeTerminal(ctx, id, 0, 10, 10) },
		"IsBusy":         func(ctx context.Context, id string) error { _, err := w.IsBusy(ctx, id); return err },
		"GetCwd":         func(ctx context.Context, id string) error { _, err := w.GetCwd(ctx, id); return err },
		"AckTerminal":    func(ctx context.Context, id string) error { return w.AckTerminal(ctx, id, 1) },
		"OfferSession":   func(ctx context.Context, id string) error { return w.OfferSession(ctx, id) },
		"RevokeSession":  func(ctx context.Context, id string) error { return w.RevokeSession(ctx, id) },
		"CloseSession":   func(ctx context.Context, id string) error { return w.CloseSession(ctx, id) },
	}
}

// wordsOf is what an error says, with the id it names put as ID, so that the answers for two ids can be compared. Nothing
// says "": a call that was not refused has no words, and it is not the words of a refusal.
func wordsOf(err error, id string) string {
	if err == nil {
		return ""
	}
	return strings.ReplaceAll(err.Error(), id, "ID")
}

func requireNotFound(t *testing.T, err error, what string) {
	t.Helper()
	var app *apperror.AppError
	require.ErrorAs(t, err, &app, what)
	require.Equal(t, apperror.TypeSessionNotFound, app.Type, what)
}

func listedIDs(ctx context.Context, t *testing.T, fx *terminalFixture) []string {
	t.Helper()
	sessions, err := fx.wrapper.ListSessions(ctx)
	require.NoError(t, err)
	out := make([]string, 0, len(sessions))
	for _, session := range sessions {
		out = append(out, session.ID)
	}
	return out
}

// Window A opens a terminal. Window B, and a call that comes from no window, can do nothing to it by any binding that
// names it by its id: each is told what is told of an id that never was, in the same words, so that the answer says
// nothing of whether the terminal is there; its output is not sent to B by a call, nothing B types reaches its shell,
// B's close does not end it, and B's list does not show it. A's own calls work.
func TestAWindowCannotUseTheTerminalOfAnotherWindowByAnyBindingThatNamesItById(t *testing.T) {
	fx := newTerminalFixture(t)
	a, b := fx.page(1), fx.page(2)
	info := fx.open(a, terminal.Options{Command: append(shell(t), "-c", "stty -echo; cat")})
	ctxA, ctxB := fx.ctx(a), fx.ctx(b)
	require.NoError(t, fx.wrapper.WriteTerminal(ctxA, info.ID, 1, []byte("mine\n")))
	require.Eventually(t, func() bool { return strings.Contains(fx.output(info.ID), "mine") }, 20*time.Second, 5*time.Millisecond)

	const missing = "no-such-session"
	own, calls := bareIDCalls(fx, "fine\n"), bareIDCalls(fx, "evil\n")
	for name, call := range own {
		if name == "CloseSession" || name == "OfferSession" {
			continue // an offer would let the next window to attach take the terminal: the next test asks for it
		}
		require.NoError(t, call(ctxA, info.ID), "%s: the window that opened it", name)
	}
	for name, call := range calls {
		for who, ctx := range map[string]context.Context{"another window": ctxB, "no window": context.Background()} {
			theirs, never := call(ctx, info.ID), call(ctx, missing)
			requireNotFound(t, theirs, name+" by "+who)
			requireNotFound(t, never, name+" of an id that never was")
			assert.Equal(t, wordsOf(never, missing), wordsOf(theirs, info.ID), "%s by %s: the same words as for an id that never was", name, who)
		}
	}

	// What B typed would reach the shell before this line does (every call is answered once its bytes are written, and the
	// shell reads them in order): once the shell has printed the line, it has printed everything that was sent before it.
	require.NoError(t, fx.wrapper.WriteTerminal(ctxA, info.ID, 0, []byte("sentinel\n")))
	require.Eventually(t, func() bool { return strings.Contains(fx.output(info.ID), "sentinel") }, 20*time.Second, 5*time.Millisecond)
	assert.NotContains(t, fx.output(info.ID), "evil", "what B typed never reached the shell")
	assert.False(t, gone(info.PID), "B's close did not end it")
	assert.Equal(t, []string{info.ID}, listedIDs(ctxA, t, fx))
	assert.Empty(t, listedIDs(ctxB, t, fx), "B's list does not show it")
	assert.Empty(t, listedIDs(context.Background(), t, fx))

	require.NoError(t, calls["CloseSession"](ctxA, info.ID), "A ends its own")
}

// A terminal with a page key that its page left belongs to nobody, and then to the page that attaches it with the
// key: that page, and no other, uses it, and the page that had it is refused.
func TestAKeyedTerminalBelongsToTheWindowThatAttachedItAndToNoOther(t *testing.T) {
	fx := newTerminalFixture(t)
	first, second, stranger := fx.page(1), fx.page(2), fx.page(3)
	info := fx.mustOpenKeyed(first, keyA, `stty -echo; cat`)
	calls := bareIDCalls(fx, "x\n")
	require.NoError(t, calls["WriteTerminal"](fx.ctx(first), info.ID), "its window while it has it")

	fx.retire(first)
	fx.detached(info.ID)
	for name, call := range calls {
		requireNotFound(t, call(fx.ctx(stranger), info.ID), name+": a window that never had it")
		requireNotFound(t, call(fx.ctx(second), info.ID), name+": a detached terminal belongs to nobody, whatever page asks, until it is attached")
	}
	_, err := fx.wrapper.AttachTerminal(fx.ctx(second), info.ID, terminal.AttachRequest{PageKey: keyA})
	require.NoError(t, err)
	require.NoError(t, calls["WriteTerminal"](fx.ctx(second), info.ID), "the page that attached it")
	for name, call := range calls {
		requireNotFound(t, call(fx.ctx(first), info.ID), name+": the page that left it")
		requireNotFound(t, call(fx.ctx(stranger), info.ID), name+": a window that never had it")
	}
}

// The move of a tab to another window: the window that holds the session offers it, and the next window to attach it
// holds it. The offer is no access (nobody else can use the session meanwhile, and only its owner offers), it is used
// once, the window that lost the session is refused from then on (its late DetachSession lands on nothing) and is told.
func TestAnOfferLetsTheNextWindowToAttachTheTerminalTakeItAndNoOneElse(t *testing.T) {
	fx := newTerminalFixture(t)
	a, b, c := fx.page(1), fx.page(2), fx.page(3)
	info := fx.open(a, terminal.Options{Command: append(shell(t), "-c", "stty -echo; cat")})
	calls := bareIDCalls(fx, "x\n")

	requireNotFound(t, calls["OfferSession"](fx.ctx(b), info.ID), "a window that does not hold it cannot offer it")
	requireNotFound(t, calls["AttachSession"](fx.ctx(b), info.ID), "nothing is offered yet")
	require.NoError(t, calls["OfferSession"](fx.ctx(a), info.ID))
	requireNotFound(t, calls["WriteTerminal"](fx.ctx(b), info.ID), "an offer is no access: it is a right to attach")
	require.NoError(t, calls["WriteTerminal"](fx.ctx(a), info.ID), "the owner holds it while the offer is open")

	require.NoError(t, calls["AttachSession"](fx.ctx(b), info.ID), "the window that attaches it first")
	require.NoError(t, calls["WriteTerminal"](fx.ctx(b), info.ID))
	for _, name := range []string{"WriteTerminal", "DetachSession", "CloseSession", "IsBusy"} {
		requireNotFound(t, calls[name](fx.ctx(a), info.ID), name+": the window that moved it away")
	}
	requireNotFound(t, calls["AttachSession"](fx.ctx(c), info.ID), "the offer was used once")
	told := false
	for _, event := range fx.eventsOf(info.ID) {
		if detachment, ok := event.data.(terminal.Detachment); ok && event.name == localDetachedEvent+info.ID {
			told = told || (detachment.By == terminal.DetachedByTakeover && detachment.Attachment == 0)
		}
	}
	assert.True(t, told, "the window that lost it was told")
	assert.Equal(t, []string{info.ID}, listedIDs(fx.ctx(b), t, fx))
	assert.Empty(t, listedIDs(fx.ctx(a), t, fx))
	require.NoError(t, calls["CloseSession"](fx.ctx(b), info.ID))
}

// What a terminal that ended by itself while no page was attached leaves is dismissed by the page that attached it:
// the end is not in the exec lane's index (its CLOSE took it out), and the terminal manager keeps it for that page.
func TestTheEndOfATerminalThatEndedWhileDetachedIsDismissedByTheWindowThatAttachedIt(t *testing.T) {
	fx := newTerminalFixture(t)
	first, second, stranger := fx.page(1), fx.page(2), fx.page(3)
	info := fx.mustOpenKeyed(first, keyA, `printf 'up\n'; exec sleep 300`)
	require.Eventually(t, func() bool { text, _ := fx.positioned(info.ID); return strings.Contains(text, "up\r\n") }, 20*time.Second, 5*time.Millisecond)
	fx.retire(first)
	fx.detached(info.ID)
	// It ends by itself while detached: a signal from outside, once it is detached, whatever the machine does (a sleep in
	// the script would race the detach, and no window may write to a terminal that no window holds).
	require.NoError(t, syscall.Kill(info.PID, syscall.SIGTERM))
	require.Eventually(t, func() bool {
		listed := fx.listed(second, keyA)
		return len(listed) == 1 && listed[0].Ended != nil
	}, 30*time.Second, 20*time.Millisecond, "the terminal ended by itself while detached and left its end")

	requireNotFound(t, fx.wrapper.CloseSession(fx.ctx(stranger), info.ID), "a window that never had it")
	requireNotFound(t, fx.wrapper.CloseSession(fx.ctx(second), info.ID), "nor the page that has only listed it")
	attached, err := fx.wrapper.AttachTerminal(fx.ctx(second), info.ID, terminal.AttachRequest{PageKey: keyA})
	require.NoError(t, err)
	require.NotNil(t, attached.Ended)
	requireNotFound(t, fx.wrapper.CloseSession(fx.ctx(stranger), info.ID), "still not a window that never had it")
	require.NoError(t, fx.wrapper.CloseSession(fx.ctx(second), info.ID), "the page that attached its end dismisses it")
	assert.Empty(t, fx.listed(second, keyA))
	requireNotFound(t, fx.wrapper.CloseSession(fx.ctx(second), info.ID), "a second close finds nothing")
	requireNotFound(t, fx.wrapper.CloseSession(fx.ctx(second), "no-such-session"), "and an id that never was is still not found")
}

// The sessions of a plugin belong to the window that created them: another window can neither use them nor list them;
// when the window goes away they belong to none, any window lists them and the one that attaches one holds it (the page
// that reloaded finds the sessions it had); a session made by a call that came from no window belongs to none from the
// start; a window that moves a tab offers the session first.
func TestASessionOfAPluginBelongsToTheWindowThatCreatedItUntilThatWindowGoesAway(t *testing.T) {
	fx := newEndedSessionFixture(t)
	create := func(owner terminal.Owner, id string) {
		t.Helper()
		session, err := fx.ctrl.CreateSession(context.Background(), owner, endedFixturePlugin, endedFixtureConnection, execsdk.SessionOptions{ID: id})
		require.NoError(t, err)
		require.Equal(t, id, session.ID)
	}
	ids := func(owner terminal.Owner) []string {
		t.Helper()
		sessions, err := fx.ctrl.ListSessions(owner)
		require.NoError(t, err)
		out := make([]string, 0, len(sessions))
		for _, session := range sessions {
			out = append(out, session.ID)
		}
		return out
	}
	create("wA", "mine")
	create("wA", "moving")
	create(nil, "nobody-made-it")

	assert.ElementsMatch(t, []string{"mine", "moving", "nobody-made-it"}, ids("wA"), "its own, and the one no window holds")
	assert.ElementsMatch(t, []string{"nobody-made-it"}, ids("wB"), "not the sessions of another window")
	assert.Empty(t, ids(nil), "a call from no window lists nothing")

	notFoundFor := func(owner terminal.Owner, id string) {
		t.Helper()
		_, err := fx.ctrl.GetSession(owner, id)
		requireSessionNotFound(t, err, id)
		_, _, err = fx.ctrl.AttachSession(owner, id)
		requireSessionNotFound(t, err, id)
		_, err = fx.ctrl.DetachSession(owner, id)
		requireSessionNotFound(t, err, id)
		requireSessionNotFound(t, fx.ctrl.WriteSession(owner, id, []byte("x")), id)
		requireSessionNotFound(t, fx.ctrl.ResizeSession(owner, id, 24, 80), id)
		requireSessionNotFound(t, fx.ctrl.CloseSession(owner, id), id)
		requireSessionNotFound(t, fx.ctrl.OfferSession(owner, id), id)
	}
	notFoundFor("wB", "mine")
	notFoundFor(nil, "mine")
	require.NoError(t, fx.ctrl.WriteSession("wA", "mine", []byte("ls\n")), "its window")
	_, _, err := fx.ctrl.AttachSession("wA", "mine")
	require.NoError(t, err)

	// A session that no window holds is listed to any window and is not used until a window attaches it.
	_, err = fx.ctrl.GetSession("wB", "nobody-made-it")
	require.NoError(t, err, "its facts may be read")
	requireSessionNotFound(t, fx.ctrl.WriteSession("wB", "nobody-made-it", []byte("x")), "nobody-made-it")
	_, _, err = fx.ctrl.AttachSession(nil, "nobody-made-it")
	requireSessionNotFound(t, err, "nobody-made-it")
	_, _, err = fx.ctrl.AttachSession("wB", "nobody-made-it")
	require.NoError(t, err, "the window that attaches it holds it from then on")
	notFoundFor("wC", "nobody-made-it")
	require.NoError(t, fx.ctrl.WriteSession("wB", "nobody-made-it", []byte("x")))

	// The window goes away: what it had is the sessions of nobody, found by whichever window attaches them.
	fx.ctrl.ReleaseOwnedTerminals("wA", terminal.ClosedByWindow)
	assert.ElementsMatch(t, []string{"mine", "moving"}, ids("wC"), "the sessions of the window that left are listed to any window; wB holds the other")
	requireSessionNotFound(t, fx.ctrl.WriteSession("wA", "mine", []byte("x")), "mine")
	_, _, err = fx.ctrl.AttachSession("wC", "mine")
	require.NoError(t, err, "a window that reloaded finds the session it had")
	require.NoError(t, fx.ctrl.WriteSession("wC", "mine", []byte("ls\n")))
	notFoundFor("wB", "mine")

	// An offer: the owner offers, the next window to attach holds it, once.
	require.NoError(t, fx.ctrl.OfferSession("wC", "mine"))
	requireSessionNotFound(t, fx.ctrl.WriteSession("wB", "mine", []byte("x")), "mine")
	_, _, err = fx.ctrl.AttachSession("wB", "mine")
	require.NoError(t, err)
	requireSessionNotFound(t, fx.ctrl.WriteSession("wC", "mine", []byte("x")), "mine")
	_, _, err = fx.ctrl.AttachSession("wD", "mine")
	requireSessionNotFound(t, err, "mine")
	// An offer runs out.
	require.NoError(t, fx.ctrl.OfferSession("wB", "mine"))
	fx.clock.Advance(terminal.OfferTTL + time.Second)
	_, _, err = fx.ctrl.AttachSession("wD", "mine")
	requireSessionNotFound(t, err, "mine")
	require.NoError(t, fx.ctrl.CloseSession("wB", "mine"))
}

// A session of a plugin that ended by itself with nobody attached leaves its output for the first attach, and the
// record of it belongs to the window that created it: another window cannot take that output, and cannot forget the
// record by a close or a detach.
func TestTheOutputOfAnEndedSessionOfAPluginIsForTheWindowThatCreatedIt(t *testing.T) {
	fx := newEndedSessionFixture(t)
	_, err := fx.ctrl.CreateSession(context.Background(), "wA", endedFixturePlugin, endedFixtureConnection, execsdk.SessionOptions{ID: "short"})
	require.NoError(t, err)
	fx.plugin.write("short", "hi\n")
	fx.endByItself("short")

	_, _, err = fx.ctrl.AttachSession("wB", "short")
	requireSessionNotFound(t, err, "short")
	requireSessionNotFound(t, fx.ctrl.CloseSession("wB", "short"), "short")
	_, err = fx.ctrl.DetachSession("wB", "short")
	requireSessionNotFound(t, err, "short")
	_, output, err := fx.ctrl.AttachSession("wA", "short")
	require.NoError(t, err)
	assert.Equal(t, "hi\n", string(output), "the window that created it gets what it printed")
}

// The three methods of the fake plugin that the ownership tests reach.

func (p *aKeepingPlugin) ListSessions(*sdktypes.PluginContext) ([]*execsdk.Session, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]*execsdk.Session, 0, len(p.live))
	for id := range p.live {
		out = append(out, &execsdk.Session{ID: id})
	}
	return out, nil
}

func (p *aKeepingPlugin) GetSession(_ *sdktypes.PluginContext, id string) (*execsdk.Session, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, ok := p.live[id]; !ok {
		return nil, p.notFoundFor(id)
	}
	return &execsdk.Session{ID: id}, nil
}

func (p *aKeepingPlugin) ResizeSession(_ *sdktypes.PluginContext, id string, _, _ int32) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, ok := p.live[id]; !ok {
		return p.notFoundFor(id)
	}
	return nil
}

// What a window may list it may end. A session that no window holds is listed to any window, and any window may adopt
// it with one call (attach), so refusing to end it would protect nothing, and a window that lists a session it cannot
// end is a contract that lies: the e2e teardown (a client that is not the page that made the session) lists the
// sessions a retired page left and ends each one. A session that a window holds is still not the business of another,
// and a call from no window lists nothing and ends nothing.
func TestAWindowEndsTheSessionsItListsThatNoWindowHoldsAndNoOtherWindows(t *testing.T) {
	fx := newEndedSessionFixture(t)
	for _, id := range []string{"theirs", "left-behind", "made-by-nobody"} {
		owner := terminal.Owner("wA")
		if id == "made-by-nobody" {
			owner = nil
		}
		_, err := fx.ctrl.CreateSession(context.Background(), owner, endedFixturePlugin, endedFixtureConnection, execsdk.SessionOptions{ID: id})
		require.NoError(t, err)
	}
	require.Equal(t, 2, fx.ctrl.orphanSessionsOf("wA"), "the window that made two sessions goes away and leaves both")

	listed, err := fx.ctrl.ListSessions("wB")
	require.NoError(t, err)
	ids := make([]string, 0, len(listed))
	for _, session := range listed {
		ids = append(ids, session.ID)
	}
	require.ElementsMatch(t, []string{"theirs", "left-behind", "made-by-nobody"}, ids, "a window lists what no window holds")

	requireSessionNotFound(t, fx.ctrl.CloseSession(nil, "left-behind"), "left-behind")
	require.NoError(t, fx.ctrl.CloseSession("wB", "left-behind"), "wB lists it, so wB ends it, without attaching it first")
	requireSessionNotFound(t, fx.ctrl.CloseSession("wB", "left-behind"), "left-behind")
	_, _, err = fx.ctrl.AttachSession("wB", "theirs")
	require.NoError(t, err, "wB adopts another")
	requireSessionNotFound(t, fx.ctrl.CloseSession("wC", "theirs"), "theirs")
	require.NoError(t, fx.ctrl.CloseSession("wB", "theirs"), "and the window that adopted it ends it")
}

// A window that claims a session with its first call is a window the realm knows by then (CodeRabbit): when the page
// that was offered a terminal retires, the terminal ends with it, though the page never made a session of its own. A
// claim that did not admit the window left the terminal to a window whose retirement nobody heard of.
func TestAWindowThatClaimsASessionWithItsFirstCallIsReleasedWithItWhenItRetires(t *testing.T) {
	fx := newTerminalFixture(t)
	a, b := fx.page(1), fx.page(2)
	info := fx.open(a, terminal.Options{Command: append(shell(t), "-c", "stty -echo; cat")})
	require.NoError(t, fx.wrapper.OfferSession(fx.ctx(a), info.ID))
	_, _, err := fx.wrapper.AttachSession(fx.ctx(b), info.ID)
	require.NoError(t, err, "the window that is offered the terminal claims it with its first call")

	fx.retire(b)
	require.Eventually(t, func() bool { return len(fx.closes(info.ID)) == 1 }, 30*time.Second, 20*time.Millisecond,
		"the terminal ends with the window that holds it now")
}
