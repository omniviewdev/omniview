//go:build !windows

package terminal

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// THE RACES OF OWNERSHIP IN THE MANAGER (T2c-go.md, CodeRabbit on #677).
//
// A window's right to a terminal is read in one step and used in another when a call reads the owner, lets go of the
// lock, and ends the terminal: a window that took the terminal in between (an offer that was used) has its terminal
// ended by a window that no longer holds it. A decision to end a terminal is taken under the lock that reads who holds
// it, in the same step, and a terminal whose end is decided is no one's to claim. Each test forces its two orders: the
// claim lands before the decision, or in the instant after it (Manager.beforeEnd holds the call there), and states
// what must hold at the end whichever came first. The tests that start two calls at once assert the same end states.

// startPlain starts a terminal that has no page key and waits for nothing, for owner.
func (m *Manager) startPlain(t *testing.T, owner Owner) Session {
	t.Helper()
	info, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, owner)
	require.NoError(t, err)
	return info
}

// offered starts a terminal for wA and has wA offer it to the next window that claims it.
func (m *Manager) offered(t *testing.T) Session {
	t.Helper()
	info := m.startPlain(t, "wA")
	require.NoError(t, m.Offer(info.ID, "wA", OfferTTL))
	return info
}

// 1. THE RETIREMENT OF A WINDOW AND THE CLAIM OF ITS TERMINAL.

// A window that retires ends the terminals it holds that have no page key. A window that claims one of them, because
// its owner offered it (the move of a tab to a new window, whose source window may close), holds it, and what the
// retirement ends is what the retiring window held when it decided.
func TestARetiringWindowEndsTheTerminalItHeldAndNeverOneItGaveAway(t *testing.T) {
	t.Run("the claim lands before the retirement decides: the retirement finds nothing of its own", func(t *testing.T) {
		m, sink := newPageManager(t)
		info := m.offered(t)
		require.NoError(t, m.Claim(info.ID, "wB"))

		released := m.ReleaseOwned("wA", ClosedByWindow)

		assert.Equal(t, Released{Detached: 0, Ended: 0}, released, "A held nothing by then")
		require.NoError(t, m.Authorize(info.ID, "wB"), "the terminal is B's")
		assert.Empty(t, sink.closes(info.ID), "and it was not ended")
		assert.False(t, gone(info.PID))
	})
	t.Run("the claim lands in the instant after the retirement decided to end it: it is refused", func(t *testing.T) {
		m, sink := newPageManager(t)
		info := m.offered(t)
		var claim error
		m.beforeEnd = func(id string) { claim = m.Claim(id, "wB") }

		released := m.ReleaseOwned("wA", ClosedByWindow)

		assert.Equal(t, Released{Detached: 0, Ended: 1}, released)
		notFound(t, claim, info.ID)
		end := sink.waitEnd(t, info.ID)
		assert.Equal(t, ClosedByWindow, end.ClosedBy, "it ended with the window that held it")
		notFound(t, m.Authorize(info.ID, "wB"), info.ID)
		requireGone(t, info.PID, "the terminal of the window that retired")
	})
}

// The same two calls started at once: whichever comes first, the end states are the two above and never a mixture (a
// claim that succeeded and a terminal that the retirement ended all the same).
func TestARetirementAndAClaimOfTheSameTerminalAtOnceHaveOneOutcome(t *testing.T) {
	m, sink := newPageManager(t)
	claimed, retired := 0, 0
	for round := range 24 {
		info := m.offered(t)
		var claim error
		var released Released
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 1)))
			claim = m.Claim(info.ID, "wB")
		}()
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 2)))
			released = m.ReleaseOwned("wA", ClosedByWindow)
		}()
		close(start)
		wg.Wait()

		if claim == nil {
			claimed++
			assert.Equal(t, Released{Detached: 0, Ended: 0}, released, "round %d: B claimed it first, so A held nothing", round)
			require.NoError(t, m.Authorize(info.ID, "wB"), "round %d", round)
			assert.Empty(t, sink.closes(info.ID), "round %d: a terminal that B holds was not ended by the retirement of A", round)
			require.NoError(t, m.CloseOwned(info.ID, "wB"), "round %d", round)
			continue
		}
		retired++
		notFound(t, claim, info.ID)
		assert.Equal(t, Released{Detached: 0, Ended: 1}, released, "round %d: the retirement decided first", round)
		end := sink.waitEnd(t, info.ID)
		assert.Equal(t, ClosedByWindow, end.ClosedBy, "round %d", round)
	}
	t.Logf("the claim came first in %d rounds and the retirement in %d", claimed, retired)
}

