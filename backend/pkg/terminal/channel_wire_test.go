//go:build !windows

package terminal

import (
	"errors"
	"math/rand/v2"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// VERSION 2 OF THE STREAM: `applied` (0x87) AND `released` (0x88) (docs/ui-next/terminal-channel-protocol.md sections 4, 5 and 8).
//
// The host says two facts the page used to guess. `input_applied` is how many bytes of input the host has written to the terminal
// from this capability, across streams: `ready` carries it and an `applied` frame repeats it as the writes return, so that a page
// that lost a stream resends the tail it sent after the last number it saw. `released` is said to a stream that was displaced
// (`taken-over`) once the terminal is free again: a displaced stream is a watcher, not a closed stream. The wire is written out here
// by hand. The order of every pair is forced by a gated device, a gated child, a parked Send or a decision made by hand, never by a
// sleep.

// wireTerminal is a channel terminal whose input goes through a device the test holds.
func wireTerminal(t *testing.T, script string) (*Manager, Session, *session, *gatedDevice) {
	t.Helper()
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, script, Options{})
	s := m.chanOf(t, info)
	dev := newGatedDevice()
	s.useDevice(dev)
	return m, info, s, dev
}

// letThrough lets the next call that waits in the device go, after the test saw it arrive.
func (d *gatedDevice) letThrough() { d.gate <- struct{}{} }

func appliedIs(want ...uint64) func(pageState) bool {
	return func(st pageState) bool { return slices.Equal(st.applied, want) }
}

// ---- applied ----

// A write that blocks in the terminal is not applied until it returns: the number is the bytes the device took, at the moment each
// write returned, and `ready` of the first stream says nothing was applied yet.
func TestAppliedCountsTheBytesWrittenWhenTheWriteReturnsAndNotBefore(t *testing.T) {
	m, info, s, dev := wireTerminal(t, `sleep 600`)
	a := m.attach(t, info.Cap, nil)
	guarded(t, "ready-input-applied", func() { assert.Zero(t, a.waitReady().InputApplied, "nothing was applied yet") })
	a.waitReady()

	a.input("abc")
	require.Equal(t, "w:abc", dev.waitEntered(t), "the write is inside the device")
	guarded(t, "applied-after-the-write", func() {
		assert.Zero(t, s.channel.inputApplied.Load(), "the write has not returned: the host has applied nothing")
		assert.Empty(t, a.state().applied, "and the page was told nothing")
	})
	dev.letThrough()
	guarded(t, "applied-after-the-write", func() {
		a.waitFor("applied 3", appliedIs(3))
	})

	a.input("de")
	require.Equal(t, "w:de", dev.waitEntered(t))
	dev.letThrough()
	guarded(t, "applied-after-the-write", func() {
		st := a.waitFor("applied 3 then 5", appliedIs(3, 5))
		assert.Empty(t, st.faults)
	})
}

// A resize is not input: it moves nothing. And a write that fails after part of its bytes counts the part the device took.
func TestAppliedCountsOnlyTheBytesTheDeviceTookAndNothingForAResize(t *testing.T) {
	m, info, s, _ := wireTerminal(t, `sleep 600`)
	s.useDevice(shortDevice{took: 2})
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a.resize(100, 30)
	a.input("abcd")
	guarded(t, "applied-counts-written", func() {
		st := a.waitFor("applied 2", appliedIs(2))
		assert.Empty(t, st.faults)
	})
}

// shortDevice takes took bytes of every write and then fails: a terminal that went away in the middle of it.
type shortDevice struct{ took int }

func (d shortDevice) Write(p []byte) (int, error) {
	return min(d.took, len(p)), errors.New("the terminal went away")
}
func (shortDevice) Resize(uint16, uint16) error { return nil }

