//go:build !windows

package terminal

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE STREAM OF A CHANNEL TERMINAL: THE HANDSHAKE, THE REPLAY AND THE LIVE OUTPUT ON ONE CONNECTION, THE END, THE LEASE.
//
// Where a stream shows a capability that opens a terminal the host answers `ready`, and then one ordered connection carries
// the bytes from the offset the page has, the replay of what the ring holds and everything the shell writes after it, with no
// gap and no byte twice at the join: it is one read of the ring, and nothing joins. A stream that ends leaves the terminal
// detached with its lease running; the end of the terminal is sent after its last output and the stream closes. The leases
// run on a clock a test moves.

func (s pageState) hasNoGaps() bool {
	for _, kind := range s.order {
		if kind == wGap {
			return false
		}
	}
	return true
}

// The ready frame comes first and says where the replay starts and ends, the size and the modes, where the shell is and
// what holds it; the replay and what the shell writes next follow on the same stream, each output starting where the one
// before ended. Nothing in the stream is the capability, and nothing goes to the events lane.
func TestAttachSendsReadyThenTheReplayThenLiveOutputOnOneOrderedStream(t *testing.T) {
	m, sink := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `stty -echo -opost; printf 'one\ntwo\n'; read go; printf 'three\nfour\n'; read x`, Options{Cols: 100, Rows: 30})
	s := m.chanOf(t, info)
	require.Eventually(t, func() bool { return s.channelStats().end == 8 }, settle, 2*time.Millisecond, "the shell wrote its first lines before the page came")

	page := m.attach(t, info.Cap, nil)
	ready := page.waitReady()
	page.waitBytes(8)
	page.input("go\n")
	const all = "one\ntwo\nthree\nfour\n"
	st := page.waitBytes(len(all))

	guarded(t, "ready-first", func() {
		assert.Equal(t, wReady, st.order[0], "the first frame is ready")
		assert.Equal(t, 2, ready.V)
		assert.Zero(t, ready.Start, "the replay starts at the first byte the host kept")
		assert.EqualValues(t, 8, ready.End, "and ends where the shell had written to when the page took the terminal")
		assert.Zero(t, ready.Lost)
		assert.Equal(t, Size{Cols: 100, Rows: 30}, ready.Size)
		assert.Equal(t, Size{Cols: 100, Rows: 30}, ready.StartSize)
		assert.True(t, ready.Modes.Known)
		assert.True(t, ready.StartModes.Known)
		assert.NotEmpty(t, ready.Cwd.Path, "where the shell is")
		assert.Equal(t, StateIdle, ready.Busy.State, "and what holds it")
		assert.Equal(t, info.ID, ready.Session.ID, "what the host said when the terminal started, so that a reloaded page has it again")
		assert.Empty(t, ready.Session.Cap, "without the capability")
		assert.Equal(t, int(LeaseDefault/time.Millisecond), ready.LeaseMs, "and how long the terminal is kept when this stream ends")
		assert.Nil(t, ready.Ended)
	})
	guarded(t, "ordered-join", func() {
		assert.Equal(t, all, string(st.bytes()), "the replay and what the shell wrote next, in one sequence")
		assert.Empty(t, st.faults, "each output starts where the one before ended")
		assert.True(t, st.hasNoGaps(), "nothing was lost, so nothing says it was")
		assert.EqualValues(t, 0, st.segs[0].offset)
		assert.EqualValues(t, len(all), st.next)
	})
	guarded(t, "no-legacy-event", func() {
		assert.Zero(t, sink.plainCalls(info.ID), "a channel terminal sends no event of the events lane")
		assert.Empty(t, sink.raw(info.ID))
		assert.Empty(t, sink.closes(info.ID))
		assert.Empty(t, sink.detachments(info.ID))
	})
}

// The join of the replay and the live output, tested where it is hardest: a page that takes the terminal while the shell is
// in the middle of a flood. Each page takes the terminal at another place of the flood, and what it has, byte by byte, is the
// sequence the child wrote from the first byte: no gap, no byte twice.
func TestAnAttachUnderAFloodJoinsTheReplayAndTheLiveOutputWithoutAGapOrADuplicate(t *testing.T) {
	m, _ := newChannelManager(t, func(l *channelLimits) {
		l.ring = 8 << 20
	})
	for round := range 6 {
		info := m.startChannel(t, countingScript(-1, gate{}), Options{})
		s := m.chanOf(t, info)
		at := uint64(40<<10) * uint64(round+1)
		require.Eventually(t, func() bool { return s.channelStats().end >= at }, settle, time.Millisecond, "the flood reached %d", at)

		page := m.attachAcking(t, info.Cap, nil, 32<<10)
		ready := page.waitReady()
		want := int(at) + 300<<10
		st := page.waitBytes(want)

		guarded(t, "ordered-join", func() {
			require.Zero(t, ready.Start, "round %d", round)
			assert.Empty(t, st.faults, "round %d: each output starts where the one before ended", round)
			assert.True(t, st.hasNoGaps(), "round %d", round)
			got := st.bytes()
			assert.Equal(t, countingBytes(0, uint64(len(got))), got, "round %d: the page has what the child wrote, byte for byte", round)
		})
		require.NoError(t, m.CloseChannel(info.Cap))
	}
}

