//go:build !windows

package exec

import (
	"context"
	"encoding/json"
	"math/rand/v2"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// The keys of two pages: a page makes one for itself.
const (
	keyA = "page-key-A-0123456789abcdef"
	keyB = "page-key-B-fedcba9876543210"
)

func (fx *terminalFixture) ctx(window application.Window) context.Context {
	return context.WithValue(context.Background(), application.WindowKey, window)
}

// openKeyed opens a terminal that has a page key, which runs script, for the window.
func (fx *terminalFixture) openKeyed(window application.Window, key string, leaseMs int, script string) (*terminal.Session, error) {
	return fx.wrapper.CreateTerminal(fx.ctx(window), execsdk.SessionOptions{Command: append(shell(fx.t), "-c", script)},
		terminal.Launch{PageKey: key, LeaseMs: leaseMs})
}

func (fx *terminalFixture) mustOpenKeyed(window application.Window, key string, script string) *terminal.Session {
	fx.t.Helper()
	info, err := fx.openKeyed(window, key, 0, script)
	require.NoError(fx.t, err)
	return info
}

// positioned is what a terminal that has a page key wrote, from its output events, which must be contiguous: each
// starts at the offset where the one before ended.
func (fx *terminalFixture) positioned(id string) (string, bool) {
	var text strings.Builder
	var next uint64
	for _, event := range fx.eventsOf(id) {
		if event.name != localOffsetOutputEvent+id {
			continue
		}
		out, ok := event.data.(*terminalOutput)
		if !ok || !out.positioned || out.offset != next {
			return text.String(), false
		}
		text.Write(out.Bytes())
		next += uint64(len(out.Bytes()))
	}
	return text.String(), true
}

func (fx *terminalFixture) listed(window application.Window, key string) []terminal.Listed {
	fx.t.Helper()
	got, err := fx.wrapper.ListTerminals(fx.ctx(window), key)
	require.NoError(fx.t, err)
	return got
}

func (fx *terminalFixture) retire(page *terminalPage) { fx.pages.set(page.client, false) }

// detached waits until the key's one terminal is detached, which is what the retirement of its page does.
func (fx *terminalFixture) detached(id string) {
	fx.t.Helper()
	require.Eventually(fx.t, func() bool {
		for _, listed := range fx.ctrl.terminalManager.List(nil, keyA) {
			if listed.ID == id {
				return !listed.Attached
			}
		}
		return false
	}, 20*time.Second, 5*time.Millisecond, "the terminal was never detached")
}

// The output of a terminal with a page key comes on its own event, as an object that has its offset; a terminal
// without one comes as it did, as base64 text, and the two do not mix.
func TestTheOutputEventOfATerminalWithAPageKeyCarriesItsOffsetAndAnyOthersDoesNot(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	keyed := fx.mustOpenKeyed(page, keyA, `printf 'one\n'; printf 'two\n'; read x`)
	plain := fx.open(page, terminal.Options{Command: append(shell(t), "-c", "printf 'three\\n'; read x")})

	require.Eventually(t, func() bool { text, ok := fx.positioned(keyed.ID); return ok && strings.Contains(text, "two\r\n") }, 20*time.Second, 5*time.Millisecond)
	require.Eventually(t, func() bool { return strings.Contains(fx.output(plain.ID), "three") }, 20*time.Second, 5*time.Millisecond)
	text, contiguous := fx.positioned(keyed.ID)
	assert.True(t, contiguous, "each event starts where the one before ended")
	assert.Equal(t, "one\r\ntwo\r\n", text)
	assert.Empty(t, fx.output(keyed.ID), "a terminal with a key sends no event under the old name")
	text, _ = fx.positioned(plain.ID)
	assert.Empty(t, text, "and one without a key sends none under the new")

	for _, event := range fx.eventsOf(keyed.ID) {
		if event.name != localOffsetOutputEvent+keyed.ID {
			continue
		}
		raw, err := json.Marshal(event.data)
		require.NoError(t, err)
		var wire struct {
			Offset *uint64 `json:"offset"`
			Data   []byte  `json:"data"`
		}
		require.NoError(t, json.Unmarshal(raw, &wire), "an object with the offset and the bytes: %s", raw)
		require.NotNil(t, wire.Offset)
		out, ok := event.data.(*terminalOutput)
		require.True(t, ok)
		assert.Equal(t, out.Bytes(), wire.Data)
		break
	}
	for _, event := range fx.eventsOf(plain.ID) {
		if event.name != localOutputEvent+plain.ID {
			continue
		}
		raw, err := json.Marshal(event.data)
		require.NoError(t, err)
		var base64Text string
		require.NoError(t, json.Unmarshal(raw, &base64Text), "the old payload is base64 text: %s", raw)
		break
	}
}

// A terminal with a page key survives the page that opened it. The page that comes back, in a new window (a
// server-mode reload), finds it by the key and nothing else of that page's, takes it over, is handed the output
// it lacks, and goes on from there.
func TestATerminalWithAPageKeySurvivesItsPageAndTheNextPageFindsItByItsKey(t *testing.T) {
	fx := newTerminalFixture(t)
	first := fx.page(1)
	info := fx.mustOpenKeyed(first, keyA, `printf 'hello\n'; read x; printf 'got:%s\n' "$x"; read y`)
	require.Eventually(t, func() bool { text, _ := fx.positioned(info.ID); return strings.Contains(text, "hello\r\n") }, 20*time.Second, 5*time.Millisecond)

	fx.retire(first)
	fx.detached(info.ID)
	assert.False(t, gone(info.PID), "the page is gone and the shell is not")
	assert.Empty(t, fx.closes(info.ID), "nobody was told it ended")
	assert.Equal(t, 1, fx.indexed())

	second := fx.page(2)
	listed := fx.listed(second, keyA)
	require.Len(t, listed, 1)
	assert.Equal(t, info.ID, listed[0].ID)
	assert.Equal(t, info.PID, listed[0].PID)
	assert.False(t, listed[0].Attached)
	assert.Empty(t, fx.listed(second, keyB), "another page's key finds nothing")
	assert.Empty(t, fx.listed(second, ""), "and no key finds nothing of a window that owns nothing")

	notFound := func(request terminal.AttachRequest) {
		t.Helper()
		_, err := fx.wrapper.AttachTerminal(fx.ctx(second), info.ID, request)
		var app *apperror.AppError
		require.ErrorAs(t, err, &app)
		assert.Equal(t, apperror.TypeSessionNotFound, app.Type)
	}
	notFound(terminal.AttachRequest{PageKey: keyB})
	notFound(terminal.AttachRequest{})

	have := uint64(len("hello\r\n"))
	attached, err := fx.wrapper.AttachTerminal(fx.ctx(second), info.ID, terminal.AttachRequest{PageKey: keyA, FromOffset: &have})
	require.NoError(t, err)
	assert.Equal(t, info.PID, attached.Session.PID)
	assert.Equal(t, have, attached.Replay.Start)
	assert.Equal(t, have, attached.Replay.End, "the page had everything")
	assert.Nil(t, attached.Ended)

	require.NoError(t, fx.wrapper.WriteTerminal(info.ID, 1, []byte("abc\n")))
	require.Eventually(t, func() bool { text, _ := fx.positioned(info.ID); return strings.Contains(text, "got:abc\r\n") }, 20*time.Second, 5*time.Millisecond)
	text, contiguous := fx.positioned(info.ID)
	assert.True(t, contiguous)
	assert.Equal(t, "hello\r\nabc\r\ngot:abc\r\n", text, "the live output continues where the replay ended")
	assert.True(t, listedAttached(t, fx, second))
}

func listedAttached(t *testing.T, fx *terminalFixture, window application.Window) bool {
	t.Helper()
	listed := fx.listed(window, keyA)
	require.Len(t, listed, 1)
	return listed[0].Attached
}

// Twenty reloads of a server-mode page, each a new window: one shell, the same process, found each time by the
// key, and no other process was started for any of them.
func TestTwentyReloadsOfAServerModePageLeaveOneShellWithTheSamePID(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	info := fx.mustOpenKeyed(page, keyA, `printf 'up\n'; read x`)
	require.Eventually(t, func() bool { text, _ := fx.positioned(info.ID); return strings.Contains(text, "up\r\n") }, 20*time.Second, 5*time.Millisecond)
	have := uint64(len("up\r\n"))

	for reload := uint(2); reload <= 21; reload++ {
		fx.retire(page)
		fx.detached(info.ID)
		page = fx.page(reload)
		listed := fx.listed(page, keyA)
		require.Len(t, listed, 1, "reload %d", reload)
		require.Equal(t, info.ID, listed[0].ID)
		require.Equal(t, info.PID, listed[0].PID, "reload %d: the same shell", reload)
		attached, err := fx.wrapper.AttachTerminal(fx.ctx(page), info.ID, terminal.AttachRequest{PageKey: keyA, FromOffset: &have})
		require.NoError(t, err, "reload %d", reload)
		require.Equal(t, info.PID, attached.Session.PID)
		require.Equal(t, have, attached.Replay.Start, "reload %d: no gap", reload)
		have = attached.Replay.End
	}
	assert.False(t, gone(info.PID))
	if left, ok := children(t); ok {
		assert.Equal(t, []int{info.PID}, left, "one process, the same one, after twenty reloads")
	}
	assert.Len(t, fx.ctrl.terminalManager.ListSessions(), 1)
	assert.Equal(t, 1, fx.indexed())
	assert.Empty(t, fx.closes(info.ID))
}

// The page that took the terminal over owns it: the retirement of the page that left it, which comes later, finds
// nothing of its own, and the retirement of the new page detaches it again.
func TestTheLateRetirementOfTheOldPageDoesNotDetachWhatTheNewPageTookOver(t *testing.T) {
	fx := newTerminalFixture(t)
	first := fx.page(1)
	info := fx.mustOpenKeyed(first, keyA, `read x`)
	second := fx.page(2)
	_, err := fx.wrapper.AttachTerminal(fx.ctx(second), info.ID, terminal.AttachRequest{PageKey: keyA})
	require.NoError(t, err)

	fx.retire(first)
	time.Sleep(300 * time.Millisecond)
	assert.True(t, listedAttached(t, fx, second), "the new page still has it")
	fx.retire(second)
	fx.detached(info.ID)
	assert.False(t, gone(info.PID))
}

// A window that is already retired is refused: a terminal is not handed to a page nobody can reach, and it stays
// as it was.
func TestARetiredWindowCannotListOrAttachAndTheTerminalStaysDetached(t *testing.T) {
	fx := newTerminalFixture(t)
	first := fx.page(1)
	info := fx.mustOpenKeyed(first, keyA, `read x`)
	fx.retire(first)
	fx.detached(info.ID)

	late := fx.page(2)
	fx.retire(late)
	require.Eventually(t, func() bool {
		_, err := fx.wrapper.ListTerminals(fx.ctx(late), keyA)
		return err != nil
	}, 20*time.Second, 5*time.Millisecond, "the realm retires the page")
	_, err := fx.wrapper.ListTerminals(fx.ctx(late), keyA)
	require.ErrorIs(t, err, invocation.ErrWindowUnavailable)
	_, err = fx.wrapper.AttachTerminal(fx.ctx(late), info.ID, terminal.AttachRequest{PageKey: keyA})
	require.ErrorIs(t, err, invocation.ErrWindowUnavailable)
	_, err = fx.wrapper.DetachTerminal(fx.ctx(late), info.ID, terminal.DetachRequest{PageKey: keyA})
	require.ErrorIs(t, err, invocation.ErrWindowUnavailable)
	_, err = fx.wrapper.ListTerminals(context.Background(), keyA)
	require.Error(t, err, "a call from no window lists nothing")

	assert.False(t, gone(info.PID))
	listed := fx.ctrl.terminalManager.List(nil, keyA)
	require.Len(t, listed, 1)
	assert.False(t, listed[0].Attached)
}

// What the page sends is checked before anything starts, in words that name the field.
func TestACreateWithAPageKeyThatIsNotOneOrALeaseThatIsTooLongStartsNothing(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	for _, bad := range []struct {
		launch terminal.Launch
		field  string
	}{
		{terminal.Launch{PageKey: "short"}, "page_key"},
		{terminal.Launch{PageKey: keyA, LeaseMs: int(terminal.LeaseMax/time.Millisecond) + 1}, "lease_ms"},
		{terminal.Launch{LeaseMs: 1000}, "lease_ms"},
	} {
		_, err := fx.wrapper.CreateTerminal(fx.ctx(page), execsdk.SessionOptions{Command: shell(t)}, bad.launch)
		var app *apperror.AppError
		require.ErrorAs(t, err, &app)
		assert.Equal(t, "INVALID_REQUEST", app.Code)
		assert.Contains(t, app.Detail, bad.field)
	}
	assert.Empty(t, fx.ctrl.terminalManager.ListSessions())
	assert.Zero(t, fx.indexed())
}

// The calls cross the binding as JSON: the request names its fields, and an absent offset is absent.
func TestTheAttachRequestAndTheDetachRequestAreTheirJSONNames(t *testing.T) {
	var request terminal.AttachRequest
	require.NoError(t, json.Unmarshal([]byte(`{"page_key":"`+keyA+`","from_offset":12}`), &request))
	assert.Equal(t, keyA, request.PageKey)
	require.NotNil(t, request.FromOffset)
	assert.Equal(t, uint64(12), *request.FromOffset)
	var bare terminal.AttachRequest
	require.NoError(t, json.Unmarshal([]byte(`{}`), &bare))
	assert.Nil(t, bare.FromOffset, "absent is not zero: zero would ask for everything the host kept")
	var detach terminal.DetachRequest
	require.NoError(t, json.Unmarshal([]byte(`{"page_key":"`+keyA+`","lease_ms":60000}`), &detach))
	assert.Equal(t, 60000, detach.LeaseMs)

	raw, err := json.Marshal(terminal.Attached{Replay: terminal.Replay{Start: 1, End: 4, Data: []byte("abc")}})
	require.NoError(t, err)
	var wire map[string]any
	require.NoError(t, json.Unmarshal(raw, &wire))
	replay, ok := wire["replay"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "YWJj", replay["data"], "the replay's bytes are base64 text, as the output's are")
	assert.InDelta(t, 4, replay["end"], 0)
	assert.Contains(t, replay, "start_size")
	assert.Contains(t, replay, "start_modes")
	assert.NotContains(t, wire, "ended", "a terminal that has not ended says nothing of an end")
}

// DetachTerminal leaves the terminal waiting at once, without the page being retired; the lease it answers is
// the lease that applies, and the same page attaches it again.
func TestDetachTerminalLeavesTheTerminalWaitingForTheLeaseAndAnAttachTakesItBack(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	info, err := fx.openKeyed(page, keyA, 90000, `printf 'x\n'; read x`)
	require.NoError(t, err)
	assert.Equal(t, 90000, info.LeaseMs)

	detached, err := fx.wrapper.DetachTerminal(fx.ctx(page), info.ID, terminal.DetachRequest{})
	require.NoError(t, err)
	assert.Equal(t, 90000, detached.LeaseMs)
	assert.WithinDuration(t, time.Now().Add(90*time.Second), time.UnixMilli(detached.LeaseExpiresUnixMs), 5*time.Second)
	fx.detached(info.ID)
	assert.False(t, listedAttached(t, fx, page), "the page that detached it no longer has it")

	// The page no longer owns it, so it says whose it is: the key.
	long, err := fx.wrapper.DetachTerminal(fx.ctx(page), info.ID, terminal.DetachRequest{PageKey: keyA, LeaseMs: 1 << 30})
	require.NoError(t, err)
	assert.Equal(t, detached, long, "a terminal that is detached stays as it is")

	_, err = fx.wrapper.AttachTerminal(fx.ctx(page), info.ID, terminal.AttachRequest{PageKey: keyA})
	require.NoError(t, err)
	assert.True(t, listedAttached(t, fx, page))
}

// The host quitting ends the terminals nobody is attached to, with the others.
func TestTheHostQuittingEndsADetachedTerminal(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	info := fx.mustOpenKeyed(page, keyA, `read x`)
	fx.retire(page)
	fx.detached(info.ID)

	fx.ctrl.terminalManager.Shutdown()
	require.Eventually(t, func() bool { return gone(info.PID) }, 20*time.Second, 5*time.Millisecond)
	ends := fx.closes(info.ID)
	require.Len(t, ends, 1)
	assert.Equal(t, terminal.ClosedByShutdown, ends[0].ClosedBy)
	assert.Zero(t, fx.indexed())
}

// A lease that runs out ends the terminal the way a close does, and its CLOSE says why.
func TestALeaseThatRunsOutEndsTheDetachedTerminalAndItsCloseSaysSo(t *testing.T) {
	fx := newTerminalFixture(t)
	page := fx.page(1)
	info, err := fx.openKeyed(page, keyA, 300, `printf 'x\n'; read y`)
	require.NoError(t, err)
	fx.retire(page)
	require.Eventually(t, func() bool { return len(fx.closes(info.ID)) == 1 }, 30*time.Second, 5*time.Millisecond)
	end := fx.closes(info.ID)[0]
	assert.Equal(t, terminal.EndClosed, end.Reason)
	assert.Equal(t, terminal.ClosedByDetachTimeout, end.ClosedBy)
	assert.Positive(t, end.LastOffset, "and it says how long the output was")
	require.Eventually(t, func() bool { return gone(info.PID) }, 20*time.Second, 5*time.Millisecond)
	assert.Empty(t, fx.listed(fx.page(2), keyA))
}

// The window can go while its terminal starts. A terminal with a page key that is made after the window was
// retired is ended, whatever its key says (the call that made it is told it failed, so nobody could ever attach
// it); one made before is detached by the retirement, and it was made, so its page may come back. At the end of
// the quarter-hundred of them no shell is left that was refused, and every one that was made is detached.
func TestAWindowRetiredWhileItsKeyedTerminalStartsEndsItOrDetachesItAndNeverLeaksIt(t *testing.T) {
	fx := newTerminalFixture(t)
	var mu sync.Mutex
	made := map[string]int{}
	command := shell(t)
	for i := range 25 {
		page := fx.page(uint(300 + i))
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			info, err := fx.wrapper.CreateTerminal(fx.ctx(page), execsdk.SessionOptions{Command: append(command, "-c", "read x")}, terminal.Launch{PageKey: keyA})
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				made[info.ID] = info.PID
			}
		}()
		go func() {
			defer wg.Done()
			time.Sleep(time.Duration(rand.IntN(25)) * time.Millisecond)
			fx.retire(page)
		}()
		wg.Wait()
	}
	require.Eventually(t, func() bool {
		listed := fx.ctrl.terminalManager.List(nil, keyA)
		for _, one := range listed {
			if one.Attached {
				return false
			}
		}
		return len(listed) == len(made)
	}, 60*time.Second, 10*time.Millisecond, "every terminal that was made is detached and kept: a retirement found it")
	if left, ok := children(t); ok {
		assert.Len(t, left, len(made), "no shell is left but the detached terminals that were made")
	}
	fx.ctrl.terminalManager.Shutdown()
	require.Eventually(t, func() bool {
		remaining, ok := children(t)
		return !ok || len(remaining) == 0
	}, 30*time.Second, 20*time.Millisecond)
	assert.Zero(t, fx.indexed())
}

