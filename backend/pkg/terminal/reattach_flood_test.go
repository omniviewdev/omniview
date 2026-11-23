//go:build !windows

package terminal

import (
	"bytes"
	"math"
	"math/rand/v2"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

func owner(i int) Owner { return "window-" + strconv.Itoa(i) }

// requireSame fails with the first place two streams differ, not with two megabytes of text.
func requireSame(t *testing.T, want, got []byte, what string) {
	t.Helper()
	if bytes.Equal(want, got) {
		return
	}
	i := 0
	for i < len(want) && i < len(got) && want[i] == got[i] {
		i++
	}
	around := func(b []byte) string { return strconv.Quote(string(b[max(0, i-20):min(len(b), i+20)])) }
	require.Failf(t, what, "the streams differ at byte %d (%d bytes wanted, %d got): wanted ...%s..., got ...%s...",
		i, len(want), len(got), around(want), around(got))
}

// childrenOfTest lists the processes that are children of this test binary, but for the one that asks.
func childrenOfTest(t *testing.T) []int {
	t.Helper()
	ps := exec.Command("ps", "-A", "-o", "pid=,ppid=")
	out, err := ps.Output()
	require.NoError(t, err)
	var children []int
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		pid, errPID := strconv.Atoi(fields[0])
		parent, errParent := strconv.Atoi(fields[1])
		if errPID == nil && errParent == nil && parent == os.Getpid() && pid != ps.Process.Pid {
			children = append(children, pid)
		}
	}
	return children
}

// quietAll waits until the output of none of the sessions has moved for a quarter of a second, and says where
// each of them stands.
func quietAll(t *testing.T, m *Manager, ids []string) []uint64 {
	t.Helper()
	sessions := make([]*session, len(ids))
	for i, id := range ids {
		sessions[i] = m.session(t, id)
	}
	last := make([]uint64, len(ids))
	stable := 0
	require.Eventually(t, func() bool {
		moved := false
		for i, s := range sessions {
			if now := s.next(); now != last[i] {
				last[i], moved = now, true
			}
		}
		if moved {
			stable = 0
		} else {
			stable++
		}
		return stable >= 10
	}, 60*time.Second, 25*time.Millisecond, "the output of the sessions never settled")
	return last
}

func (p *testPage) isAlive() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.alive
}

// killAt arranges for the page to die as soon as it has taken in the number of bytes the threshold holds, and
// to say so.
func killAt(page *testPage, threshold *atomic.Uint64) <-chan struct{} {
	died := make(chan struct{}, 1)
	page.onEvent = func(p *testPage) {
		if p.have() >= threshold.Load() {
			p.die()
			select {
			case died <- struct{}{}:
			default:
			}
		}
	}
	return died
}

// 1. THE HOLD OF THE FLOW.

