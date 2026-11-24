//go:build !windows

package terminal

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// WHO HOLDS A CHANNEL TERMINAL, AND THE STEP IN WHICH THAT IS DECIDED (the idea of withHeld in #677, with the stream for its window).
//
// The connection is the holder. A second stream that shows the capability takes the terminal; the first is told and closes, and
// cannot type. Who holds the terminal and what a call does to it are one step under the terminal's lock: input that was taken
// in before a handover is applied before the new holder's, input after it is refused, a close that wins a race with an attach
// wins entirely, two attaches at once have one winner, and a terminal whose end is decided cannot be claimed. The order is
// forced by a device that holds the input back and by a transport that parks a frame, never by a sleep.

// A stream that shows the capability of a terminal another stream holds takes it: the first stream is told, by a frame, and
// its connection closes; whatever it types from then on is refused, and the new holder's input is applied.
func TestASecondStreamWithTheCapabilityTakesTheTerminalAndTheFirstIsToldAndCannotType(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `stty -echo -opost; printf 'up\n'; cat`, Options{})
	s := m.chanOf(t, info)
	dev := newGatedDevice()
	dev.openAll()
	s.useDevice(dev)

	fa := newFakeChannel(t)
	a := m.attachOn(t, fa, info.Cap, nil, 0)
	a.waitBytes(len("up\n"))
	begun, _ := fa.counts()
	fa.park(begun) // the frame that tells A it was displaced parks: A's connection stays open until the test lets it go

	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	a.input("A-typed\n")
	require.Eventually(t, func() bool { return s.channelStats().refused >= 1 }, settle, time.Millisecond, "the host read A's input")
	b.input("B-typed\n")
	require.Eventually(t, func() bool { return len(dev.log()) >= 1 }, settle, time.Millisecond, "B's input was applied")

	guarded(t, "displaced-cannot-type", func() {
		assert.Equal(t, []string{"w:B-typed\n"}, dev.log(), "what the displaced stream typed never reached the shell")
		assert.EqualValues(t, 1, s.channelStats().refused)
	})
	fa.release()
	a.waitServed()
	st := a.waitClosed()
	guarded(t, "taken-over", func() {
		assert.Equal(t, 1, st.takenOver, "the stream that lost the terminal is told, once")
		assert.Equal(t, wTakenOver, st.order[len(st.order)-1], "and it is the last thing it is told")
	})
	guarded(t, "one-holder", func() {
		assert.True(t, s.channelStats().held)
		assert.False(t, b.isClosed(), "the stream that took it holds it")
		assert.Zero(t, b.state().takenOver)
	})
}

// Input that was taken in while a stream held the terminal is applied before the input of the stream that takes it in the next
// instant, and what the first stream types after that is refused. The first write is held in the device, so that it is
// admitted and not yet applied when the handover comes.
func TestInputThatWasTakenInBeforeAHandoverIsAppliedBeforeTheNewHoldersAndNothingAfterIt(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	s := m.chanOf(t, info)
	dev := newGatedDevice()
	s.useDevice(dev)

	fa := newFakeChannel(t)
	a := m.attachOn(t, fa, info.Cap, nil, 0)
	a.waitReady()
	a.input("A1\n")
	require.Equal(t, "w:A1\n", dev.waitEntered(t), "A's input was admitted and is being applied")
	begun, _ := fa.counts()
	fa.park(begun) // A's connection outlives the handover: its stream goes on reading frames
	a.input("A2\n")

	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	b.input("B1\n")
	require.Eventually(t, func() bool { return s.channelStats().admitted >= 2 }, settle, time.Millisecond, "B's input is behind A's")
	dev.openAll()
	require.Eventually(t, func() bool { return s.channelStats().refused >= 1 }, settle, time.Millisecond, "A's input after the handover was read")
	require.Eventually(t, func() bool { return len(dev.log()) >= 2 }, settle, time.Millisecond)

	guarded(t, "decide-and-act", func() {
		assert.Equal(t, []string{"w:A1\n", "w:B1\n"}, dev.log(), "what A had taken in comes first, B's follows, and A's later input is nowhere")
		assert.EqualValues(t, 2, s.channelStats().admitted)
		assert.EqualValues(t, 1, s.channelStats().refused)
	})
}

