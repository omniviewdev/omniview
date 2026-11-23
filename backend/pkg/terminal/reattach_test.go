//go:build !windows

package terminal

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// 1. OFFSETS ON THE OUTPUT.

// The output of a terminal with a page key comes with its offset, each event where the one before ended; the
// output of any other terminal comes as it always did.
func TestTheOutputOfATerminalWithAPageKeyCarriesItsOffsetAndAnyOthersDoesNot(t *testing.T) {
	m, sink := newPageManager(t)
	keyed := m.startKeyed(t, `printf 'one\n'; printf 'two\n'; sleep 30`, "window", Options{})
	plain, err := m.Start(Options{Command: []string{sh(t), "-c", `printf 'three\n'; sleep 30`}}, "window")
	require.NoError(t, err)

	sink.waitFor(t, keyed.ID, "two\r\n")
	assert.Equal(t, "one\r\ntwo\r\n", string(sink.stream(t, keyed.ID)), "each event starts where the one before ended")
	sink.mu.Lock()
	assert.Equal(t, uint64(0), sink.events[keyed.ID][0].offset, "the first byte is offset 0")
	sink.mu.Unlock()
	assert.Zero(t, sink.plainCalls(keyed.ID), "a terminal with a key is delivered with offsets, and only so")

	require.Eventually(t, func() bool { return sink.plainCalls(plain.ID) > 0 }, 20*time.Second, 5*time.Millisecond, "any other terminal's output goes to Output, as before")
	assert.Empty(t, sink.raw(plain.ID), "and carries no offset")
}

// The end says how long the output was, in the same numbering, for every terminal.
func TestTheEndOfATerminalSaysHowManyBytesItWrote(t *testing.T) {
	m, sink := newPageManager(t)
	keyed := m.startKeyed(t, `printf 'one\ntwo\n'`, "window", Options{})
	plain, err := m.Start(Options{Command: []string{sh(t), "-c", `printf 'one\ntwo\nthree\n'`}}, "window")
	require.NoError(t, err)

	end := sink.waitEnd(t, keyed.ID)
	assert.Equal(t, EndExited, end.Reason)
	assert.Equal(t, uint64(len("one\r\ntwo\r\n")), end.LastOffset)
	assert.Equal(t, uint64(len("one\r\ntwo\r\n")), uint64(len(sink.stream(t, keyed.ID))), "and it is the length of the events")
	assert.Equal(t, uint64(len("one\r\ntwo\r\nthree\r\n")), sink.waitEnd(t, plain.ID).LastOffset)
}

// 2. DETACH IS NOT DESTROY.

// A window that goes away detaches the terminals that have a page key and ends the others, as it always did.
func TestAWindowGoingAwayDetachesATerminalWithAPageKeyAndEndsAnyOther(t *testing.T) {
	m, sink := newPageManager(t)
	keyed := m.startKeyed(t, `printf 'k\n'; sleep 30`, "w1", Options{})
	plain, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, "w1")
	require.NoError(t, err)
	foreign := m.startKeyed(t, `sleep 30`, "w2", Options{PageKey: otherTestKey})
	sink.waitFor(t, keyed.ID, "k\r\n")

	got := m.ReleaseOwned("w1", ClosedByWindow)
	assert.Equal(t, Released{Detached: 1, Ended: 1}, got)
	end := sink.waitEnd(t, plain.ID)
	assert.Equal(t, EndClosed, end.Reason)
	assert.Equal(t, ClosedByWindow, end.ClosedBy)
	requireGone(t, plain.PID, "the terminal without a key")

	assert.False(t, gone(keyed.PID), "the terminal with a key is alive")
	assert.Empty(t, sink.closes(keyed.ID), "and nobody was told it ended")
	listed := m.List(nil, testKey)
	require.Len(t, listed, 1)
	assert.Equal(t, keyed.ID, listed[0].ID)
	assert.Equal(t, keyed.PID, listed[0].PID)
	assert.False(t, listed[0].Attached)
	assert.Equal(t, Size{Cols: DefaultCols, Rows: DefaultRows}, listed[0].Size)
	assert.Equal(t, uint64(len("k\r\n")), listed[0].NextOffset)
	assert.Zero(t, listed[0].ReplayStart)
	assert.Nil(t, listed[0].Ended)
	expires := time.UnixMilli(listed[0].LeaseExpiresUnixMs)
	assert.WithinDuration(t, time.Now().Add(LeaseDefault), expires, 5*time.Second, "kept for the default lease, five minutes")

	assert.False(t, gone(foreign.PID), "another window's terminal is untouched")
	assert.Equal(t, Released{Detached: 0, Ended: 0}, m.ReleaseOwned("w1", ClosedByWindow), "nothing is left to release")
}