// While the page does not take frames the writes pile up, and the page is told once for the batch, with the total: at most one
// `applied` frame for each batch, never one for each write.
func TestAppliedIsCoalescedWhileThePageTakesNothing(t *testing.T) {
	m, info, _, dev := wireTerminal(t, `sleep 600`)
	dev.openAll()
	f := newFakeChannel(t)
	a := m.attachOn(t, f, info.Cap, nil, 0)
	a.waitReady()
	f.park(1) // the first applied frame parks in the transport, and the sender with it

	a.input("1")
	require.Eventually(t, func() bool { begun, _ := f.counts(); return begun >= 2 }, settle, 1e6, "the first applied frame was begun")
	a.input("22")
	a.input("333")
	require.Eventually(t, func() bool { return len(dev.log()) == 3 }, settle, 1e6, "the three writes were applied")
	f.release()
	guarded(t, "applied-coalesced", func() {
		st := a.waitFor("applied 1 then 6", appliedIs(1, 6))
		assert.Len(t, st.applied, 2, "two frames for three writes: the two behind the parked one were told together")
	})
}

// A new stream starts from what the host has applied: `ready` of the stream that follows a stream that died says what the first
// one's input came to, and the numbers it sends afterwards go on from there.
func TestAppliedSurvivesAReconnectAndTheNextStreamGoesOnFromIt(t *testing.T) {
	m, info, _, dev := wireTerminal(t, `sleep 600`)
	dev.openAll()
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a.input("hello")
	a.waitFor("applied 5", appliedIs(5))
	a.die()

	b := m.attach(t, info.Cap, nil)
	guarded(t, "ready-input-applied", func() {
		assert.EqualValues(t, 5, b.waitReady().InputApplied, "ready carries what the first stream's input came to")
	})
	b.waitReady()
	b.input("!")
	guarded(t, "applied-after-the-write", func() {
		st := b.waitFor("applied 6", appliedIs(6))
		assert.Empty(t, st.faults)
	})
}

// A write that blocks when its stream dies is still the host's: it will be applied before anything the next stream sends, so `ready`
// counts it (the page would otherwise send it again and the shell would read it twice), and the next stream's `applied` frames never
// say a number the page has already been told.
func TestAWriteThatBlocksAcrossAReconnectIsCountedByTheNextReadyAndNotToldTwice(t *testing.T) {
	m, info, _, dev := wireTerminal(t, `sleep 600`)
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a.input("abc")
	require.Equal(t, "w:abc", dev.waitEntered(t))
	a.die()

	b := m.attach(t, info.Cap, nil)
	guarded(t, "ready-counts-queued-input", func() {
		assert.EqualValues(t, 3, b.waitReady().InputApplied, "the write that is still in the device is counted: it is applied before B's")
	})
	b.waitReady()
	b.input("d")
	dev.letThrough() // A's write returns
	require.Equal(t, "w:d", dev.waitEntered(t), "B's write follows A's")
	dev.letThrough()
	guarded(t, "applied-from-the-ready-value", func() {
		st := b.waitFor("applied 4", appliedIs(4))
		assert.Empty(t, st.faults)
		assert.Equal(t, []uint64{4}, st.applied, "the 3 of A's write is in ready already: no frame repeats it")
	})
}

// What a displaced stream types is refused, and refused input is never counted: not in the frames of the stream that holds the
// terminal and not in the `ready` of the one that comes after.
func TestInputOfADisplacedStreamIsNeverCounted(t *testing.T) {
	m, info, s, dev := wireTerminal(t, `sleep 600`)
	dev.openAll()
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	a.input("zzz")
	guarded(t, "refused-not-counted", func() {
		require.Eventually(t, func() bool { return s.channelStats().refused >= 1 }, settle, 1e6, "the host read what the displaced stream typed")
	})
	b.input("ok")
	guarded(t, "refused-not-counted", func() {
		st := b.waitFor("applied 2", appliedIs(2))
		assert.Empty(t, st.faults)
		assert.Equal(t, []string{"w:ok"}, dev.log(), "only the holder's input reached the terminal")
	})
	c := m.attach(t, info.Cap, nil)
	guarded(t, "refused-not-counted", func() { assert.EqualValues(t, 2, c.waitReady().InputApplied) })
	c.waitReady()
}