// A held flow stays paused whatever credit comes and whatever the watchdog would give; a restart lets it go and
// forgets who gave credit and what was owed; a release, which is a close, lets it go whatever it holds.
func TestAHeldFlowStaysPausedWhateverCreditComesAndARestartOrAReleaseLetsItGo(t *testing.T) {
	paused := func(f *flowControl) bool {
		done := make(chan struct{})
		stop := make(chan struct{})
		go func() { f.wait(stop); close(done) }()
		defer close(stop)
		select {
		case <-done:
			return false
		case <-time.After(250 * time.Millisecond):
			return true
		}
	}
	// A watchdog that would step within a tenth of the time it is watched for.
	f := newFlowControl(40*time.Millisecond, nil)
	assert.False(t, paused(f), "nothing is held, nothing is owed")
	f.hold()
	assert.True(t, paused(f), "held: paused with nothing owed")
	f.sent(FlowHighBytes)
	assert.True(t, paused(f), "and the watchdog, which would have stepped by now, gives nothing to a held flow")
	f.delivered(FlowHighBytes)
	assert.True(t, paused(f), "the transport's credit does not let a held flow go")
	f.ack(FlowHighBytes)
	assert.True(t, paused(f), "nor does the client's")

	// No watchdog from here: what is owed stays owed until credit comes.
	g := newFlowControl(0, nil)
	g.ack(0)
	g.sent(FlowHighBytes)
	g.hold()
	g.restart()
	assert.False(t, paused(g), "a restart lets it go, and the debt that was owed is forgotten")
	g.sent(FlowHighBytes)
	require.True(t, paused(g), "a new debt pauses at the high mark")
	g.delivered(FlowHighBytes)
	assert.True(t, paused(g), "who gave credit before is remembered: the client acknowledged, so what the transport took credits nothing")
	g.ack(FlowHighBytes)
	assert.False(t, paused(g), "and its acknowledgements do")

	// A terminal whose client never acknowledged stays on the transport's credit.
	h := newFlowControl(0, nil)
	h.hold()
	h.restart()
	h.sent(FlowHighBytes)
	require.True(t, paused(h))
	h.delivered(FlowHighBytes)
	assert.False(t, paused(h), "what the transport took credits it, as before the attach")

	g.hold()
	require.True(t, paused(g))
	g.release()
	assert.False(t, paused(g), "a closing session is read whatever holds it")
}

// 2. RELOADS.

// The page dies at chosen offsets of a flood that is acknowledged to the byte, and comes back as a reloaded page
// does, in an order that varies: the host must have paused the shell with the credit window full, and the ring
// must still hold everything the page lacks. At the end the page has every byte, once, in order.
func TestAReloadUnderAFloodReattachesByteExactByOffset(t *testing.T) {
	const lines = 2_000_000
	m, sink := newPageManager(t)
	page := newTestPage(m, "flood-1")
	var threshold atomic.Uint64
	threshold.Store(1 << 20)
	died := killAt(page, &threshold)
	sink.setHook(func(_ string, offset uint64, data []byte) { page.take(offset, data) })
	// awk, not seq: the seq of macOS writes a million as 1e+06.
	info := m.startKeyed(t, "awk 'BEGIN { for (i = 1; i <= "+strconv.Itoa(lines)+"; i++) print i }'", owner(0), Options{ID: "flood-1"})
	rng := rand.New(rand.NewPCG(17, 3))

	reloads := 0
	deadline := time.Now().Add(180 * time.Second)
	for len(sink.closes(info.ID)) == 0 {
		select {
		case <-died:
		case <-time.After(20 * time.Millisecond):
			if time.Now().After(deadline) {
				require.Failf(t, "the flood did not end", "after %d reloads the page had %d bytes and the host had written %d",
					reloads, page.have(), m.session(t, info.ID).next())
			}
			continue
		}
		have := page.have()
		threshold.Store(math.MaxUint64) // the page does not die again before it has come back
		reloads++
		kind := reloads % 3
		switch kind {
		case 0:
			// The new page is quicker than the sweep that retires the old one: it attaches first.
			time.Sleep(time.Duration(rng.IntN(5)) * time.Millisecond)
			att := page.comeBack(t, owner(reloads), testKey)
			require.Equal(t, have, att.Replay.Start, "reload %d: nothing the page lacked was dropped", reloads)
			assert.Equal(t, Released{Detached: 0, Ended: 0}, m.ReleaseOwned(owner(reloads-1), ClosedByWindow), "the late retirement finds nothing of its own")
		default:
			if kind == 2 {
				// The sweep is slow (server mode: seconds after the socket goes): the host has run on, with nobody
				// acknowledging, to the high mark of the credit, and the replay ring must hold all of that.
				quiet(t, m, info.ID)
			}
			released := m.ReleaseOwned(owner(reloads-1), ClosedByWindow)
			if released.Detached == 1 {
				quiet(t, m, info.ID)
				assert.True(t, m.session(t, info.ID).flow.isHeld(), "detached: the flow is held")
			}
			time.Sleep(time.Duration(rng.IntN(5)) * time.Millisecond)
			att := page.comeBack(t, owner(reloads), testKey)
			require.Equal(t, have, att.Replay.Start, "reload %d: nothing the page lacked was dropped", reloads)
			if kind == 2 && have < 12<<20 {
				assert.Greater(t, att.Replay.End-att.Replay.Start, uint64(FlowHighBytes)/2, "reload %d: the credit window was in the replay", reloads)
			}
		}
		threshold.Store(page.have() + 1<<20)
	}
	end := sink.waitEnd(t, info.ID)
	if !page.isAlive() {
		// The shell ended while the page was away: its end and its output were kept.
		att := page.comeBack(t, owner(reloads+1), testKey)
		require.NotNil(t, att.Ended, "a terminal that ended while no page was attached leaves its end")
	}
	require.Eventually(t, func() bool { return uint64(len(page.bytes())) == end.LastOffset }, 30*time.Second, 10*time.Millisecond,
		"the page has taken in as many bytes as the shell wrote")

	want := numbered(lines)
	assert.GreaterOrEqual(t, reloads, 5, "the flood was long enough to be reloaded under")
	assert.Equal(t, uint64(len(want)), end.LastOffset, "the end says how long the output was")
	requireSame(t, want, page.bytes(), "what the page rendered across its reloads")
	requireSame(t, want, sink.stream(t, info.ID), "what the host emitted")
	gaps, _, partial := page.faults()
	assert.Zero(t, gaps, "no gap")
	assert.Zero(t, partial, "no event that straddles what the page had")
}