// A window that took the terminal over is its owner now: the retirement of the one that left it, which comes
// later (a server-mode page is retired seconds after its socket went), finds nothing of its own.
func TestALateRetirementOfThePageThatLeftDoesNotDetachWhatAnotherPageTookOver(t *testing.T) {
	m, _ := newPageManager(t)
	info := m.startKeyed(t, `sleep 30`, "w1", Options{})
	_, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	assert.Equal(t, Released{Detached: 0, Ended: 0}, m.ReleaseOwned("w1", ClosedByWindow))
	detached, owner, _, _ := m.session(t, info.ID).state()
	assert.False(t, detached)
	assert.Equal(t, Owner("w2"), owner)
	assert.Equal(t, Released{Detached: 1, Ended: 0}, m.ReleaseOwned("w2", ClosedByWindow))
}

// 3. THE ATTACH REPLY.

// A page that was away gets what the terminal wrote meanwhile, exactly, the facts of the terminal now, and
// then its live output from the offset the reply ends at. A terminal nobody is attached to is not read, but for
// the one read that was in flight when it was detached (the shell was idle: it returns with the next thing the
// shell writes); what comes after waits in the pty for the page: the host holds nothing for it.
func TestAnAttachHandsOverWhatTheTerminalWroteMeanwhileAndWhatItWritesNext(t *testing.T) {
	m, sink := newPageManager(t)
	page := newTestPage(m, "terminal-1")
	sink.setHook(func(_ string, offset uint64, data []byte) { page.take(offset, data) })
	info := m.startKeyed(t, `printf 'A\n'; read x; printf 'B:%s\n' "$x"; read y; read z; printf 'C:%s%s\n' "$y" "$z"; read w`, "w1", Options{ID: "terminal-1", Cols: 100, Rows: 30})
	sink.waitFor(t, info.ID, "A\r\n")
	require.Eventually(t, func() bool { return page.have() == uint64(len("A\r\n")) }, 20*time.Second, 5*time.Millisecond)

	// The page is deaf from here on, and the shell goes on: what it writes is read, kept, and sent to nobody.
	page.die()
	require.NoError(t, m.Write(info.ID, 0, []byte("x\n")))
	sink.waitFor(t, info.ID, "B:x\r\n")
	m.ReleaseOwned("w1", ClosedByWindow)
	quiet(t, m, info.ID)

	// The read that was in flight returns with the echo of what is typed next, and nothing is read after it.
	require.NoError(t, m.Write(info.ID, 0, []byte("y\n")))
	time.Sleep(300 * time.Millisecond)
	require.NoError(t, m.Write(info.ID, 0, []byte("z\n")))
	time.Sleep(300 * time.Millisecond)
	assert.NotContains(t, sink.raw(info.ID), "z\r\n", "nobody is attached: the host reads nothing more")
	assert.NotContains(t, sink.raw(info.ID), "C:yz")

	att := page.comeBack(t, "w2", testKey)
	assert.Equal(t, uint64(len("A\r\n")), att.Replay.Start, "the replay starts at the offset the page had")
	assert.Contains(t, []string{"x\r\nB:x\r\n", "x\r\nB:x\r\ny\r\n"}, string(att.Replay.Data),
		"and holds what it missed: what the host had read, with or without the echo that the read in flight took")
	assert.Equal(t, att.Replay.Start+uint64(len(att.Replay.Data)), att.Replay.End)
	assert.Equal(t, info.PID, att.Session.PID)
	assert.Equal(t, info.ID, att.Session.ID)
	assert.Equal(t, info.Shell, att.Session.Shell)
	assert.Equal(t, Size{Cols: 100, Rows: 30}, att.Replay.Size)
	assert.Equal(t, StateIdle, att.Busy.State, "the shell holds the terminal")
	assert.Nil(t, att.Ended)
	if att.Cwd.Reason == "" {
		assert.Equal(t, physical(t, os.Getenv("HOME")), att.Cwd.Path, "where the shell is now")
	}

	require.Eventually(t, func() bool { return strings.HasSuffix(string(page.bytes()), "C:yz\r\n") }, 20*time.Second, 5*time.Millisecond)
	assert.Equal(t, string(sink.stream(t, info.ID)), string(page.bytes()), "the page has all of it, in order, once")
	gaps, _, partial := page.faults()
	assert.Zero(t, gaps)
	assert.Zero(t, partial)
}