// A retirement that is announced twice (a window that is retired by its close event and by the sweep) ends a terminal
// once, and says so once.
func TestTwoRetirementsOfTheSameWindowEndATerminalOnceAndSayItOnce(t *testing.T) {
	m, sink := newPageManager(t)
	for round := range 12 {
		info := m.startPlain(t, "wA")
		var first, second Released
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 3)))
			first = m.ReleaseOwned("wA", ClosedByWindow)
		}()
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 4)))
			second = m.ReleaseOwned("wA", ClosedByWindow)
		}()
		close(start)
		wg.Wait()

		assert.Equal(t, 1, first.Ended+second.Ended, "round %d: one retirement ended the terminal and the other found it ended", round)
		sink.waitEnd(t, info.ID)
		requireGone(t, info.PID, "the terminal of the window that retired")
	}
}

// 2. THE END OF A TERMINAL AT THE REQUEST OF A WINDOW AND THE CLAIM OF IT.

// A window that offered its terminal and lost it to the window that claimed it does not end it by a close that was
// authorized while it held it; a close that is decided before the claim is the close of the window that held it, and
// the claim is refused.
func TestAWindowThatGaveATerminalAwayDoesNotEndItAndOneThatEndsItBeforeTheClaimWins(t *testing.T) {
	t.Run("the claim lands before the close decides: the close finds the terminal gone from its window", func(t *testing.T) {
		m, sink := newPageManager(t)
		info := m.offered(t)
		require.NoError(t, m.Claim(info.ID, "wB"))

		notFound(t, m.CloseOwned(info.ID, "wA"), info.ID)

		require.NoError(t, m.Authorize(info.ID, "wB"))
		assert.Empty(t, sink.closes(info.ID))
		assert.False(t, gone(info.PID))
		require.NoError(t, m.CloseOwned(info.ID, "wB"), "the window that holds it ends it")
		assert.Equal(t, ClosedByRequest, sink.waitEnd(t, info.ID).ClosedBy)
	})
	t.Run("the claim lands in the instant after the close decided: it is refused, and the terminal ends", func(t *testing.T) {
		m, sink := newPageManager(t)
		info := m.offered(t)
		var claim error
		m.beforeEnd = func(id string) { claim = m.Claim(id, "wB") }

		require.NoError(t, m.CloseOwned(info.ID, "wA"))

		notFound(t, claim, info.ID)
		assert.Equal(t, ClosedByRequest, sink.waitEnd(t, info.ID).ClosedBy)
		notFound(t, m.Authorize(info.ID, "wB"), info.ID)
		requireGone(t, info.PID, "the terminal that was closed")
	})
	t.Run("a window that does not hold it, and a call from no window, end nothing", func(t *testing.T) {
		m, sink := newPageManager(t)
		info := m.startPlain(t, "wA")

		for _, stranger := range []Owner{"wB", nil, []int{1}} {
			notFound(t, m.CloseOwned(info.ID, stranger), info.ID)
		}
		notFound(t, m.CloseOwned("no-such-session", "wA"), "no-such-session")

		assert.Empty(t, sink.closes(info.ID))
		assert.False(t, gone(info.PID))
	})
}