// The same for the size of the terminal: the resize that was taken in first is applied first, so the size the terminal ends
// with is the new holder's, and the stream that gave the terminal away resizes nothing afterwards.
func TestAResizeThatWasTakenInBeforeAHandoverIsAppliedBeforeTheNewHoldersAndNothingAfterIt(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	s := m.chanOf(t, info)
	dev := newGatedDevice()
	s.useDevice(dev)

	fa := newFakeChannel(t)
	a := m.attachOn(t, fa, info.Cap, nil, 0)
	a.waitReady()
	a.resize(91, 31)
	require.Equal(t, "r:31x91", dev.waitEntered(t))
	begun, _ := fa.counts()
	fa.park(begun)
	a.resize(92, 32)

	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	b.resize(101, 41)
	require.Eventually(t, func() bool { return s.channelStats().admitted >= 2 }, settle, time.Millisecond)
	dev.openAll()
	require.Eventually(t, func() bool { return s.channelStats().refused >= 1 }, settle, time.Millisecond)
	require.Eventually(t, func() bool { return len(dev.log()) >= 2 }, settle, time.Millisecond)

	guarded(t, "decide-and-act", func() {
		assert.Equal(t, []string{"r:31x91", "r:41x101"}, dev.log(), "the size is the new holder's, and A's later resize did nothing")
	})
}

// Input from the stream that is giving a terminal away and the takeover at the same moment, many times, with the frames held
// in the instant after the decision by the scheduler: whatever the order, the shell has everything the first stream typed
// before anything the second typed, in the order it typed it, and the first stream's frames after the handover are refused.
func TestInputOfAHolderThatIsGivenAwayAndTheTakeoverOfItAtOnceKeepTheirOrder(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	rng := rand.New(rand.NewPCG(11, 17))
	for round := range 12 {
		info := m.startChannel(t, `sleep 600`, Options{})
		dev := newGatedDevice()
		dev.openAll()
		m.chanOf(t, info).useDevice(dev)
		a := m.attach(t, info.Cap, nil)
		a.waitReady()

		typeWhileTheTerminalIsTaken(t, m, info.Cap, a, rand.New(rand.NewPCG(rng.Uint64(), 1)))
		require.Eventually(t, func() bool { return contains(dev.log(), "w:B019\n") }, settle, time.Millisecond, "round %d: B's input arrived", round)

		guarded(t, "decide-and-act", func() { requireTheHandoverKeptTheOrder(t, round, dev.log()) })
		require.NoError(t, m.CloseChannel(info.Cap))
	}
}

// typeWhileTheTerminalIsTaken has the stream a type 200 lines while a second stream takes the terminal, after a jitter, and types
// 20 lines of its own. It returns when both have typed.
func typeWhileTheTerminalIsTaken(t *testing.T, m *Manager, capability string, a *chanPage, delay *rand.Rand) {
	t.Helper()
	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		for i := range 200 {
			a.input(fmt.Sprintf("A%03d\n", i))
		}
	}()
	go func() {
		defer wg.Done()
		<-start
		jitter(delay)
		b := m.attach(t, capability, nil)
		b.waitReady()
		for i := range 20 {
			b.input(fmt.Sprintf("B%03d\n", i))
		}
	}()
	close(start)
	wg.Wait()
}

// requireTheHandoverKeptTheOrder checks the shell's log of one round: nothing A typed comes after anything B typed, what A typed is
// a prefix of what it sent, in order, and B's 20 lines are all there, in order.
func requireTheHandoverKeptTheOrder(t *testing.T, round int, log []string) {
	t.Helper()
	firstB := -1
	var as, bs []string
	for i, entry := range log {
		switch {
		case strings.HasPrefix(entry, "w:B"):
			if firstB < 0 {
				firstB = i
			}
			bs = append(bs, entry)
		case strings.HasPrefix(entry, "w:A"):
			assert.Negative(t, firstB, "round %d: A typed into the terminal after B had begun to: %q", round, entry)
			as = append(as, entry)
		}
	}
	for i, entry := range as {
		assert.Equal(t, fmt.Sprintf("w:A%03d\n", i), entry, "round %d: what A typed is a prefix of what it sent, in order", round)
	}
	require.Len(t, bs, 20, "round %d", round)
	for i, entry := range bs {
		assert.Equal(t, fmt.Sprintf("w:B%03d\n", i), entry, "round %d", round)
	}
}