// APPLIED AGAINST A TAKEOVER. A's write is in the device when B takes the terminal: it is B's `ready` that counts it, A's next input
// is refused and uncounted, A (a watcher now) is sent no `applied`, and B's number goes on from A's.
func TestAppliedAndATakeoverAtOnceCountEveryByteOnceAndTellOnlyTheHolder(t *testing.T) {
	m, info, s, dev := wireTerminal(t, `sleep 600`)
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a.input("A1")
	require.Equal(t, "w:A1", dev.waitEntered(t))

	b := m.attach(t, info.Cap, nil)
	guarded(t, "ready-counts-queued-input", func() { assert.EqualValues(t, 2, b.waitReady().InputApplied) })
	b.waitReady()
	dev.letThrough()
	a.input("A2")
	require.Eventually(t, func() bool { return s.channelStats().refused >= 1 }, settle, 1e6, "A's input after the handover was refused")
	b.input("B")
	require.Equal(t, "w:B", dev.waitEntered(t))
	dev.letThrough()
	guarded(t, "applied-from-the-ready-value", func() { b.waitFor("applied 3", appliedIs(3)) })
	guarded(t, "only-the-holder-is-told", func() {
		assert.Empty(t, a.state().applied, "a watcher is sent no applied frame")
		assert.Equal(t, []string{"w:A1", "w:B"}, dev.log())
	})
}

// ---- released ----

// A displaced stream is a watcher: its connection stays open, what it types is refused, it is sent no output, and when the stream that
// holds the terminal ends it is sent `released`, once, and the host closes it. The terminal is not ended: it is detached, on its lease.
func TestADisplacedStreamStaysAsAWatcherAndIsToldOnceWhenTheTerminalIsFree(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	hold := newGate(t)
	info := m.startChannel(t, headGateTail("up\\n", hold, "later\\n"), Options{})
	s := m.chanOf(t, info)
	a := m.attach(t, info.Cap, nil)
	a.waitBytes(len("up\n"))
	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	a.waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })
	guarded(t, "watcher-stays-open", func() { assert.False(t, a.isClosed(), "the displaced stream is not closed") })

	a.input("x")
	a.resize(100, 30)
	a.ack(1)
	guarded(t, "displaced-cannot-type", func() {
		require.Eventually(t, func() bool { return s.channelStats().refused >= 2 }, settle, 1e6, "its input and its resize are refused")
	})
	hold.release(t)
	b.waitBytes(len("up\nlater\n"))
	guarded(t, "watcher-gets-no-output", func() {
		st := a.state()
		assert.Equal(t, "up\n", string(st.bytes()), "the watcher is sent no output")
		assert.Equal(t, wTakenOver, st.order[len(st.order)-1], "and nothing at all while the terminal is held")
	})

	b.close()
	guarded(t, "released-once", func() {
		a.waitFor("released", func(st pageState) bool { return st.released >= 1 })
		st := a.waitClosed()
		assert.Equal(t, 1, st.released, "released is sent once")
		assert.Equal(t, wReleased, st.order[len(st.order)-1])
		assert.Empty(t, st.ended, "the terminal did not end")
		assert.Empty(t, st.faults)
		waitHost(t, s, nil, "the terminal was never let go", func(cs channelStats) bool { return !cs.held })
		detached, _, lease, _ := s.state()
		assert.True(t, detached, "the terminal is detached")
		assert.True(t, lease, "its lease runs")
	})
}

