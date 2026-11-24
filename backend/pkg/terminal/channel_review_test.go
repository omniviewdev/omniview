//go:build !windows

package terminal

import (
	"bytes"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE FINDINGS OF THE REVIEW OF 6052c031 (docs/ui-next/status/T3-channel.md). Each test is written to fail on that head, by its
// own assertion, and to pass with the fix. The order of two events is forced by a gate, a parked Send or the clock a test moves;
// no wait decides an outcome.

// holdTheQueueFull has the stream a type as many bytes as the queue's bound, into a device that does not return from the write: the
// queue's bytes are full, and what any stream types after it waits behind it. It says what the device holds.
func holdTheQueueFull(t *testing.T, a *chanPage, dev *gatedDevice) string {
	t.Helper()
	a.input(strings.Repeat("x", ChannelMaxInputBytes))
	entered := dev.waitEntered(t)
	require.Len(t, entered, 2+ChannelMaxInputBytes, "the whole input is being applied, and the write does not return")
	return entered
}

// M1. A write that blocks in the kernel (a program that does not read its terminal) leaves its bytes in the queue's count. The
// stream that takes the terminal after it types, and the queue is full: its input was refused, counted and dropped without a word.
// The new holder's input waits for the room, and is applied, in order, when the write that holds the queue returns.
func TestTheNewHoldersInputWaitsForRoomInTheQueueAndIsNeverDropped(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	s := m.chanOf(t, info)
	dev := newGatedDevice()
	s.useDevice(dev)
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	holdTheQueueFull(t, a, dev)

	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	b.input("B1\n")
	// B's input has reached the queue's admission and found it full (a host that waits for room counts a wait, one that drops the
	// input counts a refusal): only then does the write that holds the queue return.
	require.Eventually(t, func() bool { st := s.channelStats(); return st.roomWaits >= 1 || st.refused >= 1 }, settle, time.Millisecond,
		"the new holder's input found the queue full")
	dev.openAll()
	require.Eventually(t, func() bool { return s.channelStats().refused > 0 || contains(dev.log(), "w:B1\n") }, settle, time.Millisecond,
		"the new holder's input was applied or refused")

	guarded(t, "new-holder-input-waits", func() {
		log := dev.log()
		assert.True(t, len(log) == 2 && log[1] == "w:B1\n", "the new holder's input was applied, after the write that held the queue")
		assert.Zero(t, s.channelStats().refused, "nothing the holder sent was refused: nothing is dropped without a word")
	})
}

// M1, the other way: a stream whose input waits for room and then loses the terminal is refused, once, and what it waited to type
// never reaches the shell; the stream that took the terminal from it is applied, in its turn.
func TestAFormerHolderWhoseInputWaitsForRoomIsRefusedAndTheNewHoldersIsApplied(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	s := m.chanOf(t, info)
	dev := newGatedDevice()
	s.useDevice(dev)
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	holdTheQueueFull(t, a, dev)

	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	b.input("B1\n")
	require.Eventually(t, func() bool { st := s.channelStats(); return st.roomWaits >= 1 || st.refused >= 1 }, settle, time.Millisecond,
		"B's input found the queue full, before the terminal is taken from it")
	c := m.attach(t, info.Cap, nil)
	c.waitReady()
	c.input("C1\n")
	require.Eventually(t, func() bool { st := s.channelStats(); return st.roomWaits >= 2 || st.refused >= 2 }, settle, time.Millisecond,
		"C's input found the queue full, before the write that holds it returns")
	dev.openAll()
	require.Eventually(t, func() bool { return contains(dev.log(), "w:C1\n") || s.channelStats().refused >= 2 }, settle, time.Millisecond,
		"the last holder's input was applied or refused")

	guarded(t, "new-holder-input-waits", func() {
		assert.True(t, contains(dev.log(), "w:C1\n"), "the stream that holds the terminal now is applied")
		assert.False(t, contains(dev.log(), "w:B1\n"), "what the displaced stream waited to type never reached the shell")
		require.Eventually(t, func() bool { return s.channelStats().refused >= 1 }, settle, time.Millisecond, "the displaced stream's input was refused")
		assert.EqualValues(t, 1, s.channelStats().refused, "refused once, when it lost the terminal")
	})
}

// M2. The page can acknowledge a frame as soon as the transport has it, which can be before the Send that carries it has
// returned to the sender: the acknowledgement is read while the bookkeeping of that frame is not done. It was cut down to what
// the bookkeeping said was sent (nothing yet), so a page that acknowledged everything it was given stayed in debt for the frame:
// the credit was lost, and a page that acknowledges at its window waits for ever. Forced order: the frame is parked in the
// transport, the page acknowledges it and the host has finished with the acknowledgement, and only then does the Send return.
func TestAChannelAcknowledgementThatArrivesBeforeTheSendReturnsIsKept(t *testing.T) {
	m, _ := newChannelManager(t, func(l *channelLimits) {
		smallChannel(l)
		l.inflight = 1 << 20
	})
	withFakeClock(m)
	hold := newGate(t)
	const lines = 3000
	total := countingLen(lines)
	info := m.startChannel(t, countingScript(lines, hold), Options{})
	s := m.chanOf(t, info)
	f := newFakeChannel(t)
	f.park(1) // the ready frame goes through; the first frame of output parks in the transport, and its Send has not returned
	page := m.attachOn(t, f, info.Cap, nil, 0)
	page.waitReady()
	hold.release(t)
	require.Eventually(t, func() bool { begun, _ := f.counts(); return begun >= 2 }, settle, time.Millisecond, "the first frame of output is in the transport")
	first := uint64(len(f.lastSendFrame()) - outputHeaderBytes)

	// The host waits in Recv for the page's next frame: a call of Recv that begins after the page sends its acknowledgement is the host
	// having finished with it, and the count cannot mean the host's first entry into Recv.
	require.Eventually(t, func() bool { return f.recvWaiting() == 1 }, settle, time.Millisecond, "the host waits for the page's next frame")
	calls := f.recvCalls()
	f.pageSend(ackFrame(uint32(first))) //nolint:gosec // A frame is at most 64 KiB.
	require.Eventually(t, func() bool { return f.recvCalls() > calls }, settle, time.Millisecond, "the host finished with the acknowledgement")
	f.release()
	require.Eventually(t, func() bool { return s.channelStats().sentBytes == total }, settle, time.Millisecond, "the page was given everything")
	require.Eventually(t, func() bool { return f.recvWaiting() == 1 }, settle, time.Millisecond, "the host waits for the page's next frame again")
	calls = f.recvCalls()
	f.pageSend(ackFrame(uint32(total - first))) //nolint:gosec // The sequence is a few kilobytes.
	require.Eventually(t, func() bool { return f.recvCalls() > calls }, settle, time.Millisecond, "the host finished with the second acknowledgement")

	guarded(t, "early-ack-kept", func() {
		stats := s.channelStats()
		assert.Equal(t, stats.sentBytes, stats.acked, "the page acknowledged all it was given, the first frame before its Send returned: nothing is in flight")
	})
}

// M3. A page that acknowledges when it holds a whole window of unacknowledged bytes, and a window that is not a whole number of
// frames: after the first frames the credit that is left is less than the next frame, and a sender that sends only whole frames
// waits for an acknowledgement that the page will not make until it has more. The output is split to the credit that is left.
// Forced: the page turns the window on before any output exists, and all the output waits in the ring, more than the credit, when
// the first frame is let through.
func TestAChannelReaderThatAcknowledgesExactlyTheWindowIsNotDeadlockedByAFrameThatDoesNotFitTheRest(t *testing.T) {
	const window = 100_000 // less than two frames of 64 KiB
	m, _ := newChannelManager(t, func(l *channelLimits) {
		smallChannel(l)
		l.ring = 1 << 20 // holds all of the output: nothing is overwritten while the first frame is held
		l.high = 1 << 20 // the pump is not paced: the ring fills while the first frame is held
		l.inflight = window
	})
	withFakeClock(m)
	hold := newGate(t)
	const lines = 60000
	total := countingLen(lines)
	info := m.startChannel(t, countingScript(lines, hold), Options{})
	s := m.chanOf(t, info)
	f := newFakeChannel(t)
	f.park(1) // the first frame of output is held in the transport, and the ring fills meanwhile
	page := m.attachOn(t, f, info.Cap, nil, window)
	page.waitReady()
	// The first acknowledgement turns the window on: the page makes it (of nothing) before the shell has written a byte.
	require.Eventually(t, func() bool { return f.recvWaiting() == 1 }, settle, time.Millisecond, "the host waits for the page's next frame")
	calls := f.recvCalls()
	page.ack(0)
	require.Eventually(t, func() bool { return f.recvCalls() > calls }, settle, time.Millisecond, "the host finished with the acknowledgement")
	hold.release(t)
	require.Eventually(t, func() bool { begun, _ := f.counts(); return begun >= 2 }, settle, time.Millisecond, "the first frame of output is in the transport")
	require.Eventually(t, func() bool { return s.channelStats().end == total }, settle, time.Millisecond, "all of the output waits in the ring, which is more than the credit")
	f.release()

	guarded(t, "split-to-credit", func() {
		got := page.waitBytes(int(total)) //nolint:gosec // The sequence is a few hundred kilobytes.
		assert.True(t, bytes.Equal(countingBytes(0, total), got.bytes()), "every byte of the sequence, in order")
		assert.Empty(t, got.faults)
	})
}

// armingClock is the fake clock with an event at the instant the pump arms its timer: the clock moves there, after the pump has
// read it and before the timer is registered, which is the order that a real clock makes happen when the pump is descheduled.
type armingClock struct {
	*fakeClock
	mu    sync.Mutex
	onArm func()
}

// arm sets what the next AfterFunc does first, once.
func (c *armingClock) arm(f func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onArm = f
}

func (c *armingClock) AfterFunc(d time.Duration, f func()) timer {
	c.mu.Lock()
	hook := c.onArm
	c.onArm = nil
	c.mu.Unlock()
	if hook != nil {
		hook()
	}
	return c.fakeClock.AfterFunc(d, f)
}

// m5. The pump arms its timer for what is left of the stall, computed from a reading of the clock. A clock that moves between
// the reading and the registration puts the timer after the stall by as much, and a test that moves the clock once never gets
// it fired: the release is postponed for ever. After the timer is armed the deadline is looked at again.
func TestAChannelClockThatMovesWhileThePumpArmsItsTimerDoesNotPostponeTheStall(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := &armingClock{fakeClock: newFakeClock(), mu: sync.Mutex{}, onArm: nil}
	m.clock = clock
	hold := newGate(t)
	info := m.startChannel(t, countingScript(-1, hold), Options{})
	s := m.chanOf(t, info)
	f := newFakeChannel(t)
	f.park(1)
	page := m.attachOn(t, f, info.Cap, nil, 0)
	page.waitReady()
	// What the attach left in the pump's wake is taken out (the pump is in a read of the shell, not in a wait), so that nothing but
	// the clock can end the wait it makes next.
	select {
	case <-s.channel.wake:
	default:
	}
	clock.arm(func() { clock.Advance(m.channel.stall) })
	hold.release(t)

	guarded(t, "stall-not-postponed", func() {
		require.Eventually(t, func() bool { return s.channelStats().stallReleases >= 1 }, settle, time.Millisecond,
			"the stall let the pump go, though the clock moved while its timer was armed")
	})
}

// m6. fmt does not call the methods of a field that is not exported: it prints what the field holds. A struct that holds a
// capability printed it, whatever the capability's own String and Format say. No verb prints the capability of a struct that
// holds one: the state of a channel terminal, the kept end of one, and a copy of it.
func TestNoVerbPrintsTheCapabilityOfAChannelStructThatHoldsIt(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	running := m.startChannel(t, `sleep 600`, Options{})
	state := m.chanOf(t, running).channel
	ended := m.startChannel(t, `exit 0`, Options{})
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, settle, time.Millisecond, "the end of the second terminal is kept")
	require.NoError(t, m.CloseChannel(running.Cap), "the first is ended, so that nothing writes what is printed")
	m.mu.RLock()
	var kept *tombstone
	for _, tomb := range m.tombs {
		if tomb.id == ended.ID {
			kept = tomb
		}
	}
	m.mu.RUnlock()
	require.NotNil(t, kept)

	guarded(t, "struct-redacts-capability", func() {
		for _, verb := range []string{"%v", "%+v", "%#v", "%s"} {
			for what, value := range map[string]any{"the state of a channel terminal": state, "the kept end of one": kept, "a copy of it": *kept} {
				printed := fmt.Sprintf(verb, value)
				assert.NotContains(t, printed, running.Cap, "%s with %s", what, verb)
				assert.NotContains(t, printed, ended.Cap, "%s with %s", what, verb)
			}
		}
	})
}