// Twenty reloads under `yes`, which writes as fast as the host reads: one shell, the same process, every byte
// at its offset, and no other process was started for any of them. What the page has, with the replays and the
// events it took in across its reloads, is what the host emitted, byte for byte. (The bytes of `yes` are not a
// pattern a check can rely on: the terminal of macOS puts an extra CR in at some block boundaries.)
func TestTwentyReloadsUnderYesLeaveOneShellWithTheSamePIDAndEveryByteAtItsOffset(t *testing.T) {
	const step = 3 << 19
	m, sink := newPageManager(t)
	page := newTestPage(m, "yes-1")
	var threshold atomic.Uint64
	threshold.Store(step)
	died := killAt(page, &threshold)
	sink.setHook(func(_ string, offset uint64, data []byte) { page.take(offset, data) })
	info := m.startKeyed(t, "exec yes", owner(0), Options{ID: "yes-1"})

	for reload := 1; reload <= 20; reload++ {
		select {
		case <-died:
		case <-time.After(60 * time.Second):
			require.Failf(t, "the page never reached its offset", "reload %d, at %d bytes", reload, page.have())
		}
		have := page.have()
		threshold.Store(math.MaxUint64) // the page does not die again before it has come back
		released := m.ReleaseOwned(owner(reload-1), ClosedByWindow)
		require.Equal(t, Released{Detached: 1, Ended: 0}, released, "reload %d", reload)
		quiet(t, m, info.ID)
		att := page.comeBack(t, owner(reload), testKey)
		require.Equal(t, info.PID, att.Session.PID, "reload %d: the same shell", reload)
		require.Equal(t, have, att.Replay.Start, "reload %d: no gap", reload)
		threshold.Store(page.have() + step)
	}
	assert.False(t, gone(info.PID), "the shell runs")
	assert.Equal(t, []int{info.PID}, childrenOfTest(t), "one process, the same one, after twenty reloads")
	assert.Equal(t, []string{info.ID}, m.running())

	page.die()
	got := page.bytes()
	require.Greater(t, len(got), 20*step)
	gaps, _, partial := page.faults()
	assert.Zero(t, gaps)
	assert.Zero(t, partial)
	assert.Equal(t, uint64(len(got)), page.have())
	require.NoError(t, m.CloseSession(info.ID))
	truth := sink.stream(t, info.ID)
	require.GreaterOrEqual(t, len(truth), len(got))
	requireSame(t, truth[:len(got)], got, "what the page rendered across twenty reloads against what the host emitted")
}

