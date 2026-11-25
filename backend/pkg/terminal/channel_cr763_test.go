//go:build !windows

package terminal

import (
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE REVIEW OF PR 763 (host side): control frames are received while input waits; the input count is the writer's, a feed's own;
// a short write that fails does not count what it did not write.

// A program that never reads its terminal blocks the write of a big paste; the holder's close is a frame like any other and the host
// reads it while the input waits: the terminal ends, the kill wakes the write, and the stream is told how it ended.
func TestTheHoldersCloseIsReadWhileAnInputWaitsForAProgramThatNeverReads(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `stty raw -echo; exec sleep 600`, Options{})
	s := m.chanOf(t, info)
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	paste := strings.Repeat("x", 512<<10)
	for range 3 {
		a.input(paste)
	}
	waitHost(t, s, a, "the input never waited for room: the write is not blocked", func(cs channelStats) bool { return cs.roomWaits >= 1 })
	a.closeTerminal()
	guarded(t, "close-while-input-waits", func() {
		st := a.waitClosed()
		require.Len(t, st.ended, 1, "the holder is told how it ended")
		assert.Equal(t, EndClosed, st.ended[0].Reason)
	})
}

// The detach of a page that leaves does not wait for input that waits for room, and input the host had begun to admit is applied before
// the terminal is let go.
func TestADetachAfterInputKeepsTheInputThatWasTakenIn(t *testing.T) {
	m, info, _, dev := wireTerminal(t, `sleep 600`)
	dev.openAll()
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a.input("last words")
	a.detach()
	a.waitServed()
	require.Eventually(t, func() bool { return len(dev.log()) == 1 }, settle, 1e6, "the input was applied")
	assert.Equal(t, []string{"w:last words"}, dev.log())
}

// A stream that types more than the host will hold for a terminal that does not read is closed (the page resends from input_applied):
// the terminal is let go and its lease runs.
func TestAStreamThatSendsMoreInputThanTheHostHoldsForABlockedTerminalIsClosedAndTheLeaseRuns(t *testing.T) {
	m, info, s, dev := wireTerminal(t, `sleep 600`)
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a.input("first")
	require.Equal(t, "w:first", dev.waitEntered(t), "the write is blocked in the device")
	chunk := strings.Repeat("y", 1<<20)
	for range 12 {
		a.input(chunk)
	}
	guarded(t, "input-overflow-closes", func() {
		a.waitClosed()
		waitHost(t, s, nil, "the terminal was never let go", func(cs channelStats) bool { return !cs.held })
		detached, _, lease, _ := s.state()
		assert.True(t, detached)
		assert.True(t, lease, "the lease runs")
	})
	dev.openAll()
}

// THE COUNT IS A WRITER'S. Feed X types three bytes; feed Y attaches and is told 0, not 3, types two; feed X comes back and is told 3,
// feed Y comes back and is told 2.
func TestTheInputCountIsTheWritersOwnAcrossStreamsOfOtherWriters(t *testing.T) {
	m, info, _, dev := wireTerminal(t, `sleep 600`)
	dev.openAll()
	x, y := writerID(1), writerID(2)
	a := m.attachAs(t, info.Cap, x)
	a.waitReady()
	a.input("abc")
	a.waitFor("applied 3", appliedIs(3))
	b := m.attachAs(t, info.Cap, y)
	guarded(t, "writer-count", func() { assert.Zero(t, b.waitReady().InputApplied, "what feed X typed is not feed Y's") })
	b.waitReady()
	b.input("zz")
	guarded(t, "writer-count", func() {
		st := b.waitFor("applied 2", appliedIs(2))
		assert.Empty(t, st.faults)
	})
	a2 := m.attachAs(t, info.Cap, x)
	guarded(t, "writer-count", func() { assert.EqualValues(t, 3, a2.waitReady().InputApplied) })
	b2 := m.attachAs(t, info.Cap, y)
	guarded(t, "writer-count", func() { assert.EqualValues(t, 2, b2.waitReady().InputApplied) })
}