// The same two calls started at once.
func TestACloseAndAClaimOfTheSameTerminalAtOnceHaveOneOutcome(t *testing.T) {
	m, sink := newPageManager(t)
	claimed, closed := 0, 0
	for round := range 24 {
		info := m.offered(t)
		var claim, closeErr error
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 5)))
			claim = m.Claim(info.ID, "wB")
		}()
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 6)))
			closeErr = m.CloseOwned(info.ID, "wA")
		}()
		close(start)
		wg.Wait()

		if claim == nil {
			claimed++
			notFound(t, closeErr, info.ID)
			require.NoError(t, m.Authorize(info.ID, "wB"), "round %d", round)
			assert.Empty(t, sink.closes(info.ID), "round %d: the close of A did not end the terminal that B claimed", round)
			require.NoError(t, m.CloseOwned(info.ID, "wB"), "round %d", round)
			continue
		}
		closed++
		notFound(t, claim, info.ID)
		require.NoError(t, closeErr, "round %d", round)
		assert.Equal(t, ClosedByRequest, sink.waitEnd(t, info.ID).ClosedBy, "round %d", round)
	}
	t.Logf("the claim came first in %d rounds and the close in %d", claimed, closed)
}

// An offer is used once: of many windows that claim a terminal at the same time exactly one holds it, and the others
// are told what is told of an id that never was.
func TestAnOfferIsUsedByExactlyOneOfManyWindowsThatClaimAtOnce(t *testing.T) {
	const claimants = 8
	m, sink := newPageManager(t)
	for round := range 6 {
		info := m.offered(t)
		errs := make([]error, claimants)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for i := range claimants {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				jitter(rand.New(rand.NewPCG(uint64(round), uint64(100+i))))
				errs[i] = m.Claim(info.ID, i)
			}()
		}
		close(start)
		wg.Wait()

		winners := 0
		for i, err := range errs {
			if err == nil {
				winners++
				require.NoError(t, m.Authorize(info.ID, i), "round %d: the window that claimed it holds it", round)
				continue
			}
			notFound(t, err, info.ID)
		}
		assert.Equal(t, 1, winners, "round %d: an offer is used once", round)
		assert.Len(t, sink.detachments(info.ID), 1, "round %d: the window that gave it away was told once", round)
		require.NoError(t, m.CloseSession(info.ID))
	}
}

// 3. THE END A TERMINAL LEAVES, AND THE WINDOW THAT HOLDS IT.

// A terminal that ended by itself while no page was attached leaves its end for the window that attached it, and that
// window dismisses it. A window that gave the end up by attaching it elsewhere, or that never held it, does not.
func TestTheWindowThatTookTheEndOfATerminalIsTheOneThatDismissesIt(t *testing.T) {
	ended := func(t *testing.T) (*Manager, string) {
		t.Helper()
		m, sink := newPageManager(t)
		keyed := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "wA", Options{})
		sink.waitFor(t, keyed.ID, "up\r\n")
		m.endTheShellWith(keyed.ID, 0, "go\n")
		sink.waitEnd(t, keyed.ID)
		require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, 20*time.Second, 5*time.Millisecond)
		return m, keyed.ID
	}
	t.Run("another window attaches the end first: the window that held it can no longer dismiss it", func(t *testing.T) {
		m, id := ended(t)
		_, err := m.Attach(id, "wB", AttachRequest{PageKey: testKey})
		require.NoError(t, err)

		notFound(t, m.CloseOwned(id, "wA"), id)

		assert.Equal(t, 1, m.tombstoneCount(), "the end is still there for the window that holds it now")
		require.NoError(t, m.CloseOwned(id, "wB"))
		assert.Zero(t, m.tombstoneCount())
	})
	t.Run("the window that holds it dismisses it first: another window finds nothing to attach", func(t *testing.T) {
		m, id := ended(t)

		require.NoError(t, m.CloseOwned(id, "wA"))

		assert.Zero(t, m.tombstoneCount())
		_, err := m.Attach(id, "wB", AttachRequest{PageKey: testKey})
		notFound(t, err, id)
		notFound(t, m.CloseOwned(id, "wA"), id)
	})
	t.Run("the dismissal lands after the end was read for the attach and before it is handed over: the attach is refused", func(t *testing.T) {
		m, id := ended(t)
		var dismiss error
		m.beforeTransfer = func(string) { dismiss = m.CloseOwned(id, "wA") }

		_, err := m.Attach(id, "wB", AttachRequest{PageKey: testKey})

		require.NoError(t, dismiss, "the window that held the end dismissed it: it held it then")
		notFound(t, err, id)
		assert.Zero(t, m.tombstoneCount())
		notFound(t, m.CloseOwned(id, "wB"), id)
	})
}