// 3. WHILE DETACHED.

// A terminal nobody is attached to is not read: the shell blocks in its own write (it uses no CPU), the host
// buffers nothing (the ring does not move, the heap does not grow), and when a page attaches it goes on.
func TestADetachedTerminalHoldsItsFloodTheChildBlocksAndTheHostBuffersNothing(t *testing.T) {
	m, sink := newPageManager(t)
	sink.discard = true
	page := newTestPage(m, "held-1")
	sink.setHook(func(_ string, offset uint64, data []byte) { page.take(offset, data) })
	info := m.startKeyed(t, "exec yes", owner(0), Options{ID: "held-1"})
	s := m.session(t, info.ID)
	require.Eventually(t, func() bool { return s.next() > 32<<20 }, 60*time.Second, 5*time.Millisecond, "the flood is running")
	assert.Positive(t, cpuTime(t, info.PID), "and it uses CPU while it runs")

	page.die()
	require.Equal(t, Released{Detached: 1, Ended: 0}, m.ReleaseOwned(owner(0), ClosedByWindow))
	stopped := quiet(t, m, info.ID)
	cpuBefore := cpuTime(t, info.PID)
	heapBefore := heapInUse()

	time.Sleep(2 * time.Second)
	cpuHeld := cpuTime(t, info.PID) - cpuBefore
	heapGrowth := int64(heapInUse()) - int64(heapBefore)
	t.Logf("detached for 2 s under yes: %d more bytes read, %v of CPU, heap %+d bytes, ring %d bytes (cap %d)",
		s.next()-stopped, cpuHeld, heapGrowth, len(s.readRing()), ReplayBytes)
	assert.Equal(t, stopped, s.next(), "two seconds on, not one more byte was read")
	assert.LessOrEqual(t, cpuHeld, 150*time.Millisecond, "the shell is blocked in its write: it used no CPU")
	assert.Less(t, heapGrowth, int64(4<<20), "the host buffered nothing: the heap did not grow")
	assert.LessOrEqual(t, len(s.readRing()), ReplayBytes, "and the ring is bounded")
	assert.True(t, s.flow.isHeld())

	cpuBefore = cpuTime(t, info.PID)
	page.comeBack(t, owner(1), testKey)
	require.Eventually(t, func() bool { return s.next() > stopped+2<<20 }, 30*time.Second, 5*time.Millisecond, "an attach lets the shell go on")
	assert.Greater(t, cpuTime(t, info.PID), cpuBefore, "and it uses CPU again")
}

// 4. MANY.