// retiringRealm is the window realm, but a window is refused from the admission after the ones that are let through:
// the window is retired after the call began, at the one moment a retirement can slip between two steps of it.
type retiringRealm struct {
	WindowRealm
	mu    sync.Mutex
	after int
	calls int
	// onRefuse runs at the refusal, before it is answered: something that happens at that moment.
	onRefuse func()
}

func (r *retiringRealm) AdmitWindow(window application.Window) (*invocation.Scope, error) {
	r.mu.Lock()
	r.calls++
	refuse := r.calls > r.after
	r.mu.Unlock()
	if refuse {
		if r.onRefuse != nil {
			r.onRefuse()
		}
		return nil, invocation.ErrWindowUnavailable
	}
	return r.WindowRealm.AdmitWindow(window)
}

// A window retired after the shell started and before the create answered: the retirement found nothing to
// release (or detached the terminal, which a page that never heard of it could never attach), so the create
// ends the terminal itself, whatever its key, and says it failed.
func TestAWindowRetiredBetweenTheStartAndTheAnswerOfACreateEndsItsKeyedTerminal(t *testing.T) {
	fx := newTerminalFixture(t)
	fx.wrapper = &ServiceWrapper{Ctrl: fx.ctrl, Realm: &retiringRealm{WindowRealm: fx.realm, after: 1}}
	page := fx.page(1)
	_, err := fx.openKeyed(page, keyA, 0, `read x`)
	require.ErrorIs(t, err, invocation.ErrWindowUnavailable)

	require.Eventually(t, func() bool { return len(fx.ctrl.terminalManager.ListSessions()) == 0 }, 20*time.Second, 5*time.Millisecond,
		"the terminal the failed create made is ended, not detached and kept for a page that never heard of it")
	if left, ok := children(t); ok {
		assert.Empty(t, left)
	}
	assert.Zero(t, fx.indexed())
}