// The same two calls started at once: the end is dismissed by the window that held it, or it is attached by the other
// and kept for it, and never both.
func TestTheDismissalOfTheEndOfATerminalAndTheAttachOfItAtOnceHaveOneOutcome(t *testing.T) {
	dismissed, attached := 0, 0
	for round := range 12 {
		m, sink := newPageManager(t)
		keyed := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "wA", Options{})
		sink.waitFor(t, keyed.ID, "up\r\n")
		m.endTheShellWith(keyed.ID, 0, "go\n")
		sink.waitEnd(t, keyed.ID)
		require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, 20*time.Second, 5*time.Millisecond)

		var attach, dismiss error
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 7)))
			_, attach = m.Attach(keyed.ID, "wB", AttachRequest{PageKey: testKey})
		}()
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 8)))
			dismiss = m.CloseOwned(keyed.ID, "wA")
		}()
		close(start)
		wg.Wait()

		if attach == nil {
			attached++
			notFound(t, dismiss, keyed.ID)
			assert.Equal(t, 1, m.tombstoneCount(), "round %d: the end that B attached is kept for B", round)
			require.NoError(t, m.CloseOwned(keyed.ID, "wB"), "round %d", round)
			continue
		}
		dismissed++
		notFound(t, attach, keyed.ID)
		require.NoError(t, dismiss, "round %d", round)
		assert.Zero(t, m.tombstoneCount(), "round %d", round)
	}
	t.Logf("the attach came first in %d rounds and the dismissal in %d", attached, dismissed)
}

// 4. AN OFFER THAT IS TAKEN BACK.

// The window that offered its terminal takes the offer back (the drop was refused, the window that was to take the tab went
// away): the next window to claim it finds none, the terminal is still the offering window's, and it can be offered again.
// Only the window that holds the terminal revokes, and an offer that is not open is nothing to take back, and no error.
func TestAnOfferIsTakenBackByTheWindowThatMadeItAndByNoOtherAndOnlyOnce(t *testing.T) {
	m, _ := newPageManager(t)
	info := m.startPlain(t, "wA")

	require.NoError(t, m.Revoke(info.ID, "wA"), "there is no offer to take back, and that is no error")
	require.NoError(t, m.Offer(info.ID, "wA", OfferTTL))
	for _, stranger := range []Owner{"wB", nil, []int{1}} {
		notFound(t, m.Revoke(info.ID, stranger), info.ID)
	}
	notFound(t, m.Revoke("no-such-session", "wA"), "no-such-session")
	require.NoError(t, m.Revoke(info.ID, "wA"))

	notFound(t, m.Claim(info.ID, "wB"), info.ID)
	require.NoError(t, m.Authorize(info.ID, "wA"), "it is still A's")
	require.NoError(t, m.Revoke(info.ID, "wA"), "a second revoke finds nothing and says nothing")
	require.NoError(t, m.Offer(info.ID, "wA", OfferTTL), "and it can be offered again")
	require.NoError(t, m.Claim(info.ID, "wB"))
	notFound(t, m.Revoke(info.ID, "wA"), info.ID)
}

// 5. THE CALLS THAT NAME A TERMINAL BY ITS ID: WHO HOLDS IT AND WHAT THE CALL DOES ARE ONE STEP.
//
// A call that read who holds the terminal, let go of the lock and then acted, lets a window that has just lost the terminal
// (an offer that was used) type into it, resize it or credit its flow after the window that took it has begun to. The
// decision is taken under the session's lock, in the same step as the hand-over of the call to the terminal's input queue
// (which orders it with the other input, and which the new holder's input then follows), and what the call does after that is
// the call of a window that held the terminal when it asked. Manager.afterAdmit holds a call in the instant after the
// decision, to place a claim there.