// The reply says the size the terminal has now, and the size its first replayed byte was written for.
func TestAnAttachSaysTheSizeTheTerminalHasNowAndTheSizeTheReplayStartedAt(t *testing.T) {
	m, sink := newPageManager(t)
	info := m.startKeyed(t, `printf 'start\n'; read x; printf 'after\n'; sleep 30`, "w1", Options{Cols: 90, Rows: 20})
	sink.waitFor(t, info.ID, "start\r\n")
	require.NoError(t, m.Resize(info.ID, 0, 40, 120))
	require.NoError(t, m.Write(info.ID, 0, []byte("go\n")))
	sink.waitFor(t, info.ID, "after\r\n")
	m.ReleaseOwned("w1", ClosedByWindow)
	quiet(t, m, info.ID)

	all, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	assert.Equal(t, Size{Cols: 90, Rows: 20}, all.Replay.StartSize, "the output starts at the size the terminal opened at")
	assert.Equal(t, Size{Cols: 120, Rows: 40}, all.Replay.Size, "and it is this size now")

	resizedAt := uint64(len("start\r\n"))
	before, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey, FromOffset: new(resizedAt - 1)})
	require.NoError(t, err)
	assert.Equal(t, Size{Cols: 90, Rows: 20}, before.Replay.StartSize, "a byte before the resize was written for the size before it")
	after, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey, FromOffset: new(resizedAt)})
	require.NoError(t, err)
	assert.Equal(t, Size{Cols: 120, Rows: 40}, after.Replay.StartSize, "and the output after it for the size after")
}

// The modes a program switched on before the page was away are in the reply, also when the bytes that switched
// them on have fallen out of the ring: the modes at the start of the replay say so.
func TestAnAttachSaysTheModesAProgramSwitchedOnEvenAfterTheirBytesFellOutOfTheRing(t *testing.T) {
	m, sink := newPageManager(t)
	m.replayBytes = 2 * chunkBytes
	info := m.startKeyed(t, `printf '\033[?1049h\033[?1000h\033[?1006h\033[?2004h'; head -c 600000 /dev/zero | tr '\0' 'x'; printf 'end\n'; sleep 30`, "w1", Options{})
	sink.waitFor(t, info.ID, "end\r\n")
	m.ReleaseOwned("w1", ClosedByWindow)
	quiet(t, m, info.ID)

	att, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	assert.Positive(t, att.Replay.Start, "the ring is smaller than the output: its start has moved")
	want := TerminalModes{Known: true, AltScreen: true, BracketedPaste: true, MouseTracking: MouseClick, MouseEncoding: MouseSGR, KittyKeyboard: []int{}}
	assert.Equal(t, want, att.Replay.StartModes, "the modes in force where the replay starts")
	assert.Equal(t, want, att.Replay.Modes, "and now")
	assert.LessOrEqual(t, len(att.Replay.Data), 2*chunkBytes, "the ring is bounded")
	assert.Contains(t, string(att.Replay.Data), "end\r\n")
}

// 4. WHO MAY ATTACH.