// Two hundred terminals nobody is attached to, a tenth of them floods that are still running and the rest idle
// after a burst, hold a bounded state: every ring is at its bound and no more, the heap is the rings and a
// little else, nothing grows while they wait, and when their lease runs out no process and no memory is left.
// (The single flood that is held is the test before this one; a flood in every one of two hundred shells would
// time the machine, not the host. Under the race detector a pump is too slow for two hundred shells to fill their
// rings in a useful time, and the test runs forty.)
func TestTwoHundredDetachedTerminalsHoldABoundedStateAndTheirLeasesLeaveNothing(t *testing.T) {
	if testing.Short() {
		t.Skip("two hundred shells")
	}
	count := 200
	if underRace {
		count = 40
	}
	m, sink := newPageManager(t)
	sink.discard = true
	goroutinesBefore := runtime.NumGoroutine()
	heapBefore := heapInUse()

	infos := make([]Session, 0, count)
	names := make([]string, 0, count)
	for i := range count {
		script := "head -c 3000000 /dev/zero | tr '\\0' 'x'; exec sleep 600"
		if i%10 == 0 {
			script = "exec yes"
		}
		info := m.startKeyed(t, script, owner(i), Options{LeaseMs: 20000})
		infos = append(infos, info)
		names = append(names, info.ID)
	}
	for _, info := range infos {
		s := m.session(t, info.ID)
		require.Eventually(t, func() bool { return s.next() > 2<<20 }, 120*time.Second, 5*time.Millisecond, "terminal %s never wrote enough to fill its ring", info.ID)
	}
	for i := range count {
		require.Equal(t, Released{Detached: 1, Ended: 0}, m.ReleaseOwned(owner(i), ClosedByWindow))
	}
	positions := quietAll(t, m, names)

	heapDetached := heapInUse()
	rings := heapDetached - heapBefore
	bound := uint64(count) * uint64(ReplayBytes+2*chunkBytes)
	assert.LessOrEqual(t, rings, bound+32<<20, "the state of 200 detached terminals is their 200 rings and a little else")
	assert.Greater(t, rings, uint64(count)*uint64(ReplayBytes-4*chunkBytes), "every ring is full: the bound was reached, not just stayed under")
	t.Logf("%d detached terminals: heap %d MiB over the baseline (rings bound %d MiB), %d goroutines more than before, %d ring bytes each at most",
		count, rings>>20, bound>>20, runtime.NumGoroutine()-goroutinesBefore, ReplayBytes)
	assert.LessOrEqual(t, runtime.NumGoroutine()-goroutinesBefore, count*8, "a bounded number of goroutines each")
	for _, info := range infos {
		s := m.session(t, info.ID)
		kept := len(s.readRing())
		assert.LessOrEqual(t, kept, ReplayBytes, info.ID)
		assert.Greater(t, kept, ReplayBytes-2*chunkBytes, info.ID)
		assert.True(t, s.flow.isHeld(), info.ID)
	}

	time.Sleep(2 * time.Second)
	assert.LessOrEqual(t, int64(heapInUse())-int64(heapDetached), int64(8<<20), "nothing grows while they wait")
	for i, info := range infos {
		assert.Equal(t, positions[i], m.session(t, info.ID).next(), "terminal %d read nothing while detached", i)
	}

	// The leases run out: every one ends, no process is left, and the memory is given back.
	for _, info := range infos {
		end := sink.waitEnd(t, info.ID)
		assert.Equal(t, ClosedByDetachTimeout, end.ClosedBy, info.ID)
	}
	for _, info := range infos {
		requireGone(t, info.PID, "a terminal whose lease ran out")
	}
	require.Eventually(t, func() bool { return len(m.running()) == 0 }, 30*time.Second, 10*time.Millisecond)
	assert.Zero(t, m.tombstoneCount())
	assert.Empty(t, childrenOfTest(t), "no process of this test is left")
	assert.LessOrEqual(t, int64(heapInUse())-int64(heapBefore), int64(32<<20), "and the memory of the rings is given back")
}

// 5. THE SAME OPERATION AGAINST ITSELF AND AGAINST ITS NEIGHBOURS.

// jitter waits a number of scheduler turns, so that two goroutines that start together meet in different places.
func jitter(rng *rand.Rand) {
	for range rng.IntN(60) {
		runtime.Gosched()
	}
}