func contains(log []string, entry string) bool {
	for _, got := range log {
		if got == entry {
			return true
		}
	}
	return false
}

// Of many streams that show the capability at the same time exactly one holds the terminal at the end: the others were told
// they lost it and are closed, and only the holder's input reaches the shell.
func TestOneWinnerOfManyStreamsThatAttachAtOnce(t *testing.T) {
	const claimants = 8
	m, _ := newChannelManager(t, smallChannel)
	for round := range 4 {
		info := m.startChannel(t, `sleep 600`, Options{})
		s := m.chanOf(t, info)
		dev := newGatedDevice()
		dev.openAll()
		s.useDevice(dev)

		pages := make([]*chanPage, claimants)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for i := range claimants {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				jitter(rand.New(rand.NewPCG(uint64(round), uint64(100+i))))
				pages[i] = m.attach(t, info.Cap, nil)
			}()
		}
		close(start)
		wg.Wait()
		closed := func() int {
			n := 0
			for _, p := range pages {
				if p.isClosed() {
					n++
				}
			}
			return n
		}
		require.Eventually(t, func() bool { return closed() == claimants-1 }, settle, time.Millisecond, "round %d: every stream but one lost the terminal", round)

		guarded(t, "one-winner", func() {
			holders := 0
			for i, p := range pages {
				st := p.waitFor("an answer", func(s pageState) bool { return s.ready != nil || s.notFound > 0 })
				if !p.isClosed() {
					holders++
					assert.Zero(t, st.takenOver, "round %d: the holder %d was not told it lost the terminal", round, i)
					p.input(fmt.Sprintf("holder-%d\n", i))
					continue
				}
				p.waitClosed()
				assert.Equal(t, 1, p.state().takenOver, "round %d: stream %d that lost the terminal was told, once", round, i)
			}
			assert.Equal(t, 1, holders, "round %d: one winner", round)
			assert.True(t, s.channelStats().held)
		})
		require.Eventually(t, func() bool { return len(dev.log()) == 1 }, settle, time.Millisecond, "round %d: the holder's input", round)
		assert.True(t, strings.HasPrefix(dev.log()[0], "w:holder-"), "only the holder's input reached the shell: %v", dev.log())
		require.NoError(t, m.CloseChannel(info.Cap))
	}
}

// A terminal that is closing (its shell ignores the hangup, so the close takes a grace) is not claimable: the stream that comes
// in then is told not-found and never holds it.
func TestATerminalThatIsClosingIsNotClaimable(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `trap '' HUP; stty -echo; printf 'up\n'; sleep 600`, Options{})
	s := m.chanOf(t, info)
	holder := m.attach(t, info.Cap, nil)
	holder.waitBytes(len("up\n"))
	closed := make(chan error, 1)
	go func() { closed <- m.CloseChannel(info.Cap) }()
	require.Eventually(t, func() bool { return s.ending.Load() }, settle, time.Millisecond, "the close began")

	late := m.attach(t, info.Cap, nil)
	late.waitClosed()
	late.waitServed()
	guarded(t, "closing-not-claimable", func() {
		assert.Equal(t, 1, late.state().notFound, "a terminal that is closing opens nothing")
		assert.Nil(t, late.state().ready, "and the stream never held it")
	})
	require.NoError(t, <-closed)
	st := holder.waitFor("the end", func(s pageState) bool { return len(s.ended) > 0 })
	assert.Equal(t, EndClosed, st.ended[0].Reason, "the stream that held it is told it was closed")
	assert.Equal(t, ClosedByRequest, st.ended[0].ClosedBy)
}