// A window retired after it took a terminal over and before the attach answered: the terminal is detached again,
// not left attached to a window that is gone.
func TestAWindowRetiredBetweenTheTakeOverAndTheAnswerOfAnAttachLeavesTheTerminalDetached(t *testing.T) {
	fx := newTerminalFixture(t)
	first := fx.page(1)
	info := fx.mustOpenKeyed(first, keyA, `read x`)
	fx.retire(first)
	fx.detached(info.ID)

	fx.wrapper = &ServiceWrapper{Ctrl: fx.ctrl, Realm: &retiringRealm{WindowRealm: fx.realm, after: 1}}
	second := fx.page(2)
	_, err := fx.wrapper.AttachTerminal(fx.ctx(second), info.ID, terminal.AttachRequest{PageKey: keyA})
	require.ErrorIs(t, err, invocation.ErrWindowUnavailable)

	assert.False(t, gone(info.PID))
	listed := fx.ctrl.terminalManager.List(nil, keyA)
	require.Len(t, listed, 1)
	assert.False(t, listed[0].Attached, "the terminal is detached again: it waits for a page that is there")
}

// A failed create ends its own terminal, but not one that another window took over in the meantime (a page with
// the same key, which chose the id): the cleanup depends on who owns the terminal.
func TestAFailedCreateDoesNotEndATerminalAnotherWindowTookOver(t *testing.T) {
	fx := newTerminalFixture(t)
	second := fx.page(2)
	realm := &retiringRealm{WindowRealm: fx.realm, after: 1}
	var attachErr error
	realm.onRefuse = func() {
		_, attachErr = fx.ctrl.terminalManager.Attach("taken-over-1", invocation.IdentityOf(second), terminal.AttachRequest{PageKey: keyA})
	}
	fx.wrapper = &ServiceWrapper{Ctrl: fx.ctrl, Realm: realm}
	first := fx.page(1)
	_, err := fx.wrapper.CreateTerminal(fx.ctx(first),
		execsdk.SessionOptions{ID: "taken-over-1", Command: append(shell(t), "-c", "read x")}, terminal.Launch{PageKey: keyA})
	require.ErrorIs(t, err, invocation.ErrWindowUnavailable)
	require.NoError(t, attachErr)

	listed := fx.ctrl.terminalManager.List(nil, keyA)
	require.Len(t, listed, 1)
	assert.True(t, listed[0].Attached, "the page that took it over keeps it")
	assert.Empty(t, fx.closes("taken-over-1"))
}