// A writer that is not 32 lowercase hex digits is a malformed attach (the one not-found); the host keeps the last eight writers of a
// terminal and a writer it does not know starts at 0.
func TestAWriterIsValidatedAndTheHostKeepsTheLastEight(t *testing.T) {
	m, info, _, dev := wireTerminal(t, `sleep 600`)
	dev.openAll()
	for name, writer := range map[string]string{"too short": "abc", "not hex": strings.Repeat("g", 32), "upper case": strings.Repeat("A", 32), "too long": strings.Repeat("a", 33)} {
		_, frame := firstFrame(t, m, attachFrameAs(info.Cap, writer))
		guarded(t, "writer-validated", func() { assert.Equal(t, []byte{wNotFound}, frame, name) })
	}
	for n := 1; n <= 9; n++ {
		p := m.attachAs(t, info.Cap, writerID(n))
		p.waitReady()
		p.input("1")
		p.waitFor("applied 1", appliedIs(1))
	}
	guarded(t, "writer-bound", func() {
		assert.Zero(t, m.attachAs(t, info.Cap, writerID(1)).waitReady().InputApplied, "the oldest writer was forgotten: it starts at 0")
		assert.EqualValues(t, 1, m.attachAs(t, info.Cap, writerID(9)).waitReady().InputApplied, "the newest is remembered")
	})
}

// A write that returns part of its bytes and fails counts the part, for the next ready as well: the bytes it did not write are not
// reported as applied.
func TestAShortWriteThatFailsIsNotCountedByTheNextReady(t *testing.T) {
	m, info, s, _ := wireTerminal(t, `sleep 600`)
	s.useDevice(shortDevice{took: 2})
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a.input("abcd")
	a.waitFor("applied 2", appliedIs(2))
	b := m.attach(t, info.Cap, nil)
	guarded(t, "ready-short-write", func() { assert.EqualValues(t, 2, b.waitReady().InputApplied, "the host wrote two of the four") })
	b.waitReady()
}

// An acknowledgement is acted on as it is read, like a close: a write that blocks in the kernel and input that waits for room behind it
// do not freeze the output's flow control. The window is turned on, a paste fills the terminal's queue, and the page's acknowledgements
// still free the window: it is given far more than a window of output.
func TestAcknowledgementsStillFreeTheWindowWhileAnInputWriteIsBlocked(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	hold := newGate(t)
	info := m.startChannel(t, headGateFlood("up\\n", hold), Options{})
	s := m.chanOf(t, info)
	dev := newGatedDevice()
	s.useDevice(dev)
	a := m.attachAcking(t, info.Cap, nil, 1)
	a.waitReady()
	a.ack(0) // turns the window on: the page holds at most inflight bytes unacknowledged
	chunk := strings.Repeat("z", 1<<20)
	a.input(chunk)
	require.Equal(t, "w:"+chunk, dev.waitEntered(t), "the write is blocked in the device")
	a.input(chunk)
	waitHost(t, s, a, "the second input never waited for room", func(cs channelStats) bool { return cs.roomWaits >= 1 })
	// The lane is frozen by the test: its lock is held, so that an acknowledgement that waits for the lane in any form (behind the
	// input, for it to settle, for its lock) cannot be acted on; an acknowledgement that is acted on as it is read does not touch it.
	s.mu.Lock()
	lane := s.channel.holder.lane
	s.mu.Unlock()
	lane.mu.Lock()
	unfreeze := sync.OnceFunc(lane.mu.Unlock)
	defer unfreeze()
	hold.release(t)
	guarded(t, "ack-inline", func() {
		a.waitBytes(4 * 64 << 10)
	})
	unfreeze()
	dev.openAll()
}

// The host says whether it remembers the writer: a writer it has a count for is known, and one it has never seen, or forgot (the ninth
// of a terminal, a host that restarted), or an attach that names none, is not: the page that had input unconfirmed for a writer that
// is not known drops it, for it cannot know what the host applied.
func TestReadySaysWhetherTheHostKnowsTheWriter(t *testing.T) {
	m, info, _, dev := wireTerminal(t, `sleep 600`)
	dev.openAll()
	first := m.attachAs(t, info.Cap, writerID(1))
	guarded(t, "writer-known", func() {
		assert.False(t, first.waitReady().WriterKnown, "a feed's first attach: the host has never seen the writer")
	})
	first.waitReady()
	first.input("1")
	first.waitFor("applied 1", appliedIs(1))
	again := m.attachAs(t, info.Cap, writerID(1))
	guarded(t, "writer-known", func() { assert.True(t, again.waitReady().WriterKnown, "the same writer again is known") })
	again.waitReady()
	for n := 2; n <= 9; n++ {
		m.attachAs(t, info.Cap, writerID(n)).waitReady()
	}
	forgotten := m.attachAs(t, info.Cap, writerID(1))
	guarded(t, "writer-known", func() {
		ready := forgotten.waitReady()
		assert.False(t, ready.WriterKnown, "the oldest writer was forgotten")
		assert.Zero(t, ready.InputApplied)
	})
	forgotten.waitReady()
	guarded(t, "writer-known", func() {
		assert.False(t, m.attachAs(t, info.Cap, "").waitReady().WriterKnown, "an attach that names no writer has none to know")
	})
}
