//go:build !windows

package terminal

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE FINDINGS OF THE REVIEW OF PR 704 THAT ARE FAULTS OF THE HOST (the status file of T3-channel, section 2f). Each test is written to
// fail on the head that was reviewed, by its own assertion, and to pass with the fix. The order of two events is forced by a gate, a
// parked Send or a clock the test moves; no wait decides an outcome.

// headGateTail is a script that writes head, waits for the gate and writes tail: a terminal whose first bytes are there before a page
// takes it, and whose next bytes come when the test says. The shell forks nothing, as the counting script's does.
func headGateTail(head string, hold gate, tail string) string {
	return `exec perl -e 'system("stty -opost -echo"); $|=1; print "` + head + `"; open(my $g, "<", "` + hold.path + `") or exit 2; ` +
		`my $line = <$g>; close($g); print "` + tail + `"; exec("sleep", "3600")'`
}

// The replay and the live output. The ready frame says where the replay ends (`end`, where the shell had written to when the page took
// the terminal), and the page writes what is below it muted, with the size and the modes it began under, and then resizes: a frame
// that begins in the replay and ends past it mixes the two, and the page cannot tell where the replay stops. The shell wrote four
// bytes before the stream took the terminal and four more before its sender first looked at the ring: the first frame is the replay
// and the second is live, never one of eight bytes.
func TestAChannelOutputFrameNeverStraddlesTheEndOfTheReplay(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	hold := newGate(t)
	info := m.startChannel(t, headGateTail("ABCD", hold, "EFGH"), Options{})
	s := m.chanOf(t, info)
	waitHost(t, s, nil, "the child never wrote its head", func(st channelStats) bool { return st.end >= 4 })
	f := newFakeChannel(t)
	f.park(0) // the ready frame parks in the transport: the stream holds the terminal and has not begun to send
	page := m.attachOn(t, f, info.Cap, nil, 0)
	require.Eventually(t, func() bool { begun, _ := f.counts(); return begun >= 1 }, settle, time.Millisecond, "the ready frame is in the transport")
	hold.release(t)
	waitHost(t, s, nil, "the child never wrote its tail", func(st channelStats) bool { return st.end >= 8 })
	f.release()
	st := page.waitFor("all of the output", func(ps pageState) bool { return ps.next >= 8 })

	require.NotNil(t, st.ready)
	require.EqualValues(t, 4, st.ready.End, "the page took the terminal when the shell had written its head")
	guarded(t, "replay-live-split", func() {
		for _, seg := range st.segs {
			end := seg.offset + uint64(len(seg.data))
			assert.False(t, seg.offset < st.ready.End && end > st.ready.End,
				"the output frame [%d, %d) begins in the replay and ends in the live output: the replay ends at %d", seg.offset, end, st.ready.End)
		}
	})
	assert.Empty(t, st.faults)
}

// The retention of the ends. The ends of channel terminals and of the events lane's are kept under budgets of their own: a page of
// the events lane is owed the end of its terminal whatever the channel terminals around it do, and a page that holds a capability
// is owed the end of its terminal whatever the other lane does. One oldest-first limit shared by both let sixteen channel terminals
// that ended take away the end of an events lane terminal that was still within its lease.
func TestAChannelTerminalsThatEndCannotEvictTheEndOfAnEventsLaneTerminal(t *testing.T) {
	m, sink := newPageManager(t)
	legacy := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "w1", Options{})
	sink.waitFor(t, legacy.ID, "up\r\n")
	m.ReleaseOwned("w1", ClosedByWindow)
	m.endTheShellWith(legacy.ID, 0, "go\n")
	sink.waitEnd(t, legacy.ID)
	require.Eventually(t, func() bool {
		listed := m.List(nil, testKey)
		return len(listed) == 1 && listed[0].Ended != nil
	}, settle, 5*time.Millisecond, "the end of the events lane's terminal is kept for its page")

	for range ChannelTombstoneLimit + 4 {
		m.startChannel(t, `exit 0`, Options{})
	}
	require.Eventually(t, func() bool { return len(m.running()) == 0 }, settle, 5*time.Millisecond, "every channel terminal ended")

	guarded(t, "tombstone-lanes", func() {
		listed := m.List(nil, testKey)
		require.Len(t, listed, 1, "the end of the events lane's terminal is still there for its page")
		assert.Equal(t, legacy.ID, listed[0].ID)
		assert.NotNil(t, listed[0].Ended)
	})
}