// The key, or the window that owns the terminal, attaches; nothing lists another page's terminals; and what a
// caller who may not is told is what it is told of a terminal that is not there.
func TestOnlyTheKeyOrTheOwningWindowAttachesAndNothingListsAnotherPagesTerminals(t *testing.T) {
	m, _ := newPageManager(t)
	mine := m.startKeyed(t, `sleep 30`, "wA", Options{PageKey: testKey})
	theirs := m.startKeyed(t, `sleep 30`, "wB", Options{PageKey: otherTestKey})
	m.ReleaseOwned("wA", ClosedByWindow)

	notFound := func(id, key string, caller Owner) {
		t.Helper()
		_, err := m.Attach(id, caller, AttachRequest{PageKey: key})
		require.Error(t, err)
		app := appErr(t, err)
		assert.Equal(t, apperror.TypeSessionNotFound, app.Type, "key %q, caller %v", key, caller)
	}
	notFound(mine.ID, otherTestKey, "wC")
	notFound(mine.ID, "", "wC")
	notFound(mine.ID, testKey[:len(testKey)-1], "wC")
	notFound(mine.ID, strings.ToUpper(testKey), "wC")
	notFound(mine.ID, "", nil)
	notFound("no-such-session", testKey, "wC")
	_, err := m.Detach(mine.ID, "wC", DetachRequest{PageKey: otherTestKey})
	assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, err).Type)

	assert.Equal(t, []string{mine.ID}, ids(m.List("wC", testKey)))
	assert.Equal(t, []string{theirs.ID}, ids(m.List("wC", otherTestKey)))
	assert.Empty(t, m.List("wC", ""), "no key, no window of its own: nothing")
	assert.Empty(t, m.List("wC", "page-a-key-nobody-has-0000"))
	assert.Equal(t, []string{theirs.ID}, ids(m.List("wB", "")), "the window that owns a terminal lists it without the key")
	assert.Empty(t, m.List("wA", ""), "and a window that no longer owns one does not")
	raw, err := json.Marshal(m.List(nil, testKey))
	require.NoError(t, err)
	assert.NotContains(t, string(raw), testKey, "the key is never listed")

	owned, err := m.Attach(theirs.ID, "wB", AttachRequest{})
	require.NoError(t, err, "a window that owns the terminal needs no key")
	assert.Equal(t, theirs.PID, owned.Session.PID)
	keyed, err := m.Attach(mine.ID, "wC", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	assert.Equal(t, mine.PID, keyed.Session.PID)
	assert.Equal(t, []string{mine.ID}, ids(m.List("wC", testKey)))
	assert.True(t, m.List("wC", testKey)[0].Attached)
}

func ids(listed []Listed) []string {
	out := make([]string, 0, len(listed))
	for _, l := range listed {
		out = append(out, l.ID)
	}
	return out
}

// A terminal that was opened without a key cannot be attached or detached: the host says so, and an empty
// key never opens a terminal that has none.
func TestATerminalWithoutAPageKeyCannotBeAttachedOrDetached(t *testing.T) {
	m, _ := newPageManager(t)
	info, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, "w1")
	require.NoError(t, err)
	assert.Zero(t, info.LeaseMs, "such a terminal has no lease")

	_, err = m.Attach(info.ID, "w1", AttachRequest{})
	assert.Equal(t, "NOT_REATTACHABLE", appErr(t, err).Code, "the owner is told why")
	_, err = m.Detach(info.ID, "w1", DetachRequest{})
	assert.Equal(t, "NOT_REATTACHABLE", appErr(t, err).Code)
	_, err = m.Attach(info.ID, "w2", AttachRequest{PageKey: ""})
	assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, err).Type, "an empty key is not a key, and a stranger learns nothing")
	assert.Empty(t, m.List("w1", ""), "it is not listed: there is nothing a page could do with it")
}

// 5. WHAT A TERMINAL IS OPENED WITH.