// Two attaches at the same moment, against a terminal that is writing: both succeed, each reply is exactly the
// bytes of the stream between its offsets, and the terminal belongs to one of them, attached, not held.
func TestAttachAgainstAttachNeverLosesOrRepeatsAByte(t *testing.T) {
	m, sink := newPageManager(t)
	rng := rand.New(rand.NewPCG(5, 8))
	for i := range 40 {
		id := "aa-" + strconv.Itoa(i)
		info := m.startKeyed(t, "seq 1 100000; read x", owner(0), Options{ID: id})
		m.ReleaseOwned(owner(0), ClosedByWindow)
		if i%2 == 0 {
			time.Sleep(time.Duration(rng.IntN(4)) * time.Millisecond)
		}
		var wg sync.WaitGroup
		replies := make([]*Attached, 2)
		errs := make([]error, 2)
		start := make(chan struct{})
		for k := range 2 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				local := rand.New(rand.NewPCG(uint64(i*2+k), 1))
				<-start
				jitter(local)
				replies[k], errs[k] = m.Attach(id, owner(10+k), AttachRequest{PageKey: testKey})
			}()
		}
		close(start)
		wg.Wait()
		for k := range 2 {
			require.NoError(t, errs[k], "iteration %d attach %d", i, k)
		}
		// The shell waits for a line after its burst, so it is alive here: the terminal belongs to one of the two
		// callers, attached, and its flow is not held. Then the shell is let go.
		s := m.session(t, id)
		stillDetached, who, _, _ := s.state()
		assert.False(t, stillDetached, "iteration %d", i)
		assert.Contains(t, []Owner{owner(10), owner(11)}, who, "iteration %d: the terminal belongs to one of the two", i)
		assert.False(t, s.flow.isHeld(), "iteration %d", i)
		require.NoError(t, m.Write(id, 0, []byte("go\n")))
		end := sink.waitEnd(t, info.ID)
		truth := sink.stream(t, id)
		assert.Equal(t, uint64(len(truth)), end.LastOffset)
		for k, rep := range replies {
			assert.Zero(t, rep.Replay.Start, "the whole output is in the ring")
			assert.LessOrEqual(t, rep.Replay.End, uint64(len(truth)))
			requireSame(t, truth[:rep.Replay.End], rep.Replay.Data, "iteration "+strconv.Itoa(i)+" attach "+strconv.Itoa(k))
		}
	}
}

// An attach and the lease running out at the same moment: either the attach wins, and the terminal keeps
// running (the old lease does nothing), or the lease wins, and the attach is told there is no such terminal and
// the terminal ends as a lease ends it. Never an attach that succeeds on a terminal that ends from the old lease.
func TestAttachAgainstLeaseExpiryHasExactlyOneWinner(t *testing.T) {
	m, sink := newPageManager(t)
	rng := rand.New(rand.NewPCG(9, 9))
	attached, expired := 0, 0
	for i := range 150 {
		id := "le-" + strconv.Itoa(i)
		lease := 1 + rng.IntN(3)
		wait := time.Duration(lease)*time.Millisecond + time.Duration(rng.IntN(2000)-1000)*time.Microsecond
		if i%3 == 0 {
			lease = 60
			wait = time.Duration(40+rng.IntN(40)) * time.Millisecond
		}
		info := m.startKeyed(t, "exec sleep 600", owner(0), Options{ID: id, LeaseMs: lease})
		began := time.Now()
		m.ReleaseOwned(owner(0), ClosedByWindow)
		for time.Since(began) < wait {
			runtime.Gosched()
		}
		_, err := m.Attach(id, owner(1), AttachRequest{PageKey: testKey})
		if err == nil {
			attached++
			time.Sleep(time.Duration(2*lease+30) * time.Millisecond)
			assert.False(t, gone(info.PID), "iteration %d: the attach won, and the terminal was ended by the lease it replaced", i)
			assert.Empty(t, sink.closes(id), "iteration %d", i)
			detached, _, _, _ := m.session(t, id).state()
			assert.False(t, detached)
			require.NoError(t, m.CloseSession(id))
			continue
		}
		expired++
		assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, err).Type, "iteration %d", i)
		end := sink.waitEnd(t, id)
		assert.Equal(t, ClosedByDetachTimeout, end.ClosedBy, "iteration %d: the lease won", i)
		requireGone(t, info.PID, "the terminal whose lease won")
	}
	t.Logf("attach won %d times, the lease won %d times", attached, expired)
	assert.Positive(t, attached, "the attach won at least once")
	assert.Positive(t, expired, "the lease won at least once")
}