func TestEventsLaneTerminalsThatEndCannotEvictTheEndOfAChannelTerminal(t *testing.T) {
	m, sink := newPageManager(t)
	kept := m.startChannel(t, `exit 3`, Options{})
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, settle, 5*time.Millisecond, "the end of the channel terminal is kept")

	var infos []Session
	for range TombstoneLimit + 4 {
		info := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "w1", Options{})
		sink.waitFor(t, info.ID, "up\r\n")
		infos = append(infos, info)
	}
	m.ReleaseOwned("w1", ClosedByWindow)
	for _, info := range infos {
		m.endTheShellWith(info.ID, 0, "go\n")
		sink.waitEnd(t, info.ID)
	}
	require.Eventually(t, func() bool { return len(m.running()) == 0 }, settle, 5*time.Millisecond, "the last terminal is gone from the manager")

	guarded(t, "tombstone-lanes", func() {
		listed, err := m.ListChannels([]string{kept.Cap})
		require.NoError(t, err)
		require.Len(t, listed, 1, "the end of the channel terminal is still there for its capability")
		assert.NotNil(t, listed[0].Ended)
	})
	assert.LessOrEqual(t, m.tombstoneCount(), TombstoneLimit+ChannelTombstoneLimit, "each lane's budget is bounded")
}

// The progress of a page is measured on the monotonic clock. A time that is made from UnixNano has none: a wall clock that is set
// back (by a person, or by the time service) makes the last progress lie in the future by as much, and the pump holds the shell of a
// page that sleeps for that long instead of for the stall.
func TestAChannelStreamsProgressKeepsTheMonotonicReadingOfTheClock(t *testing.T) {
	c := newChannelConn(newFakeChannel(t), wallClock{})
	c.progress()
	guarded(t, "monotonic-progress", func() {
		assert.Contains(t, c.lastProgress().String(), " m=", "the stamp of the last progress has the monotonic reading of the clock it was taken on")
	})
	assert.WithinDuration(t, time.Now(), c.lastProgress(), time.Minute, "and it is when the progress was")
}

// The stall timer is armed for the deadline. The clock moves half of the stall while the timer is being registered, after the pump
// has computed how long to wait: a timer that waits for what was computed fires half a stall late. The clock then moves to exactly
// the deadline, and the pump must be let go.
func TestAChannelStallTimerIsArmedForTheDeadlineWhenTheClockMovesPartwayWhileItIsArmed(t *testing.T) {
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
	moved := make(chan struct{})
	half := m.channel.stall / 2
	clock.arm(func() {
		clock.Advance(half)
		close(moved)
	})
	hold.release(t)
	select {
	case <-moved:
	case <-time.After(settle):
		require.Fail(t, "the pump never armed its timer")
	}
	require.Eventually(t, func() bool { return clock.pending() >= 1 }, settle, time.Millisecond, "the timer is registered")

	clock.Advance(m.channel.stall - half) // exactly the deadline
	guarded(t, "stall-timer-deadline", func() {
		waitHost(t, s, page, "the stall never let the pump go: its timer was armed for a moment later than the deadline",
			func(st channelStats) bool { return st.stallReleases >= 1 })
	})
}

// A listing is of a terminal that is running when its snapshot is taken. A shell that ends between the test that it is running and
// the snapshot would otherwise be listed as running with the offset it wrote last.
func TestAChannelListedIsNotTakenOfATerminalThatEndedBeforeItsSnapshot(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	s := m.chanOf(t, info)
	listed, ok := s.channelListed()
	require.True(t, ok, "a terminal that is running is listed")
	assert.Nil(t, listed.Ended)

	s.ending.Store(true) // the shell ended after ListChannels looked, and before the snapshot
	t.Cleanup(func() { s.ending.Store(false) })
	guarded(t, "list-after-snapshot", func() {
		_, ok = s.channelListed()
		assert.False(t, ok, "a snapshot taken once the terminal has ended is not an entry of a running terminal")
	})
}