func TestAPageKeyAndALeaseAreCheckedBeforeAnythingStarts(t *testing.T) {
	m, _ := newPageManager(t)
	command := []string{sh(t), "-c", `sleep 30`}
	refused := func(opts Options, field string) {
		t.Helper()
		opts.Command = command
		_, err := m.Start(opts, "w1")
		require.Error(t, err)
		app := appErr(t, err)
		assert.Equal(t, "INVALID_REQUEST", app.Code)
		assert.Contains(t, app.Detail, field, "the refusal names the field")
	}
	refused(Options{PageKey: "too-short"}, "page_key")
	refused(Options{PageKey: strings.Repeat("k", MaxPageKeyBytes+1)}, "page_key")
	refused(Options{PageKey: "has a space in it 0123"}, "page_key")
	refused(Options{PageKey: "control\x01character-0123"}, "page_key")
	refused(Options{PageKey: "ünïcode-key-0123456789"}, "page_key")
	refused(Options{PageKey: testKey, LeaseMs: -1}, "lease_ms")
	refused(Options{PageKey: testKey, LeaseMs: int(LeaseMax/time.Millisecond) + 1}, "lease_ms")
	refused(Options{LeaseMs: 1000}, "lease_ms")
	assert.Empty(t, m.running(), "nothing started")

	for _, lease := range []int{0, 1, 1000, int(LeaseMax / time.Millisecond)} {
		info, err := m.Start(Options{Command: command, PageKey: testKey, LeaseMs: lease}, "w1")
		require.NoError(t, err)
		want := lease
		if lease == 0 {
			want = int(LeaseDefault / time.Millisecond)
		}
		assert.Equal(t, want, info.LeaseMs)
		assert.Equal(t, int(LeaseDefault/time.Millisecond), info.Limits.LeaseDefaultMs)
		assert.Equal(t, int(LeaseMax/time.Millisecond), info.Limits.LeaseMaxMs)
		assert.Equal(t, ReplayBytes, info.Limits.ReplayBytes)
	}
}

// 6. THE LEASE.

// DetachTerminal leaves the terminal for the lease of the terminal, or the one asked for, cut to the most; the
// answer says which applies; detaching a detached terminal changes nothing.
func TestDetachKeepsTheTerminalForALeaseThatIsCutToTheMostAndIsIdempotent(t *testing.T) {
	m, _ := newPageManager(t)
	opened := m.startKeyed(t, `sleep 30`, "w1", Options{LeaseMs: 120000})
	assert.Equal(t, 120000, opened.LeaseMs)
	first, err := m.Detach(opened.ID, "w1", DetachRequest{})
	require.NoError(t, err)
	assert.Equal(t, 120000, first.LeaseMs, "the terminal's own lease")
	assert.WithinDuration(t, time.Now().Add(120*time.Second), time.UnixMilli(first.LeaseExpiresUnixMs), 5*time.Second)
	again, err := m.Detach(opened.ID, nil, DetachRequest{PageKey: testKey, LeaseMs: 5000})
	require.NoError(t, err, "the key detaches as the owner does")
	assert.Equal(t, first, again, "a detached terminal stays as it is")
	assert.Equal(t, first.LeaseExpiresUnixMs, m.List(nil, testKey)[0].LeaseExpiresUnixMs)

	long := m.startKeyed(t, `sleep 30`, "w1", Options{})
	asked, err := m.Detach(long.ID, "w1", DetachRequest{LeaseMs: 99 * 3600 * 1000})
	require.NoError(t, err)
	assert.Equal(t, int(LeaseMax/time.Millisecond), asked.LeaseMs, "cut to the most, and the answer says so")
	short := m.startKeyed(t, `sleep 30`, "w1", Options{})
	got, err := m.Detach(short.ID, "w1", DetachRequest{LeaseMs: 2500})
	require.NoError(t, err)
	assert.Equal(t, 2500, got.LeaseMs)
	assert.WithinDuration(t, time.Now().Add(2500*time.Millisecond), time.UnixMilli(got.LeaseExpiresUnixMs), 2*time.Second)
}