// A terminal that ends sends the end after its last output and then the stream closes, and its capability still opens what it
// left: the host keeps the end and the output until it is dismissed or the lease would have run out. A page that comes back
// is told how it ended, handed what it wrote from the offset it asks for, and the end comes again after it. Nothing of this goes
// to the events lane.
func TestTheEndOfATerminalIsSentAfterItsLastOutputAndTheStreamClosesAndTheCapabilityStaysValidUntilDismissed(t *testing.T) {
	m, sink := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `stty -echo -opost; printf 'hello\n'; read x; printf 'bye\n'; exec sh -c 'exit 3'`, Options{})
	page := m.attach(t, info.Cap, nil)
	page.waitBytes(6)
	page.input("\n")
	page.waitFor("the end", func(s pageState) bool { return len(s.ended) > 0 })
	page.waitClosed()
	page.waitServed()
	st := page.state()

	guarded(t, "ended-after-last-output", func() {
		require.Len(t, st.ended, 1)
		assert.Equal(t, EndExited, st.ended[0].Reason)
		require.NotNil(t, st.ended[0].ExitCode)
		assert.Equal(t, 3, *st.ended[0].ExitCode)
		assert.EqualValues(t, 10, st.ended[0].LastOffset, "the length of everything the shell wrote")
		assert.Equal(t, "hello\nbye\n", string(st.bytes()), "every byte comes before the end")
		assert.Equal(t, wEnded, st.order[len(st.order)-1], "the end is the last frame")
		assert.True(t, st.closed, "and then the stream closes")
		assert.Empty(t, st.faults)
	})

	listed, err := m.ListChannels([]string{info.Cap})
	require.NoError(t, err)
	require.Len(t, listed, 1, "the end is kept")
	require.NotNil(t, listed[0].Ended)
	assert.Equal(t, 3, *listed[0].Ended.ExitCode)
	assert.False(t, listed[0].Attached)
	assert.EqualValues(t, 10, listed[0].NextOffset)

	again := m.attach(t, info.Cap, nil)
	again.waitClosed()
	again.waitServed()
	a := again.state()
	require.NotNil(t, a.ready)
	require.NotNil(t, a.ready.Ended, "a page that comes back is told how it ended")
	assert.Equal(t, 3, *a.ready.Ended.ExitCode)
	assert.EqualValues(t, 10, a.ready.End)
	assert.Equal(t, "hello\nbye\n", string(a.bytes()), "and is handed what the shell wrote")
	require.Len(t, a.ended, 1, "and the end comes again after the output")
	assert.Equal(t, wEnded, a.order[len(a.order)-1])
	assert.Empty(t, a.faults)

	from := uint64(6)
	rest := m.attach(t, info.Cap, &from)
	rest.waitClosed()
	assert.Equal(t, "bye\n", string(rest.state().bytes()), "from the offset it has")

	require.NoError(t, m.DismissChannel(info.Cap))
	after, err := m.ListChannels([]string{info.Cap})
	require.NoError(t, err)
	assert.Empty(t, after)
	late := m.attach(t, info.Cap, nil)
	late.waitClosed()
	assert.Equal(t, 1, late.state().notFound, "a dismissed end opens nothing")
	requireNoCapabilityFor(t, m.DismissChannel(info.Cap), info.Cap)

	guarded(t, "no-legacy-event", func() {
		assert.Empty(t, sink.closes(info.ID), "no CLOSE event")
		assert.Zero(t, sink.plainCalls(info.ID))
		assert.Empty(t, sink.detachments(info.ID))
	})
}

// A terminal that ended by itself while no stream held it is kept for what is left of its lease: its end and what it wrote
// are there for a stream that comes back, and are freed when the lease would have run out (a clock the test moves).
func TestATerminalThatEndsWhileNoStreamHoldsItIsKeptUntilItsLeaseWouldHaveRunOut(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := withFakeClock(m)
	info := m.startChannel(t, `printf 'x\n'; exit 0`, Options{LeaseMs: 2000})
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, settle, 2*time.Millisecond, "the end is kept")

	clock.Advance(1999 * time.Millisecond)
	listed, err := m.ListChannels([]string{info.Cap})
	require.NoError(t, err)
	require.Len(t, listed, 1, "it is there until the lease is over")
	page := m.attach(t, info.Cap, nil)
	page.waitClosed()
	require.NotNil(t, page.state().ready)
	assert.NotNil(t, page.state().ready.Ended)

	clock.Advance(2 * time.Millisecond)
	assert.Zero(t, m.tombstoneCount(), "and freed once it is over")
	listed, err = m.ListChannels([]string{info.Cap})
	require.NoError(t, err)
	assert.Empty(t, listed)
	late := m.attach(t, info.Cap, nil)
	late.waitClosed()
	assert.Equal(t, 1, late.state().notFound)
}