// A close and an attach at the same moment have one outcome, whichever comes first: the terminal ends, and the stream either
// never held it (not-found) or held it and was told how it ended. A close that wins wins entirely.
func TestACloseThatWinsARaceWithAnAttachWinsEntirely(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	attachedFirst, closedFirst := 0, 0
	for round := range 10 {
		info := m.startChannel(t, `sleep 600`, Options{})
		var page *chanPage
		var closeErr error
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 3)))
			page = m.attach(t, info.Cap, nil)
		}()
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 4)))
			closeErr = m.CloseChannel(info.Cap)
		}()
		close(start)
		wg.Wait()

		page.waitClosed()
		page.waitServed()
		st := page.state()
		requireGone(t, info.PID, "a terminal that was closed")
		guarded(t, "close-wins-entirely", func() {
			if st.ready == nil {
				closedFirst++
				assert.Equal(t, 1, st.notFound, "round %d: the close came first, so the attach opened nothing", round)
				return
			}
			attachedFirst++
			require.Len(t, st.ended, 1, "round %d: the attach came first, and what it holds was ended", round)
			assert.Equal(t, ClosedByRequest, st.ended[0].ClosedBy)
			assert.Zero(t, st.notFound)
		})
		require.NoError(t, closeErr, "round %d: nothing else ended the terminal, so the close was the one that did", round)
	}
	t.Logf("the attach came first in %d rounds and the close in %d", attachedFirst, closedFirst)
}

// A terminal whose lease ran out is ended by the lease, and an attach after that finds nothing: the end is decided under the
// terminal's lock, so a claim cannot take a terminal that is going.
func TestATerminalWhoseEndIsDecidedByItsLeaseCannotBeClaimed(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := withFakeClock(m)
	info := m.startChannel(t, `trap '' HUP; sleep 600`, Options{LeaseMs: 1000})
	s := m.chanOf(t, info)

	clock.Advance(1001 * time.Millisecond)
	require.True(t, s.settled().set, "the lease decided its end")
	late := m.attach(t, info.Cap, nil)
	late.waitClosed()
	guarded(t, "closing-not-claimable", func() {
		assert.Equal(t, 1, late.state().notFound)
		assert.Nil(t, late.state().ready)
		assert.False(t, s.channelStats().held)
	})
}

// The end that a terminal left and the attach of it at once: the capability that holds the end dismisses it, or a stream attaches
// it, and the outcome is one of two, never a mixture: dismissed first, the attach finds nothing; attached first, the stream is
// told how it ended, and the dismissal still succeeds. The end is gone at the end of both.
func TestTheDismissalOfTheEndOfATerminalAndTheAttachOfItAtOnceHaveOneOutcome(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	attachedFirst, dismissedFirst := 0, 0
	for round := range 12 {
		info := m.startChannel(t, `stty -echo -opost; printf 'x\n'; read go; exit 0`, Options{})
		first := m.attach(t, info.Cap, nil)
		first.waitBytes(2)
		first.input("go\n")
		first.waitFor("the end", func(s pageState) bool { return len(s.ended) > 0 })
		first.waitServed()
		require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, settle, time.Millisecond, "round %d: the end is kept", round)

		var page *chanPage
		var dismiss error
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 7)))
			page = m.attach(t, info.Cap, nil)
		}()
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(round), 8)))
			dismiss = m.DismissChannel(info.Cap)
		}()
		close(start)
		wg.Wait()
		page.waitClosed()
		st := page.state()

		guarded(t, "one-outcome", func() {
			require.NoError(t, dismiss, "round %d: whoever holds the capability dismisses the end it left", round)
			if st.ready != nil {
				attachedFirst++
				require.NotNil(t, st.ready.Ended, "round %d: the attach came first and was told how it ended", round)
				assert.Len(t, st.ended, 1)
				assert.Zero(t, st.notFound)
			} else {
				dismissedFirst++
				assert.Equal(t, 1, st.notFound, "round %d: the dismissal came first and the attach found nothing", round)
			}
			assert.Zero(t, m.tombstoneCount(), "round %d: the end is gone", round)
		})
	}
	t.Logf("the attach came first in %d rounds and the dismissal in %d", attachedFirst, dismissedFirst)
}