// A lease that runs out ends the terminal the way a close does: the shell is hung up, what ignored the hangup
// is killed after the grace, one CLOSE says why, and no process is left.
func TestALeaseThatRunsOutEndsTheTerminalTheWayACloseDoes(t *testing.T) {
	m, sink := newPageManager(t)
	polite := m.startKeyed(t, `printf 'hello\n'; sleep 60`, "w1", Options{LeaseMs: 300})
	stubborn := m.startKeyed(t, `trap '' HUP; printf 'ready\n'; while :; do sleep 1; done`, "w1", Options{LeaseMs: 300})
	sink.waitFor(t, polite.ID, "hello\r\n")
	sink.waitFor(t, stubborn.ID, "ready\r\n")
	started := time.Now()
	assert.Equal(t, Released{Detached: 2, Ended: 0}, m.ReleaseOwned("w1", ClosedByWindow))

	for _, info := range []Session{polite, stubborn} {
		end := sink.waitEnd(t, info.ID)
		assert.Equal(t, EndClosed, end.Reason, info.ID)
		assert.Equal(t, ClosedByDetachTimeout, end.ClosedBy, info.ID)
		assert.Positive(t, end.LastOffset)
		requireGone(t, info.PID, "the terminal whose lease ran out")
	}
	assert.GreaterOrEqual(t, time.Since(started), 300*time.Millisecond, "not before the lease")
	assert.Empty(t, m.List(nil, testKey), "nothing is left to list")
	require.Eventually(t, func() bool { return len(m.running()) == 0 }, 20*time.Second, 5*time.Millisecond)
	_, err := m.Attach(polite.ID, "w2", AttachRequest{PageKey: testKey})
	assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, err).Type)
}

// An attach before the lease ends renews it: the old one does nothing when it comes, and the next detach starts
// a lease of its own.
func TestAnAttachBeforeTheLeaseEndsKeepsTheTerminalAndTheNextDetachStartsANewLease(t *testing.T) {
	m, sink := newPageManager(t)
	info := m.startKeyed(t, `printf 'up\n'; sleep 60`, "w1", Options{LeaseMs: 700})
	sink.waitFor(t, info.ID, "up\r\n")
	m.ReleaseOwned("w1", ClosedByWindow)
	time.Sleep(350 * time.Millisecond)
	_, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	time.Sleep(1200 * time.Millisecond)
	assert.False(t, gone(info.PID), "the first lease ran out while the terminal was attached: it did nothing")
	assert.Empty(t, sink.closes(info.ID))
	detached, _, _, _ := m.session(t, info.ID).state()
	assert.False(t, detached)

	started := time.Now()
	m.ReleaseOwned("w2", ClosedByWindow)
	end := sink.waitEnd(t, info.ID)
	assert.Equal(t, ClosedByDetachTimeout, end.ClosedBy)
	assert.GreaterOrEqual(t, time.Since(started), 700*time.Millisecond, "the second lease is a whole one")
	requireGone(t, info.PID, "the terminal")
}

// The timer of a lease that an attach ended can fire late, after the terminal was detached again and a new
// lease runs: it is not the new lease's to end. (A timer that is stopped does not fire; one that already fired
// and waits for the session's lock does, and this is that.)
func TestTheExpiryOfALeaseThatWasEndedDoesNothingEvenWhenTheTerminalWasDetachedAgain(t *testing.T) {
	m, sink := newPageManager(t)
	info := m.startKeyed(t, `sleep 60`, "w1", Options{LeaseMs: 600000})
	s := m.session(t, info.ID)
	m.ReleaseOwned("w1", ClosedByWindow)
	_, _, _, stale := s.state()
	_, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	m.ReleaseOwned("w2", ClosedByWindow)
	detached, _, timer, current := s.state()
	require.True(t, detached)
	require.True(t, timer)
	require.NotEqual(t, stale, current)

	s.expire(stale)
	time.Sleep(300 * time.Millisecond)
	assert.False(t, gone(info.PID), "the first lease's timer did not end the terminal that the second lease keeps")
	assert.Empty(t, sink.closes(info.ID))
	stillDetached, _, _, _ := s.state()
	assert.True(t, stillDetached)
}

// An owner that cannot be compared is refused, by its value and not only by its type (a struct with an interface
// field is a comparable type, and comparing two of them panics when the field holds a slice), by every call that
// takes one: nothing panics and nothing starts.
func TestAnOwnerThatCannotBeComparedIsRefusedByEveryCallThatTakesOne(t *testing.T) {
	type holder struct{ v any }
	bad := holder{v: []int{1}}
	m, _ := newPageManager(t)
	_, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, bad)
	assert.Equal(t, "INVALID_REQUEST", appErr(t, err).Code)
	good := m.startKeyed(t, `sleep 30`, holder{v: 1}, Options{})

	assert.NotPanics(t, func() {
		assert.Equal(t, Released{Detached: 0, Ended: 0}, m.ReleaseOwned(bad, ClosedByWindow))
		assert.Empty(t, m.List(bad, ""))
		_, attachErr := m.Attach(good.ID, bad, AttachRequest{})
		assert.Equal(t, "INVALID_REQUEST", appErr(t, attachErr).Code)
		_, detachErr := m.Detach(good.ID, bad, DetachRequest{})
		assert.Equal(t, "INVALID_REQUEST", appErr(t, detachErr).Code)
		assert.Equal(t, Released{Detached: 1, Ended: 0}, m.ReleaseOwned(holder{v: 1}, ClosedByWindow), "a comparable owner of the same type is fine")
	})
}

