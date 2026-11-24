//go:build !windows

package terminal

import (
	"bytes"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE HIDDEN-PAGE POLICY (decided by Main from the native finding: a locked screen or a hidden window suspends the page, which
// then cannot read or acknowledge; docs/ui-next/terminal-channel-protocol.md, "A page that sleeps").
//
// A running shell is never stalled for ever at a credit limit. The host reads the shell into a bounded ring whatever the page
// does; the ring overwrites its oldest bytes and counts them. A stream's sender reads the ring at the pace of its page. While the
// page is alive (a frame taken, or an acknowledgement, within the stall) and more than the high mark waits unsent, the shell is
// paced until the low mark: a slow page loses nothing. A page that made no progress for the stall, or none attached, never
// holds the shell. When the page comes back, the stream says exactly what it missed.
//
// The trigger of every test here is bytes written, an offset, and never a duration; the stall is decided by a clock the test
// moves, and no outcome by a sleep. The child writes the counting sequence, so that every byte is known from its offset.

// requireTheRingHoldsTheNewest reads a terminal that has ended (nothing writes its ring any more): the ring holds exactly the
// newest bytes of the sequence the child wrote, in whole chunks and no more than its limit, and what it dropped is counted.
func requireTheRingHoldsTheNewest(t *testing.T, s *session, limit int) {
	t.Helper()
	stats := s.channelStats()
	got := s.retained()
	kept := uint64(len(got))
	assert.Equal(t, kept, stats.kept, "what the ring says it holds is what it holds")
	assert.Equal(t, stats.end-kept, stats.start, "it holds the end of the output")
	assert.LessOrEqual(t, kept, uint64(limit), "and no more than its limit")
	if stats.end > uint64(limit) {
		assert.Greater(t, kept, uint64(limit)-4*chunkBytes, "and not much less: it drops whole chunks, oldest first")
	}
	guarded(t, "ring-counts", func() {
		assert.Equal(t, stats.end-kept, stats.overwritten, "what it overwrote is counted: overwritten is the output less what the ring holds")
	})
	guarded(t, "newest-bytes", func() {
		assert.True(t, bytes.Equal(countingBytes(stats.start, kept), got), "the ring holds the newest %d bytes of the sequence, byte for byte", kept)
	})
	t.Logf("ring: output %d, kept %d, overwritten %d, start %d", stats.end, kept, stats.overwritten, stats.start)
}

// A page that does not read: the first frame it was given parks in its transport for good. The child writes more than twenty
// rings, which the trigger counts in bytes of output, and is never blocked: the stall (a clock the test moves) lets the shell go,
// the child is alive, the host's heap grew by no more than the ring and a constant, and the ring holds exactly the newest bytes
// of the sequence with every byte it overwrote counted.
func TestAChildNeverBlocksWhenNoReaderTakesAFrame(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := withFakeClock(m)
	hold := newGate(t)
	info := m.startChannel(t, countingScript(-1, hold), Options{})
	s := m.chanOf(t, info)
	f := newFakeChannel(t)
	f.park(1) // the ready frame is taken; every frame of output parks: a page that sleeps
	page := m.attachOn(t, f, info.Cap, nil, 0)
	page.waitReady()
	before := heapInUse()
	hold.release(t)
	require.Eventually(t, func() bool { return s.channelStats().waits >= 1 }, settle, time.Millisecond, "the pump waited for a page that was alive")

	clock.Advance(m.channel.stall) // the page made no progress for the stall: it is asleep
	ring := uint64(m.channel.ring)
	guarded(t, "stall-release", func() {
		require.Eventually(t, func() bool { return s.channelStats().end >= 20*ring }, settle, time.Millisecond,
			"the child never wrote 20 rings: it was blocked at %d", s.channelStats().end)
	})
	stats := s.channelStats()
	after := heapInUse()
	guarded(t, "child-not-blocked", func() {
		assert.Greater(t, stats.end, ring+uint64(m.channel.inflight), "the child's offset went on past the ring and what a page may hold in flight")
		assert.False(t, s.hasExited())
		assert.False(t, gone(info.PID), "and it is alive")
		assert.Zero(t, stats.sent, "no frame of output was ever taken")
		assert.GreaterOrEqual(t, stats.stallReleases, uint64(1))
	})
	bound := ring + 4*chunkBytes + 1<<20
	grew := int64(after) - int64(before)
	t.Logf("no reader: output %d (%.1f rings), heap %d -> %d (grew %d, bound %d), pump waited %d, released by the stall %d",
		stats.end, float64(stats.end)/float64(ring), before, after, grew, bound, stats.waits, stats.stallReleases)
	assert.Less(t, grew, int64(bound), "the host's heap grew by less than the ring and a constant")

	require.NoError(t, m.CloseChannel(info.Cap))
	requireTheRingHoldsTheNewest(t, s, m.channel.ring)
}

// No stream at all: a terminal that nobody holds never holds its shell either. The same child, the same trigger, no clock.
func TestTheShellIsNeverHeldWhileNoStreamHoldsIt(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	info := m.startChannel(t, countingScript(-1, gate{}), Options{})
	s := m.chanOf(t, info)
	ring := uint64(m.channel.ring)

	guarded(t, "no-holder-no-wait", func() {
		require.Eventually(t, func() bool { return s.channelStats().end >= 20*ring }, settle, time.Millisecond, "the child never wrote 20 rings")
		assert.False(t, gone(info.PID))
	})
	require.NoError(t, m.CloseChannel(info.Cap))
	requireTheRingHoldsTheNewest(t, s, m.channel.ring)
}

// The page wakes: the parked Send returns, and the stream says what the ring overwrote meanwhile in one gap frame, then goes on
// from the first byte the ring still has, with the exact sequence. What was delivered and what was lost are all of the output.
func TestAPageThatWakesGetsAGapOfExactlyWhatTheRingOverwroteThenTheExactSequence(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := withFakeClock(m)
	const lines = 800000 // 5,488,888 bytes: more than twenty rings
	total := countingLen(lines)
	hold := newGate(t)
	info := m.startChannel(t, countingScript(lines, hold), Options{})
	s := m.chanOf(t, info)
	f := newFakeChannel(t)
	f.park(1)
	page := m.attachOn(t, f, info.Cap, nil, 0)
	page.waitReady()
	hold.release(t)
	require.Eventually(t, func() bool { return s.channelStats().waits >= 1 }, settle, time.Millisecond)
	clock.Advance(m.channel.stall)
	require.Eventually(t, func() bool { return s.channelStats().end == total }, settle, time.Millisecond, "the child wrote it all with the page asleep")
	stats := s.channelStats()
	first := f.lastSendFrame()
	n0 := uint64(len(first) - 9) // the frame the parked Send holds: its offset is 0
	require.Positive(t, stats.start, "the ring overwrote bytes the sender had not sent")

	f.release()
	// The gap is looked at as soon as the page has read it, before anything else is waited for: a fault in it is found here, at once,
	// and not by a wait for output that a fault in the gap can keep from ever adding up.
	st := page.waitFor("the gap frame", func(s pageState) bool { return len(s.gaps) >= 1 })
	guarded(t, "gap-frame", func() {
		require.Len(t, st.gaps, 1, "one gap: the child had stopped before the page woke")
		require.Equal(t, [2]uint64{n0, stats.start}, st.gaps[0], "from the end of what was sent to the first byte the ring still has")
		require.Equal(t, stats.overwritten-n0, st.gaps[0][1]-st.gaps[0][0], "its length is the overwritten count less what had been sent")
	})
	// What follows the gap: the page's own check that every output frame begins where the one before ended (or the gap), and the bytes.
	// A gap that says the wrong thing is caught by this too, which is why a control for the gap switches both off.
	guarded(t, "gap-continues", func() {
		st = page.waitFor("all of the output", func(s pageState) bool { return s.next == total })
		assert.Empty(t, st.faults, "and the output continues where the gap says it does")
		want := append(countingBytes(0, n0), countingBytes(stats.start, total-stats.start)...)
		assert.True(t, bytes.Equal(want, st.bytes()), "the page has the first frame, then the sequence from the ring's start, byte for byte")
	})
	require.Eventually(t, func() bool { return s.channelStats().sent == total }, settle, time.Millisecond, "the sender gave the page everything")
	after := s.channelStats()
	guarded(t, "lost-counted", func() {
		assert.Equal(t, after.end, after.sentBytes+after.lost, "what was delivered and what was lost are all of the output: sent + gap == end")
		assert.Equal(t, st.gaps[0][1]-st.gaps[0][0], after.lost)
		assert.Equal(t, n0+(total-stats.start), after.sentBytes)
	})
	t.Logf("the page woke: first frame %d, gap [%d, %d) = %d bytes, then %d bytes; output %d = %d + %d", n0, st.gaps[0][0], st.gaps[0][1],
		st.gaps[0][1]-st.gaps[0][0], total-stats.start, total, after.sentBytes, after.lost)
}

// A page that is slow but alive (every frame it takes is within the stall, here a clock that never moves) gets every byte, in order,
// with no gap, and the shell is slowed to its pace: the child's offset is never more than the high mark and one read ahead of what
// the page has been given.
func TestASlowButAlivePageGetsEveryByteAndTheShellIsSlowedToItsPace(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	withFakeClock(m)
	const lines = 150000
	total := countingLen(lines)
	hold := newGate(t)
	info := m.startChannel(t, countingScript(lines, hold), Options{})
	s := m.chanOf(t, info)
	f := newFakeChannel(t)
	f.meter(1) // the ready frame is taken; each frame of output is taken when the test says
	page := m.attachOn(t, f, info.Cap, nil, 0)
	page.waitReady()
	hold.release(t)
	bound := uint64(m.channel.high + DefaultReadBufferSize)

	frames := 0
	for page.state().next < total {
		f.allow(1)
		frames++
		require.Eventually(t, func() bool { _, taken := f.counts(); return taken >= 1+frames }, settle, time.Millisecond, "frame %d was never sent", frames)
		stats := s.channelStats()
		guarded(t, "backpressure-while-alive", func() {
			assert.LessOrEqual(t, stats.end-stats.sent, bound, "frame %d: the shell is paced by the page that is alive", frames)
		})
		if frames == 1 {
			guarded(t, "backpressure-while-alive", func() {
				assert.Less(t, stats.end, total, "the shell has not run to its end ahead of a page that has taken one frame")
			})
		}
	}
	st := page.state()
	stats := s.channelStats()
	guarded(t, "backpressure-while-alive", func() {
		assert.Empty(t, st.gaps, "a page that is alive loses nothing")
		assert.Zero(t, stats.lost)
		assert.Equal(t, countingBytes(0, total), st.bytes(), "every byte, in order")
		assert.Positive(t, stats.waits, "the shell was held for the page")
		assert.Empty(t, st.faults)
	})
	t.Logf("slow page: %d frames for %d bytes, the pump waited %d times, nothing lost", frames, total, stats.waits)
}

// The stall is decided by the clock. With more than the high mark unsent and a page that took nothing, the pump waits; the
// clock moves to just short of the stall and it still waits; past it, it is let go and the child writes on. When the page takes a
// frame again the pump waits again, from the new backlog.
func TestTheStallIsDecidedByTheClockAndNotBeforeIt(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := withFakeClock(m)
	hold := newGate(t)
	info := m.startChannel(t, countingScript(-1, hold), Options{})
	s := m.chanOf(t, info)
	f := newFakeChannel(t)
	f.park(1)
	page := m.attachOn(t, f, info.Cap, nil, 0)
	page.waitReady()
	hold.release(t)
	require.Eventually(t, func() bool { return s.channelStats().waits >= 1 }, settle, time.Millisecond, "the pump waited")
	waits, written := s.channelStats().waits, s.channelStats().end

	clock.Advance(m.channel.stall - time.Millisecond)
	s.channelNudge() // a wake that carries no news: the pump looks again, and the stall is not over
	guarded(t, "stall-not-early", func() {
		require.Eventually(t, func() bool { return s.channelStats().waits > waits }, settle, time.Millisecond, "the pump looked again and waited again")
		stats := s.channelStats()
		assert.Equal(t, written, stats.end, "the child wrote nothing while the page was within its stall")
		assert.Zero(t, stats.stallReleases)
	})

	clock.Advance(2 * time.Millisecond)
	guarded(t, "stall-release", func() {
		require.Eventually(t, func() bool { return s.channelStats().stallReleases >= 1 }, settle, time.Millisecond, "the stall let the pump go")
		require.Eventually(t, func() bool { return s.channelStats().end > written+uint64(m.channel.ring) }, settle, time.Millisecond, "and the child wrote on")
	})

	waits = s.channelStats().waits
	f.release() // the page takes a frame again: progress
	guarded(t, "wait-again-on-progress", func() {
		require.Eventually(t, func() bool { return s.channelStats().waits > waits }, settle, time.Millisecond, "when progress came back the pump waited again")
	})
}

// A stream that shows an offset older than the ring has says exactly how much was lost: ready.start is the first byte that
// follows and ready.lost is its distance from the offset, and the bytes that follow are the sequence from there. An offset the
// ring has, or the end of the output, loses nothing; no offset means all the page can have; an offset past the end is nothing of
// this terminal's, and the stream closes.
func TestAReattachOlderThanTheRingSaysExactlyHowMuchWasLost(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	const lines = 800000
	total := countingLen(lines)
	info := m.startChannel(t, countingScript(lines, gate{}), Options{})
	s := m.chanOf(t, info)
	require.Eventually(t, func() bool { return s.channelStats().end == total }, settle, time.Millisecond)
	start := s.channelStats().start
	require.Positive(t, start)
	at := func(n uint64) *uint64 { return &n }
	cases := []struct {
		name            string
		from            *uint64
		wantStart, lost uint64
	}{
		{"no offset: all the page can have", nil, start, 0},
		{"offset 0", at(0), start, start},
		{"half the way to the start of the ring", at(start / 2), start, start - start/2},
		{"one byte below the ring", at(start - 1), start, 1},
		{"exactly the start of the ring", at(start), start, 0},
		{"inside the ring", at(start + 5), start + 5, 0},
		{"the end of the output", at(total), total, 0},
	}
	for _, c := range cases {
		page := m.attach(t, info.Cap, c.from)
		ready := page.waitReady()
		want := total - c.wantStart
		st := page.waitBytes(int(want))
		guarded(t, "lost-exact", func() {
			assert.Equal(t, c.wantStart, ready.Start, c.name)
			assert.Equal(t, c.lost, ready.Lost, "%s: how much of what the page asked for is gone", c.name)
			assert.Equal(t, total, ready.End, c.name)
		})
		assert.True(t, bytes.Equal(countingBytes(c.wantStart, want), st.bytes()), "%s: the bytes that follow are the sequence from there", c.name)
		assert.Empty(t, st.faults, c.name)
		t.Logf("%s: start %d, lost %d, replay %d bytes", c.name, ready.Start, ready.Lost, want)
		page.close()
		page.waitServed()
	}

	past := m.attach(t, info.Cap, at(total+1))
	past.waitServed()
	st := past.waitClosed()
	assert.Nil(t, st.ready, "an offset past the end is refused")
	assert.Zero(t, st.frames, "with no answer: the page has nothing of this terminal's")
}

// A page that reloads under a flood and comes back by offset has every byte, once, in order: it dies at random places of a
// flood, comes back with the offset it had, and what it took, joined, is the sequence the child wrote. (A ring that holds it all, so
// that the shell running on while no page holds it loses nothing: what a smaller ring loses is counted by the tests above.)
func TestAStreamThatReloadsUnderAFloodResumesByteExactByOffset(t *testing.T) {
	m, _ := newChannelManager(t, func(l *channelLimits) { l.ring = 16 << 20 })
	const lines = 300000
	total := countingLen(lines)
	info := m.startChannel(t, countingScript(lines, gate{}), Options{})
	rng := rand.New(rand.NewPCG(5, 9))
	var have uint64
	var joined bytes.Buffer
	reloads := 0
	for have < total {
		from := have
		page := m.attachAcking(t, info.Cap, &from, 32<<10)
		ready := page.waitReady()
		require.Equal(t, have, ready.Start, "reload %d: the stream resumes at the offset the page has", reloads)
		require.Zero(t, ready.Lost)
		target := min(total, have+1+uint64(rng.IntN(400<<10)))
		page.waitFor("the place it dies at", func(s pageState) bool { return s.next >= target })
		st := page.die()
		page.waitServed()
		joined.Write(st.bytes())
		have = st.next
		reloads++
	}
	assert.Equal(t, countingBytes(0, total), joined.Bytes(), "what the pages took, joined, is what the child wrote")
	assert.Greater(t, reloads, 3, "the page reloaded %d times", reloads)
	t.Logf("%d reloads, %d bytes, byte for byte", reloads, total)
}

// Twenty reloads of a page under a flood leave one shell, the same process, alive, and the page's bytes are the child's
// sequence, byte for byte.
func TestTwentyReloadsUnderAFloodLeaveOneShellWithTheSamePid(t *testing.T) {
	m, _ := newChannelManager(t, nil)
	info := m.startChannel(t, countingScript(-1, gate{}), Options{})
	var have uint64
	var joined bytes.Buffer
	for reload := range 20 {
		from := have
		page := m.attachAcking(t, info.Cap, &from, 32<<10)
		ready := page.waitReady()
		require.Equal(t, have, ready.Start, "reload %d", reload)
		require.Zero(t, ready.Lost, "reload %d", reload)
		target := have + 100<<10
		page.waitFor("the place it dies at", func(s pageState) bool { return s.next >= target })
		st := page.die()
		page.waitServed()
		joined.Write(st.bytes())
		have = st.next
	}
	assert.Equal(t, countingBytes(0, have), joined.Bytes(), "what the pages took, joined, is what the child wrote")
	assert.Equal(t, []string{info.ID}, m.running(), "one shell")
	assert.False(t, gone(info.PID), "the same shell, alive")
}