// The end that a list shows is a copy. A Go caller that changes the exit status it was given changes its own copy, and the end that
// the next list and the next stream are told is the shell's.
func TestAChannelListedEndIsACopyThatNoCallerCanChange(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `exit 3`, Options{})
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, settle, 5*time.Millisecond, "the end is kept")
	listed, err := m.ListChannels([]string{info.Cap})
	require.NoError(t, err)
	require.Len(t, listed, 1)
	require.NotNil(t, listed[0].Ended)
	require.NotNil(t, listed[0].Ended.ExitCode)
	assert.Equal(t, 3, *listed[0].Ended.ExitCode)
	*listed[0].Ended.ExitCode = 0 // a Go caller changes what it was given

	guarded(t, "end-is-a-copy", func() {
		again, listErr := m.ListChannels([]string{info.Cap})
		require.NoError(t, listErr)
		require.Len(t, again, 1)
		assert.Equal(t, 3, *again[0].Ended.ExitCode, "what the caller changed is its own copy")
		page := m.attach(t, info.Cap, nil)
		st := page.waitClosed()
		require.Len(t, st.ended, 1)
		assert.Equal(t, 3, *st.ended[0].ExitCode, "and the end that the next stream is told is the shell's")
	})
}

func TestAnEndsCopyShareNothingWithTheEnd(t *testing.T) {
	code := 3
	end := End{Reason: EndExited, ExitCode: &code, Failure: &Failure{Stage: StageRead, Message: "read failed"}}
	got := end.clone()
	*got.ExitCode = 0
	got.Failure.Message = "changed"
	guarded(t, "end-is-a-copy", func() {
		assert.Equal(t, 3, code, "the exit status of the copy is a copy")
		assert.Equal(t, "read failed", end.Failure.Message, "and so is the failure")
	})
}

// A channel terminal belongs to no window. The manager refuses an owner for one, so that no caller can make a channel terminal that a
// window going away would end or keep.
func TestAChannelTerminalTakesNoOwner(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	_, err := m.Start(Options{Command: []string{sh(t), "-c", "sleep 600"}, Channel: true}, Owner("wA"))
	guarded(t, "channel-takes-no-owner", func() {
		require.Error(t, err, "a channel terminal takes no owner")
		require.ErrorIs(t, err, ErrInvalid, "it is the refusal of an invalid request")
		assert.Empty(t, m.running(), "and no shell was started")
	})
}

// The input queue holds at most what it is bound to. A write that blocks in the kernel keeps its bytes in the count, and an input
// that does not fit the room that is left waits for it, even when the queue is not full: 512 KiB pending and a valid frame of 1 MiB
// are more than the 1 MiB that the protocol says the queue holds.
func TestAChannelInputThatDoesNotFitTheRoomLeftInTheQueueWaitsForIt(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `sleep 600`, Options{})
	s := m.chanOf(t, info)
	dev := newGatedDevice()
	s.useDevice(dev)
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a.input(strings.Repeat("a", 512<<10))
	require.Len(t, dev.waitEntered(t), 2+512<<10, "A's write is being applied, and does not return")

	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	b.input(strings.Repeat("b", ChannelMaxInputBytes))
	st := waitHost(t, s, b, "B's input never reached the queue's admission", func(st channelStats) bool { return st.roomWaits >= 1 || st.admitted >= 2 })
	guarded(t, "queue-bound", func() {
		assert.EqualValues(t, 1, st.admitted, "512 KiB are pending, and 1 MiB more does not fit the 1 MiB the queue is bound to")
		assert.GreaterOrEqual(t, st.roomWaits, uint64(1), "B's input waits for the room")
	})

	dev.openAll()
	require.Eventually(t, func() bool { return len(dev.log()) >= 2 }, settle, time.Millisecond, "B's input is applied once the write that held the queue has returned")
	assert.Len(t, dev.log()[1], 2+ChannelMaxInputBytes)
}