// The host quitting ends the terminals nobody is attached to, with the others.
func TestTheHostQuittingEndsTheDetachedTerminalsToo(t *testing.T) {
	m, sink := newPageManager(t)
	var infos []Session
	var held []*session
	for range 5 {
		info := m.startKeyed(t, `sleep 60`, "w1", Options{})
		infos = append(infos, info)
		held = append(held, m.session(t, info.ID))
	}
	m.ReleaseOwned("w1", ClosedByWindow)
	m.Shutdown()
	for _, info := range infos {
		end := sink.waitEnd(t, info.ID)
		assert.Equal(t, ClosedByShutdown, end.ClosedBy)
		requireGone(t, info.PID, "a detached terminal at shutdown")
	}
	assert.Empty(t, m.running())
	for _, s := range held {
		_, _, timer, _ := s.state()
		assert.False(t, timer, "no lease timer outlives its terminal")
	}
	assert.Zero(t, m.tombstoneCount())
}

// 7. A TERMINAL THAT ENDS WHILE NOBODY IS ATTACHED.

// Its end and its output are kept for the page that comes back, for the rest of its lease: the CLOSE event went
// to nobody.
func TestATerminalThatEndsWhileNoPageIsAttachedLeavesItsEndAndItsOutputForThePageThatComesBack(t *testing.T) {
	m, sink := newPageManager(t)
	// Input is not echoed: on macOS a process cannot exit while the pty it holds has output nobody reads, and
	// nobody reads while no page is attached.
	info := m.startKeyed(t, `stty -echo; printf 'bye\n'; read x; exit 3`, "w1", Options{})
	sink.waitFor(t, info.ID, "bye\r\n")
	m.ReleaseOwned("w1", ClosedByWindow)
	quiet(t, m, info.ID)
	require.NoError(t, m.Write(info.ID, 0, []byte("go\n")))

	require.Eventually(t, func() bool {
		listed := m.List(nil, testKey)
		return len(listed) == 1 && listed[0].Ended != nil
	}, 30*time.Second, 10*time.Millisecond, "the terminal ended and left its end")
	listed := m.List(nil, testKey)
	require.NotNil(t, listed[0].Ended)
	assert.Equal(t, EndExited, listed[0].Ended.Reason)
	require.NotNil(t, listed[0].Ended.ExitCode)
	assert.Equal(t, 3, *listed[0].Ended.ExitCode)
	assert.False(t, listed[0].Attached)

	for range 2 {
		att, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
		require.NoError(t, err, "it can be attached to again until the lease would have run out")
		require.NotNil(t, att.Ended)
		assert.Equal(t, 3, *att.Ended.ExitCode)
		assert.Equal(t, string(sink.stream(t, info.ID)), string(att.Replay.Data), "all of its output, from the start")
		assert.True(t, strings.HasPrefix(string(att.Replay.Data), "bye\r\n"))
		assert.Equal(t, att.Ended.LastOffset, att.Replay.End, "and the end says where the output ended")
		assert.Equal(t, UnknownReason("ended"), att.Cwd.Reason)
		assert.Equal(t, StateUnknown, att.Busy.State)
		assert.Equal(t, info.PID, att.Session.PID)
	}
	assert.Len(t, sink.closes(info.ID), 1, "the CLOSE event was sent once, to nobody")

	require.NoError(t, m.CloseSession(info.ID), "the page that has read it dismisses it")
	assert.Empty(t, m.List(nil, testKey))
	_, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
	assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, err).Type)
	assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, m.CloseSession(info.ID)).Type, "and it is gone: a second close finds nothing")
}