// A terminal that ends while a stream watches it: the watcher is sent `ended`, not `released`, and the host closes it.
func TestAWatcherIsToldHowTheTerminalEndedAndNeverThatItIsFree(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	hold := newGate(t)
	info := m.startChannel(t, `stty -echo -opost; printf 'up\n'; `+hold.wait()+`printf 'bye\n'`, Options{})
	a := m.attach(t, info.Cap, nil)
	a.waitBytes(len("up\n"))
	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	a.waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })
	hold.release(t)
	st := a.waitClosed()
	guarded(t, "ended-not-released", func() {
		assert.Len(t, st.ended, 1, "the watcher is told how the terminal ended, once")
		assert.Zero(t, st.released, "and never that it is free")
		assert.Equal(t, "up\n", string(st.bytes()), "no output: the watcher has none of what the terminal wrote since")
		assert.Equal(t, wEnded, st.order[len(st.order)-1])
		assert.Empty(t, st.faults)
	})
	guarded(t, "ended-not-released", func() { b.waitFor("ended", func(st pageState) bool { return len(st.ended) >= 1 }) })
}

// THE HOLDER ENDING AGAINST THE TERMINAL ENDING, in both orders. When the end of the terminal is decided first, the holder's stream
// ending leaves the terminal NOT free (it is ending): the watcher is told `ended`. When the holder's stream ends first, the terminal
// was free, and the watcher is told `released` and is closed before the end comes.
func TestTheHolderEndingAndTheTerminalEndingAtOnceAreToldInTheOrderTheyHappened(t *testing.T) {
	t.Run("the end is decided first", func(t *testing.T) {
		m, info, s, _ := wireTerminal(t, `sleep 600`)
		a := m.attach(t, info.Cap, nil)
		a.waitReady()
		b := m.attach(t, info.Cap, nil)
		b.waitReady()
		a.waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })
		require.True(t, s.decide(fate{set: true, closedBy: ClosedByRequest, failure: nil}), "the end is decided, the terminal is still held")
		b.close()
		b.waitServed()
		s.startClose()
		m.awaitGone([]*session{s})
		st := a.waitClosed()
		guarded(t, "released-not-on-terminal-end", func() {
			assert.Zero(t, st.released, "the terminal was ending when the holder let go: it is never free")
			require.Len(t, st.ended, 1)
			assert.Equal(t, EndClosed, st.ended[0].Reason)
		})
	})
	t.Run("the holder ends first", func(t *testing.T) {
		m, info, _, _ := wireTerminal(t, `sleep 600`)
		a := m.attach(t, info.Cap, nil)
		a.waitReady()
		b := m.attach(t, info.Cap, nil)
		b.waitReady()
		a.waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })
		b.close()
		b.waitServed()
		st := a.waitClosed()
		require.NoError(t, m.CloseChannel(info.Cap))
		guarded(t, "released-before-the-end", func() {
			assert.Equal(t, 1, st.released)
			assert.Empty(t, st.ended, "the terminal ended after the watcher was told it was free, and the stream was closed")
			assert.Empty(t, a.state().ended)
		})
	})
}