// A stream that ends, however it ends, detaches the terminal: nobody holds it, the shell goes on, its lease starts at the
// moment the stream ended and ends the terminal at the end of it (`detach-timeout`), a page that comes back before takes it
// and stops the lease. A fresh terminal that no stream ever held is on a lease from the moment it was made.
func TestAStreamThatEndsDetachesTheTerminalAndTheLeaseEndsItAtTheTimeStated(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := withFakeClock(m)
	info := m.startChannel(t, `sleep 600`, Options{LeaseMs: 2000})
	s := m.chanOf(t, info)
	page := m.attach(t, info.Cap, nil)
	page.waitReady()

	guarded(t, "attach-stops-the-lease", func() {
		detached, owner, leaseRunning, _ := s.state()
		assert.False(t, detached)
		assert.Nil(t, owner)
		assert.False(t, leaseRunning, "a held terminal has no lease running")
		assert.True(t, s.channelStats().held)
		listed, err := m.ListChannels([]string{info.Cap})
		require.NoError(t, err)
		require.Len(t, listed, 1)
		assert.True(t, listed[0].Attached)
		assert.Zero(t, listed[0].LeaseExpiresUnixMs)
	})

	page.close()
	page.waitServed()
	guarded(t, "stream-end-detaches", func() {
		detached, owner, leaseRunning, _ := s.state()
		assert.True(t, detached, "the stream was the holder")
		assert.Nil(t, owner)
		assert.True(t, leaseRunning)
		assert.False(t, s.channelStats().held)
		listed, err := m.ListChannels([]string{info.Cap})
		require.NoError(t, err)
		require.Len(t, listed, 1)
		assert.False(t, listed[0].Attached)
		assert.Equal(t, clock.Now().Add(2*time.Second).UnixMilli(), listed[0].LeaseExpiresUnixMs, "the lease ends two seconds after the stream did")
		assert.False(t, gone(info.PID), "the shell goes on")
	})

	clock.Advance(1999 * time.Millisecond)
	assert.False(t, s.settled().set, "it is kept until the lease is over")
	assert.False(t, gone(info.PID))
	clock.Advance(2 * time.Millisecond)
	require.Eventually(t, func() bool { return s.settled().closedBy == ClosedByDetachTimeout }, settle, time.Millisecond, "the lease ended it")
	requireGone(t, info.PID, "a terminal whose lease ran out")
}

func TestAFreshChannelTerminalThatNoStreamEverHoldsEndsAtItsLease(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := withFakeClock(m)
	info := m.startChannel(t, `sleep 600`, Options{LeaseMs: 2000})
	s := m.chanOf(t, info)

	clock.Advance(1999 * time.Millisecond)
	assert.False(t, s.settled().set)
	clock.Advance(2 * time.Millisecond)
	require.Eventually(t, func() bool { return s.settled().closedBy == ClosedByDetachTimeout }, settle, time.Millisecond)
	requireGone(t, info.PID, "a terminal nobody ever held")
	late := m.attach(t, info.Cap, nil)
	late.waitClosed()
	assert.Equal(t, 1, late.state().notFound, "a terminal whose lease ran out is not there to take")
}

// A page that leaves says so with a detach frame and the terminal is let go at once, without waiting for the transport to
// notice that the stream is gone; a page that comes back by offset takes it, byte for byte from where it stopped.
func TestADetachFrameLetsTheTerminalGoAtOnceAndTheNextStreamResumesByOffset(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, `stty -echo -opost; printf 'one\ntwo\n'; read go; printf 'three\n'; read x`, Options{})
	page := m.attach(t, info.Cap, nil)
	page.waitBytes(8)

	page.detach()
	page.waitServed()
	assert.True(t, page.isClosed())
	assert.False(t, m.chanOf(t, info).channelStats().held)

	from := uint64(8)
	next := m.attach(t, info.Cap, &from)
	ready := next.waitReady()
	assert.EqualValues(t, 8, ready.Start, "the replay starts where the page has stopped")
	assert.EqualValues(t, 8, ready.End)
	assert.Zero(t, ready.Lost)
	next.input("go\n")
	st := next.waitBytes(len("three\n"))
	assert.Equal(t, "three\n", string(st.bytes()))
	assert.EqualValues(t, 8, st.segs[0].offset)
	assert.Empty(t, st.faults)
}

// A stream whose transport is blocked (a page that is not reading, as a hidden one does not) and whose connection then goes
// away is still served to its end: the Send that is parked returns when the connection closes, and the terminal is detached.
func TestAStreamWhoseSendIsParkedStillDetachesTheTerminalWhenItsConnectionGoesAway(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	hold := newGate(t)
	info := m.startChannel(t, countingScript(-1, hold), Options{})
	f := newFakeChannel(t)
	f.park(1)
	page := m.attachOn(t, f, info.Cap, nil, 0)
	page.waitReady()
	hold.release(t)
	require.Eventually(t, func() bool { begun, taken := f.counts(); return begun >= 2 && taken == 1 }, settle, time.Millisecond, "the first output frame is parked in Send")

	page.close()
	page.waitServed()
	assert.False(t, m.chanOf(t, info).channelStats().held)
	assert.False(t, gone(info.PID), "the shell goes on")
}