// The host remembers a bounded number of them; the oldest goes first. Terminals the host ended, and terminals
// without a key, leave nothing.
func TestTheHostRemembersABoundedNumberOfTerminalsThatEndedAndOnlyThoseThatEndedByThemselves(t *testing.T) {
	m, sink := newPageManager(t)
	var infos []Session
	for range TombstoneLimit + 4 {
		info := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "w1", Options{})
		sink.waitFor(t, info.ID, "up\r\n")
		infos = append(infos, info)
	}
	m.ReleaseOwned("w1", ClosedByWindow)
	for _, info := range infos {
		require.NoError(t, m.Write(info.ID, 0, []byte("go\n")))
		sink.waitEnd(t, info.ID)
	}
	listed := m.List(nil, testKey)
	require.Len(t, listed, TombstoneLimit)
	want := make([]string, 0, TombstoneLimit)
	for _, info := range infos[len(infos)-TombstoneLimit:] {
		want = append(want, info.ID)
	}
	assert.ElementsMatch(t, want, ids(listed), "the oldest were forgotten")

	closed := m.startKeyed(t, `sleep 60`, "w2", Options{PageKey: otherTestKey})
	require.NoError(t, m.CloseSession(closed.ID))
	plain, err := m.Start(Options{Command: []string{sh(t), "-c", `exit 0`}}, "w3")
	require.NoError(t, err)
	sink.waitEnd(t, plain.ID)
	timed := m.startKeyed(t, `sleep 60`, "w4", Options{PageKey: otherTestKey, LeaseMs: 100})
	m.ReleaseOwned("w4", ClosedByWindow)
	sink.waitEnd(t, timed.ID)
	assert.Empty(t, m.List(nil, otherTestKey), "a close, a lease that ran out and a terminal without a key leave nothing")
}

// The tombstone of a terminal lives as long as the lease the terminal was detached with, not the one it was
// opened with: a page that was told it has a minute finds the terminal's end for a minute.
func TestATombstoneIsKeptForTheLeaseTheTerminalWasDetachedWith(t *testing.T) {
	m, sink := newPageManager(t)
	info := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "w1", Options{LeaseMs: 700})
	sink.waitFor(t, info.ID, "up\r\n")
	detached, err := m.Detach(info.ID, "w1", DetachRequest{LeaseMs: 60000})
	require.NoError(t, err)
	assert.Equal(t, 60000, detached.LeaseMs)
	require.NoError(t, m.Write(info.ID, 0, []byte("go\n")))
	require.Eventually(t, func() bool {
		listed := m.List(nil, testKey)
		return len(listed) == 1 && listed[0].Ended != nil
	}, 30*time.Second, 10*time.Millisecond, "the terminal ended and left its end")
	assert.WithinDuration(t, time.Now().Add(60*time.Second), time.UnixMilli(m.List(nil, testKey)[0].LeaseExpiresUnixMs), 5*time.Second,
		"kept for the lease it was detached with")
	time.Sleep(1200 * time.Millisecond)
	assert.Len(t, m.List(nil, testKey), 1, "and not forgotten when the lease it was opened with would have run out")
}

// 8. WHAT THE LEGACY ATTACH SEES.

// The old attach, which a window that is not a page of this protocol uses, gets what the terminal wrote, from the
// same ring; the old detach only marks.
func TestTheLegacyAttachReturnsTheOutputFromTheSameRing(t *testing.T) {
	m, _ := newPageManager(t)
	info, err := m.Start(Options{Command: []string{sh(t), "-c", `printf 'legacy\n'; sleep 30`}}, "w1")
	require.NoError(t, err)
	s := m.session(t, info.ID)
	require.Eventually(t, func() bool { return strings.Contains(string(s.readRing()), "legacy\r\n") }, 20*time.Second, 5*time.Millisecond)

	listed, data, err := m.AttachSession(info.ID)
	require.NoError(t, err)
	assert.Equal(t, "legacy\r\n", string(data))
	assert.True(t, listed.Attached)
	after, err := m.DetachSession(info.ID)
	require.NoError(t, err)
	assert.False(t, after.Attached)
}

// readRing is what the legacy attach reads: everything the ring keeps.
func (s *session) readRing() []byte {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	return s.ring.bytes()
}