// THE RELEASE AGAINST A NEW ATTACH, in both orders. The watcher is told when the holder's stream ends: if the terminal is taken again
// first, the stream that was holding it becomes a watcher too and the old watcher goes on waiting, and is told when the new holder ends;
// if the holder's stream ends first the watcher is told at once and a later attach changes nothing for it. Told once either way.
func TestAReleaseAndANewAttachAtOnceTellEveryWatcherOnceAndNeverEarly(t *testing.T) {
	t.Run("the release is first", func(t *testing.T) {
		m, info, s, _ := wireTerminal(t, `sleep 600`)
		a := m.attach(t, info.Cap, nil)
		a.waitReady()
		b := m.attach(t, info.Cap, nil)
		b.waitReady()
		b.close()
		b.waitServed()
		waitHost(t, s, nil, "the holder's stream never ended", func(cs channelStats) bool { return !cs.held })
		c := m.attach(t, info.Cap, nil)
		c.waitReady()
		st := a.waitClosed()
		guarded(t, "released-once", func() { assert.Equal(t, 1, st.released) })
		c.close()
		c.waitServed()
		guarded(t, "released-once", func() {
			assert.Equal(t, 1, a.state().released, "the new holder ending does not tell a stream that was told already")
		})
	})
	t.Run("the attach is first", func(t *testing.T) {
		m, info, s, _ := wireTerminal(t, `sleep 600`)
		a := m.attach(t, info.Cap, nil)
		a.waitReady()
		b := m.attach(t, info.Cap, nil)
		b.waitReady()
		c := m.attach(t, info.Cap, nil)
		c.waitReady()
		b.waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })
		b.close() // B, a watcher now, goes away: that frees nothing
		b.waitServed()
		guarded(t, "released-only-when-free", func() {
			assert.Zero(t, a.state().released, "C holds the terminal: A is not told it is free")
			assert.True(t, s.channelStats().held)
			assert.False(t, a.isClosed())
		})
		c.close()
		st := a.waitClosed()
		guarded(t, "released-once", func() { assert.Equal(t, 1, st.released) })
	})
}

// At most four streams watch a terminal: the stream that has watched longest is closed, with no frame, when a fifth is displaced.
// The others are each told once when the terminal is free.
func TestAtMostFourStreamsWatchATerminalAndTheOldestIsClosedWithoutAFrame(t *testing.T) {
	m, info, _, _ := wireTerminal(t, `sleep 600`)
	pages := make([]*chanPage, 0, 6)
	for range 6 {
		p := m.attach(t, info.Cap, nil)
		p.waitReady()
		pages = append(pages, p)
		if len(pages) > 1 {
			pages[len(pages)-2].waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })
		}
	}
	// Pages 0 to 4 were displaced: five watchers, and the bound is four.
	guarded(t, "watcher-bound", func() {
		oldest := pages[0].waitClosed()
		assert.Zero(t, oldest.released, "the evicted watcher is sent no frame after taken-over")
		assert.Equal(t, wTakenOver, oldest.order[len(oldest.order)-1])
		for i, p := range pages[1:5] {
			assert.False(t, p.isClosed(), "watcher %d is kept", i+1)
		}
	})
	pages[5].close()
	for i, p := range pages[1:5] {
		st := p.waitClosed()
		guarded(t, "released-once", func() { assert.Equal(t, 1, st.released, "watcher %d", i+1) })
	}
}

// A watcher is not a holder: when it leaves (a detach frame, or a frame that is not allowed) it is closed, nothing else changes: the
// holder keeps the terminal and its input, and no lease starts. While watchers exist no lease runs either.
func TestAWatcherThatLeavesChangesNothingForTheHolderAndTheLease(t *testing.T) {
	m, info, s, dev := wireTerminal(t, `sleep 600`)
	dev.openAll()
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a2 := m.attach(t, info.Cap, nil)
	a2.waitReady()
	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	a.waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })
	a2.waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })

	a.detach()
	a.waitServed()
	a2.send([]byte{0x7f}) // a type nobody has
	a2.waitServed()
	guarded(t, "watcher-is-not-holder", func() {
		assert.True(t, s.channelStats().held, "the holder still holds it")
		detached, _, lease, _ := s.state()
		assert.False(t, detached, "no lease runs")
		assert.False(t, lease)
		assert.Zero(t, a.state().released+a2.state().released, "a watcher that left is sent nothing")
	})
	guarded(t, "watcher-is-not-holder", func() {
		b.input("still")
		b.waitFor("applied 5", appliedIs(5))
	})
}