// sizeOf is the size the terminal of the session has.
func (m *Manager) sizeOf(t *testing.T, id string) (int, int) {
	t.Helper()
	var winsize *unix.Winsize
	require.NoError(t, control(m.session(t, id).master, func(fd int) error {
		var err error
		winsize, err = unix.IoctlGetWinsize(fd, unix.TIOCGWINSZ)
		return err
	}))
	return int(winsize.Row), int(winsize.Col)
}

// Input that was taken in while its window held the terminal is applied before the input of the window that claims the
// terminal in the next instant, and the window that gave the terminal away types nothing into it afterwards.
func TestInputThatWasTakenInBeforeAClaimIsAppliedBeforeTheNewHoldersAndNothingAfterIt(t *testing.T) {
	m, sink := newPageManager(t)
	info := m.startKeyed(t, `stty -echo; cat`, "wA", Options{})
	require.NoError(t, m.Offer(info.ID, "wA", OfferTTL))
	var claimErr, bErr error
	m.afterAdmit = func(id string) {
		m.afterAdmit = nil
		claimErr = m.Claim(id, "wB")
		bErr = m.WriteOwned(id, "wB", 0, []byte("B1\n"))
	}

	require.NoError(t, m.WriteOwned(info.ID, "wA", 0, []byte("A1\n")), "A held the terminal when it typed")
	require.NoError(t, claimErr)
	require.NoError(t, bErr)
	sink.waitFor(t, info.ID, "B1\r\n")
	out := sink.waitFor(t, info.ID, "A1\r\n")
	assert.Less(t, strings.Index(out, "A1"), strings.Index(out, "B1"), "what A typed was in line before B's claim, and B's input follows it: %q", out)

	notFound(t, m.WriteOwned(info.ID, "wA", 0, []byte("A2\n")), info.ID)
	require.NoError(t, m.WriteOwned(info.ID, "wB", 0, []byte("B2\n")))
	assert.NotContains(t, sink.waitFor(t, info.ID, "B2\r\n"), "A2", "A no longer holds the terminal: nothing it types reaches it")
}

// The same for the size of the terminal: the resize that was taken in first is applied first, so the size the terminal ends
// with is the new holder's, and the window that gave the terminal away resizes nothing afterwards.
func TestAResizeThatWasTakenInBeforeAClaimIsAppliedBeforeTheNewHoldersAndNothingAfterIt(t *testing.T) {
	m, _ := newPageManager(t)
	info := m.startKeyed(t, `stty -echo; cat`, "wA", Options{})
	require.NoError(t, m.Offer(info.ID, "wA", OfferTTL))
	var claimErr, bErr error
	m.afterAdmit = func(id string) {
		m.afterAdmit = nil
		claimErr = m.Claim(id, "wB")
		bErr = m.ResizeOwned(id, "wB", 0, 41, 101)
	}

	require.NoError(t, m.ResizeOwned(info.ID, "wA", 0, 31, 91), "A held the terminal when it resized")
	require.NoError(t, claimErr)
	require.NoError(t, bErr)
	rows, cols := m.sizeOf(t, info.ID)
	assert.Equal(t, 41, rows, "the size is the new holder's")
	assert.Equal(t, 101, cols)

	notFound(t, m.ResizeOwned(info.ID, "wA", 0, 32, 92), info.ID)
	rows, cols = m.sizeOf(t, info.ID)
	assert.Equal(t, 41, rows, "and A's later resize did nothing")
	assert.Equal(t, 101, cols)
}