// An attach and a close at the same moment: the attach succeeds and the close ends the terminal, or the close
// comes first and the attach is told there is no such terminal. Nothing hangs and nothing is left.
func TestAttachAgainstCloseEndsInOneOfTwoWaysAndLeavesNothing(t *testing.T) {
	m, sink := newPageManager(t)
	outcomes := map[string]int{}
	for i := range 80 {
		id := "ac-" + strconv.Itoa(i)
		info := m.startKeyed(t, "seq 1 200000; exec sleep 600", owner(0), Options{ID: id})
		if i%2 == 0 {
			m.ReleaseOwned(owner(0), ClosedByWindow)
		}
		var wg sync.WaitGroup
		var attachErr, closeErr error
		start := make(chan struct{})
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(i), 1)))
			_, attachErr = m.Attach(id, owner(1), AttachRequest{PageKey: testKey})
		}()
		go func() {
			defer wg.Done()
			<-start
			jitter(rand.New(rand.NewPCG(uint64(i), 2)))
			closeErr = m.CloseSession(id)
		}()
		close(start)
		wg.Wait()
		require.NoError(t, closeErr, "iteration %d: the close was answered", i)
		if attachErr == nil {
			outcomes["attach first"]++
		} else {
			assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, attachErr).Type, "iteration %d", i)
			outcomes["close first"]++
		}
		end := sink.waitEnd(t, id)
		assert.Equal(t, ClosedByRequest, end.ClosedBy, "iteration %d", i)
		requireGone(t, info.PID, "the closed terminal")
	}
	t.Logf("%v", outcomes)
	require.Eventually(t, func() bool { return len(m.running()) == 0 }, 30*time.Second, 10*time.Millisecond)
}

// Eight goroutines attach, detach, release, list, acknowledge, resize and write against one flooding terminal at
// random for a while. When they stop the terminal is in one of its two states and in no other: attached to a
// window, not held and with no lease running, or detached, held, with its lease running and no owner.
func TestAStormOfAttachesAndDetachesLeavesTheTerminalInOneOfItsTwoStates(t *testing.T) {
	m, sink := newPageManager(t)
	sink.discard = true
	info := m.startKeyed(t, "exec yes", owner(0), Options{ID: "storm-1", LeaseMs: 600000})
	s := m.session(t, info.ID)

	var calls atomic.Int64
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for g := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rng := rand.New(rand.NewPCG(uint64(g), 77))
			me := owner(g)
			for {
				select {
				case <-stop:
					return
				default:
				}
				calls.Add(1)
				switch rng.IntN(8) {
				case 0, 1:
					_, _ = m.Attach(info.ID, me, AttachRequest{PageKey: testKey})
				case 2:
					_, _ = m.Attach(info.ID, me, AttachRequest{})
				case 3:
					_, _ = m.Detach(info.ID, me, DetachRequest{PageKey: testKey, LeaseMs: 600000})
				case 4:
					m.ReleaseOwned(me, ClosedByWindow)
				case 5:
					_ = m.List(me, testKey)
				case 6:
					_ = m.Ack(info.ID, rng.IntN(1<<20))
				case 7:
					_ = m.Resize(info.ID, 0, 10+rng.IntN(50), 10+rng.IntN(100))
				}
			}
		}()
	}
	time.Sleep(2 * time.Second)
	close(stop)
	wg.Wait()
	t.Logf("%d calls", calls.Load())

	detached, who, timer, _ := s.state()
	if detached {
		assert.Nil(t, who, "detached: no owner")
		assert.True(t, timer, "detached: the lease is running")
		assert.True(t, s.flow.isHeld(), "detached: the flow is held")
	} else {
		assert.NotNil(t, who, "attached: an owner")
		assert.False(t, timer, "attached: no lease is running")
		assert.False(t, s.flow.isHeld(), "attached: the flow is not held")
	}
	assert.False(t, gone(info.PID), "the terminal survived it all")
	require.NoError(t, m.CloseSession(info.ID))
	requireGone(t, info.PID, "the terminal")
}

// 6. THE END STATE.