// THE END STATE AFTER A STORM. Streams attach, type, die, detach and break the protocol at random against one terminal. Every page
// kept the protocol (no fault, no frame after `ended`, no output after `taken-over`, `released` once and last, never with `ended`,
// never more `applied` frames than inputs sent), `ready` of the last stream counts exactly the bytes the device took, and when the
// terminal is closed no session, goroutine or descriptor is left.
func TestAStormOfStreamsKeepsTheProtocolCountsEveryByteOnceAndLeavesNothing(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	goroutines, descriptors := runtime.NumGoroutine(), openDescriptors(t)
	info := m.startChannel(t, `stty -echo -opost; printf 'up\n'; sleep 600`, Options{})
	s := m.chanOf(t, info)
	dev := &countingDevice{}
	s.useDevice(dev)

	var mu sync.Mutex
	var pages []*chanPage
	sent := map[*chanPage]int{}
	var wg sync.WaitGroup
	for g := range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rng := rand.New(rand.NewPCG(uint64(g), 693))
			for range 30 {
				p := m.attach(t, info.Cap, nil)
				mu.Lock()
				pages = append(pages, p)
				mu.Unlock()
				for range rng.IntN(4) {
					p.input(strings.Repeat("k", 1+rng.IntN(5)))
					mu.Lock()
					sent[p]++
					mu.Unlock()
				}
				switch rng.IntN(5) {
				case 0:
					p.die()
				case 1:
					p.detach()
				case 2:
					p.send([]byte{0x7f})
				case 3:
					p.resize(90, 30)
				}
			}
		}()
	}
	wg.Wait()
	// Every attach has been decided before the last one: a stream whose attach the host has not read yet would take the terminal from it.
	for _, p := range pages {
		p.waitFor("the attach decided", func(st pageState) bool { return st.ready != nil || st.closed })
	}

	last := m.attach(t, info.Cap, nil)
	ready := last.waitReady()
	guarded(t, "storm-applied", func() {
		require.Eventually(t, func() bool { return dev.total.Load() == ready.InputApplied }, settle, 1e6,
			"the device took %d bytes and ready of the last stream says %d", dev.total.Load(), ready.InputApplied)
	})
	require.NoError(t, m.CloseChannel(info.Cap))
	last.waitClosed()

	guarded(t, "storm-end-state", func() {
		for _, p := range pages {
			p.waitClosed()
			p.waitServed()
		}
	})
	for i, p := range pages {
		st := p.state()
		assert.Empty(t, st.faults, "page %d", i)
		guarded(t, "released-once", func() {
			assert.LessOrEqual(t, st.released, 1, "page %d: released at most once", i)
		})
		assert.False(t, st.released > 0 && len(st.ended) > 0, "page %d: released and ended are not both said", i)
		guarded(t, "storm-applied", func() {
			assert.LessOrEqual(t, len(st.applied), sent[p], "page %d: no more applied frames than inputs", i)
		})
		if st.released > 0 {
			assert.Equal(t, wReleased, st.order[len(st.order)-1], "page %d: released is the last thing it is told", i)
		}
		if at := slices.Index(st.order, wTakenOver); at >= 0 {
			assert.NotContains(t, st.order[at:], wOutput, "page %d: a watcher is sent no output", i)
			assert.NotContains(t, st.order[at:], wApplied, "page %d: nor an applied", i)
		}
	}
	assert.Empty(t, m.running(), "no session")
	m.Shutdown()
	guarded(t, "storm-end-state", func() {
		require.Eventually(t, func() bool { return runtime.NumGoroutine() <= goroutines+4 }, settle, 1e6, "goroutines: %d before, %d now\n%s", goroutines, runtime.NumGoroutine(), allStacks())
		require.Eventually(t, func() bool { return openDescriptors(t) <= descriptors+2 }, settle, 1e6, "descriptors: %d before, %d now", descriptors, openDescriptors(t))
	})
}

// countingDevice takes every write and counts its bytes.
type countingDevice struct{ total atomic.Uint64 }

func (d *countingDevice) Write(p []byte) (int, error) {
	d.total.Add(uint64(len(p)))
	return len(p), nil
}
func (*countingDevice) Resize(uint16, uint16) error { return nil }