// Every call that names a terminal by its id answers the window that holds it and is told what is told of an id that never
// was by every other, before the offer is used and after: nothing of a terminal is open to the window that gave it away.
func TestEveryCallThatNamesATerminalByItsIdAnswersTheWindowThatHoldsItAndNoOther(t *testing.T) {
	m, _ := newPageManager(t)
	info := m.startPlain(t, "wA")
	calls := map[string]func(owner Owner) error{
		"WriteOwned":  func(o Owner) error { return m.WriteOwned(info.ID, o, 0, []byte("x")) },
		"ResizeOwned": func(o Owner) error { return m.ResizeOwned(info.ID, o, 0, 30, 90) },
		"AckOwned":    func(o Owner) error { return m.AckOwned(info.ID, o, 1) },
		"BusyOwned":   func(o Owner) error { _, err := m.BusyOwned(info.ID, o); return err },
		"CwdOwned":    func(o Owner) error { _, err := m.CwdOwned(info.ID, o); return err },
		"GetOwned":    func(o Owner) error { _, err := m.GetOwned(info.ID, o); return err },
		"DetachOwned": func(o Owner) error { _, err := m.DetachOwned(info.ID, o); return err },
	}
	holds := func(holder Owner, other ...Owner) {
		t.Helper()
		for name, call := range calls {
			require.NoError(t, call(holder), "%s for the window that holds the terminal", name)
			for _, stranger := range other {
				notFound(t, call(stranger), info.ID)
			}
		}
	}
	holds("wA", "wB", nil, []int{1})

	notFound(t, m.AckOwned("no-such-session", "wA", 1), "no-such-session")
	_, err := m.GetOwned("no-such-session", "wA")
	notFound(t, err, "no-such-session")
	_, _, err = m.AttachOwned(info.ID, "wB")
	notFound(t, err, info.ID)
	require.NoError(t, m.Offer(info.ID, "wA", OfferTTL))
	_, _, err = m.AttachOwned(info.ID, []int{1})
	notFound(t, err, info.ID)
	attached, data, err := m.AttachOwned(info.ID, "wB")
	require.NoError(t, err, "B takes the terminal that A offered, by attaching it")
	assert.Equal(t, info.ID, attached.ID)
	assert.NotNil(t, data)

	holds("wB", "wA", nil)
	_, _, err = m.AttachOwned(info.ID, "wA")
	notFound(t, err, info.ID)
	_, _, err = m.AttachOwned(info.ID, "wB")
	require.NoError(t, err, "the holder attaches again")
}

// Input from the window that is giving a terminal away and the claim of it at the same moment, many times, with the calls
// held in the instant after the decision by the scheduler: whatever the order, the terminal has everything A typed before
// anything B typed, and A is told not found from the first call that comes after the claim.
func TestInputOfAWindowThatGivesATerminalAwayAndTheClaimOfItAtOnceKeepTheirOrder(t *testing.T) {
	m, sink := newPageManager(t)
	var seed atomic.Uint64
	m.afterAdmit = func(string) { jitter(rand.New(rand.NewPCG(seed.Add(1), 3))) }
	rng := rand.New(rand.NewPCG(11, 17))
	for round := range 25 {
		id := fmt.Sprintf("hand-over-%d", round)
		m.startKeyed(t, `stty -echo; cat`, "wA", Options{ID: id})
		require.NoError(t, m.Offer(id, "wA", OfferTTL))
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		delay := rand.New(rand.NewPCG(rng.Uint64(), 1))
		go func() {
			defer wg.Done()
			<-start
			for i := range 200 {
				if err := m.WriteOwned(id, "wA", 0, fmt.Appendf(nil, "A%03d\n", i)); err != nil {
					assert.Equal(t, apperror.SessionNotFound(id).Error(), err.Error(), "A is refused as an id that never was")
					return
				}
			}
		}()
		go func() {
			defer wg.Done()
			<-start
			jitter(delay)
			assert.NoError(t, m.Claim(id, "wB"))
			for i := range 20 {
				assert.NoError(t, m.WriteOwned(id, "wB", 0, fmt.Appendf(nil, "B%03d\n", i)))
			}
		}()
		close(start)
		wg.Wait()

		sink.waitFor(t, id, "B019\r\n")
		firstB := -1
		for at, word := range strings.Fields(sink.raw(id)) {
			switch {
			case strings.HasPrefix(word, "B") && firstB < 0:
				firstB = at
			case strings.HasPrefix(word, "A") && firstB >= 0:
				require.Failf(t, "A typed into a terminal after B had begun to", "round %d: %q after B's first word", round, word)
			}
		}
		require.NoError(t, m.CloseSession(id))
	}
}