// After a storm over many terminals, with leases that run out in the middle of it, closes, and the host
// quitting at the end, nothing is left: no process, no session, no timer, no goroutine, no descriptor.
func TestAfterEverythingSettlesNoProcessNoSessionNoTimerNoGoroutineAndNoDescriptorIsLeft(t *testing.T) {
	m, sink := newPageManager(t)
	sink.discard = true
	goroutines := runtime.NumGoroutine()
	descriptors := openDescriptors(t)

	infos := startStormTerminals(t, m, 24)
	held := make([]*session, 0, len(infos))
	for _, info := range infos {
		held = append(held, m.session(t, info.ID))
	}
	runStorm(m, infos, 6, 2500*time.Millisecond)
	m.Shutdown()

	for _, info := range infos {
		requireGone(t, info.PID, "a terminal of the storm")
	}
	assert.Empty(t, m.running(), "no session")
	m.mu.RLock()
	assert.Empty(t, m.starting, "no start in progress")
	m.mu.RUnlock()
	for i, s := range held {
		_, _, timer, _ := s.state()
		assert.False(t, timer, "terminal %d: no lease timer", i)
		assert.True(t, s.hasExited(), "terminal %d: its shell was reaped", i)
	}
	assert.LessOrEqual(t, m.tombstoneCount(), TombstoneLimit)
	assert.Empty(t, childrenOfTest(t), "no process of this test is left")
	require.Eventually(t, func() bool { return runtime.NumGoroutine() <= goroutines+4 }, 20*time.Second, 50*time.Millisecond,
		"goroutines: %d before, %d now\n%s", goroutines, runtime.NumGoroutine(), allStacks())
	require.Eventually(t, func() bool { return openDescriptors(t) <= descriptors+2 }, 20*time.Second, 50*time.Millisecond,
		"descriptors: %d before, %d now", descriptors, openDescriptors(t))
	assert.Empty(t, m.List(nil, testKey), "no terminal is listed")
}

// startStormTerminals starts count terminals with short leases: floods and bursts, one in four without a key.
func startStormTerminals(t *testing.T, m *Manager, count int) []Session {
	t.Helper()
	infos := make([]Session, 0, count)
	for i := range count {
		id := "end-" + strconv.Itoa(i)
		script := "exec yes"
		if i%3 == 0 {
			script = "seq 1 50000; exec sleep 600"
		}
		if i%4 == 3 {
			info, err := m.Start(Options{ID: id, Command: []string{sh(t), "-c", script}}, owner(0))
			require.NoError(t, err)
			infos = append(infos, info)
			continue
		}
		infos = append(infos, m.startKeyed(t, script, owner(0), Options{ID: id, LeaseMs: 50 + 40*(i%5)}))
	}
	return infos
}

// runStorm has goroutines attach, detach, release, list, acknowledge and close the terminals at random for a while.
func runStorm(m *Manager, infos []Session, goroutines int, duration time.Duration) {
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for g := range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rng := rand.New(rand.NewPCG(uint64(g), 5))
			for {
				select {
				case <-stop:
					return
				default:
				}
				stormOp(m, rng, infos[rng.IntN(len(infos))].ID)
			}
		}()
	}
	time.Sleep(duration)
	close(stop)
	wg.Wait()
}

func stormOp(m *Manager, rng *rand.Rand, id string) {
	me := owner(rng.IntN(4))
	switch rng.IntN(7) {
	case 0, 1:
		_, _ = m.Attach(id, me, AttachRequest{PageKey: testKey})
	case 2:
		_, _ = m.Detach(id, me, DetachRequest{PageKey: testKey, LeaseMs: 30 + rng.IntN(100)})
	case 3:
		m.ReleaseOwned(me, ClosedByWindow)
	case 4:
		_ = m.List(me, testKey)
	case 5:
		_ = m.Ack(id, rng.IntN(1<<18))
	case 6:
		if rng.IntN(25) == 0 {
			_ = m.CloseSession(id)
		}
	}
}

func allStacks() string {
	buf := make([]byte, 1<<20)
	return string(buf[:runtime.Stack(buf, true)])
}
