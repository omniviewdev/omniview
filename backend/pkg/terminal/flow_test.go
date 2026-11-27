//go:build !windows

package terminal

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

// transportSink is the sink of a transport that never makes a sender wait and reports when it took the
// output (DeliveryReporter), as the exec lane's sink does over Wails' server mode: the test says what the
// transport took, through deliver, and a client whose socket stalls is a test that does not.
type transportSink struct {
	m     *Manager
	mu    sync.Mutex
	bytes int
	ends  []End
}

func (s *transportSink) ReportsDelivery() {}

func (s *transportSink) Output(_ string, data []byte) {
	s.mu.Lock()
	s.bytes += len(data)
	s.mu.Unlock()
}

func (s *transportSink) Closed(_ string, end End) {
	s.mu.Lock()
	s.ends = append(s.ends, end)
	s.mu.Unlock()
}

func (s *transportSink) size() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.bytes
}

func (s *transportSink) waitEnd(t *testing.T, within time.Duration) End {
	t.Helper()
	require.Eventually(t, func() bool { s.mu.Lock(); defer s.mu.Unlock(); return len(s.ends) > 0 }, within, 10*time.Millisecond, "the session never closed")
	s.mu.Lock()
	defer s.mu.Unlock()
	require.Len(t, s.ends, 1, "exactly one CLOSE")
	return s.ends[0]
}

func newTransportManager(t *testing.T) (*Manager, *transportSink) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	sink := &transportSink{}
	ctx, cancel := context.WithCancel(context.Background())
	m := NewManager(ctx, logging.NewNop(), sink)
	sink.m = m
	t.Cleanup(func() {
		for _, id := range m.running() {
			_ = m.CloseSession(id)
		}
		cancel()
	})
	return m, sink
}

// deliveringSink keeps what a session said, like chunkSink, and tells the manager the transport took each
// event a moment after Output returned, from another goroutine, as a transport that serializes events in a
// worker does.
type deliveringSink struct {
	*chunkSink
	m *Manager
}

func (d *deliveringSink) ReportsDelivery() {}

func (d *deliveringSink) Output(id string, data []byte) {
	d.chunkSink.Output(id, data)
	credit := d.m.DeliveryCredit(id)
	go credit.Delivered(len(data))
}

// The credit has two sources, one at a time: what the transport took, until the client acknowledges for the
// first time, and what the client acknowledges from then on.
func TestCreditComesFromTheTransportUntilTheClientAcknowledgesOnceAndFromTheClientAfterThat(t *testing.T) {
	paused := func(f *flowControl) bool {
		done := make(chan struct{})
		stop := make(chan struct{})
		go func() { f.wait(stop); close(done) }()
		defer close(stop)
		select {
		case <-done:
			return false
		case <-time.After(150 * time.Millisecond):
			return true
		}
	}
	f := newFlowControl(0, nil)
	f.sent(FlowHighBytes + 10)
	assert.True(t, paused(f), "the output delivered and not credited is past the high mark: the reader waits")
	f.delivered(10)
	assert.True(t, paused(f), "credit that leaves the debt above the low mark does not resume it")
	f.delivered(FlowHighBytes - FlowLowBytes)
	assert.False(t, paused(f), "the debt is down to the low mark")

	f.ack(0)
	f.sent(FlowHighBytes)
	assert.True(t, paused(f))
	f.delivered(FlowHighBytes)
	assert.True(t, paused(f), "from the first acknowledgement on, what the transport took credits nothing")
	f.ack(FlowHighBytes)
	assert.False(t, paused(f), "the client's acknowledgement credits")

	f.sent(FlowHighBytes)
	require.True(t, paused(f))
	f.reset()
	assert.False(t, paused(f), "an attach forgets the debt")

	f.sent(FlowHighBytes)
	require.True(t, paused(f))
	f.release()
	assert.False(t, paused(f), "a closing session is read whatever it owes")
}

// Ten mebibytes arrive complete and in order whatever the sink does about credit: a sink that returns when
// the transport took the output, a transport that reports it, a client that acknowledges.
func TestTenMebibytesOfOutputArriveCompleteAndInOrderWhoeverGivesTheCredit(t *testing.T) {
	if testing.Short() {
		t.Skip("slow: 3 x 10 MiB through a real pty")
	}
	const lines = 1 << 20 // each is eight digits, a carriage return and a line feed: ten bytes, 10 MiB in all
	expected := sha256.New()
	for i := range lines {
		fmt.Fprintf(expected, "%08d\r\n", i)
	}
	script := `awk 'BEGIN { for (i = 0; i < 1048576; i++) printf "%08d\n", i }'`
	for _, mode := range []string{"a sink that returns when the transport took it", "a transport that reports its deliveries", "a client that acknowledges"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("HOME", t.TempDir())
			chunks := newChunkSink()
			var sink Sink = chunks
			ctx, cancel := context.WithCancel(context.Background())
			t.Cleanup(cancel)
			var m *Manager
			switch mode {
			case "a transport that reports its deliveries":
				reporting := &deliveringSink{chunkSink: chunks}
				sink = reporting
				m = NewManager(ctx, logging.NewNop(), sink)
				reporting.m = m
			case "a client that acknowledges":
				m = NewManager(ctx, logging.NewNop(), sink)
				chunks.onOutput = func(id string, n int) { _ = m.Ack(id, n) }
			default:
				m = NewManager(ctx, logging.NewNop(), sink)
			}
			tee := teePty(m) // what the kernel gives the host: the oracle (pty_cr_test.go)
			info, err := m.Start(Options{Command: []string{sh(t), "-c", script}}, nil)
			require.NoError(t, err)
			end := chunks.waitEnd(t, info.ID, 120*time.Second)
			require.Equal(t, EndExited, end.Reason)
			require.NotNil(t, end.ExitCode)
			require.Equal(t, 0, *end.ExitCode)
			got := chunks.output(info.ID)
			raw := tee.stream(info.ID)
			requireSame(t, raw, got, "what the sink was given, against the bytes the pty gave the host")
			printed, _ := withoutTheCRsOfMacOS(raw, tee.readEnds(info.ID))
			require.Len(t, printed, lines*10, "what the program printed, from the bytes the pty gave the host")
			sum := sha256.Sum256(printed)
			assert.Equal(t, expected.Sum(nil), sum[:], "every byte arrived, in order")
		})
	}
}

// Backpressure instead of an unbounded buffer: a client whose transport takes nothing holds the host to the
// credit, and the shell goes on when the transport takes the output again.
func TestTheHostStopsReadingAtTheHighMarkWhenTheTransportTakesNothingAndGoesOnWhenItDoes(t *testing.T) {
	m, sink := newTransportManager(t)
	info, err := m.Start(Options{Command: []string{sh(t), "-c", "yes flow-control-flood"}}, nil)
	require.NoError(t, err)
	assert.Equal(t, FlowHighBytes, info.Limits.FlowHighBytes)
	assert.Equal(t, FlowLowBytes, info.Limits.FlowLowBytes)

	require.Eventually(t, func() bool { return sink.size() >= FlowHighBytes }, 30*time.Second, 5*time.Millisecond)
	stalled := sink.size()
	assert.LessOrEqual(t, stalled, FlowHighBytes+DefaultReadBufferSize, "the host delivers the high mark and the read that crossed it, no more")
	time.Sleep(500 * time.Millisecond)
	assert.Equal(t, stalled, sink.size(), "nothing is read while the transport takes nothing")

	m.DeliveryCredit(info.ID).Delivered(stalled)
	require.Eventually(t, func() bool { return sink.size() > stalled }, 20*time.Second, 5*time.Millisecond, "reading resumed")

	// A client that stopped taking its output still can close the session, and gets its CLOSE.
	require.NoError(t, m.CloseSession(info.ID))
	assert.Equal(t, EndClosed, sink.waitEnd(t, 20*time.Second).Reason)
}

// B1. Closing a session that is paused for credit used to hang on macOS: the dying shell cannot finish
// exiting while the pty holds output that nobody reads, the host read nothing because it was paused, and it
// closed the master only after the shell had exited. CloseSession gave up after five seconds with the shell
// alive and no CLOSE (14 of 40 closes in the review). Closing releases the pacing.
func TestClosingASessionThatIsPausedForCreditEndsItAndDeliversItsClose(t *testing.T) {
	for i := range 15 {
		t.Run(fmt.Sprintf("run %d", i), func(t *testing.T) {
			m, sink := newTransportManager(t)
			info, err := m.Start(Options{Command: []string{sh(t), "-c", "yes flood-and-close"}}, nil)
			require.NoError(t, err)
			require.Eventually(t, func() bool { return sink.size() >= FlowHighBytes }, 30*time.Second, 2*time.Millisecond, "the session never paused")
			time.Sleep(20 * time.Millisecond)

			flow := m.session(t, info.ID).flow
			require.NoError(t, m.CloseSession(info.ID))
			assert.Empty(t, m.running(), "CloseSession returned with the session gone, not because closeWait passed")
			released, _, _ := flow.check()
			assert.True(t, released, "closing releases the pacing: a shell that is dying has to be read to finish exiting")
			end := sink.waitEnd(t, 5*time.Second)
			assert.Equal(t, EndClosed, end.Reason)
			assert.Equal(t, ClosedByRequest, end.ClosedBy)
			assert.True(t, ended(info.PID), "the shell is gone")
		})
	}
}

// From the client's first acknowledgement on, its acknowledgements are the only credit: what the transport
// takes after that credits nothing, so a client that stops acknowledging (a hidden tab) pauses the shell
// although its socket drains.
func TestTheFirstAcknowledgementMakesTheClientsAcknowledgementsTheOnlyCredit(t *testing.T) {
	m, rec := newTestManager(t)
	info, err := m.Start(Options{Command: []string{sh(t), "-c", "yes flow-control-flood"}}, nil)
	require.NoError(t, err)
	require.NoError(t, m.Ack(info.ID, 0))
	before := len(rec.text(info.ID))

	require.Eventually(t, func() bool { return len(rec.text(info.ID)) >= before+FlowHighBytes }, 30*time.Second, 5*time.Millisecond)
	time.Sleep(300 * time.Millisecond)
	stalled := len(rec.text(info.ID))
	assert.LessOrEqual(t, stalled-before, FlowHighBytes+16*DefaultReadBufferSize, "the sink returned every time, and the host still stopped at the credit")
	time.Sleep(500 * time.Millisecond)
	assert.Len(t, rec.text(info.ID), stalled, "nothing is read while the client acknowledges nothing")

	require.NoError(t, m.Ack(info.ID, stalled))
	require.Eventually(t, func() bool { return len(rec.text(info.ID)) > stalled }, 20*time.Second, 5*time.Millisecond, "the acknowledgement resumed it")
	require.NoError(t, m.CloseSession(info.ID))
	assert.Equal(t, EndClosed, rec.waitEnd(t, info.ID).Reason)
}

// An attach hands the client the ring, so what was in flight before it, and what was emitted while nobody
// listened and never credited, no longer holds the shell.
func TestAnAttachForgetsTheDebtOfOutputNobodyTook(t *testing.T) {
	m, sink := newTransportManager(t)
	info, err := m.Start(Options{Command: []string{sh(t), "-c", "yes flow-control-flood"}}, nil)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return sink.size() >= FlowHighBytes }, 30*time.Second, 5*time.Millisecond)
	time.Sleep(300 * time.Millisecond)
	stalled := sink.size()

	_, _, err = m.AttachSession(info.ID)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return sink.size() >= stalled+FlowHighBytes/2 }, 20*time.Second, 5*time.Millisecond, "the attach did not release the shell")
	time.Sleep(300 * time.Millisecond)
	assert.LessOrEqual(t, sink.size(), stalled+FlowHighBytes+2*DefaultReadBufferSize, "and it is paced again")
}

// B2. Shutdown ends every session the way a close does, and no terminal starts after it.
func TestShutdownEndsEverySessionAndRefusesNewOnes(t *testing.T) {
	sink := newChunkSink()
	m := newChunkManager(t, sink)
	t.Setenv("HOME", t.TempDir())
	var ids []string
	for range 3 {
		info, err := m.Start(Options{Command: []string{sh(t)}}, nil)
		require.NoError(t, err)
		ids = append(ids, info.ID)
	}

	m.Shutdown()
	assert.Empty(t, m.running(), "Shutdown returned with the sessions gone, not because closeWait passed")
	for _, id := range ids {
		end := sink.waitEnd(t, id, 5*time.Second)
		assert.Equal(t, EndClosed, end.Reason)
		assert.Equal(t, ClosedByShutdown, end.ClosedBy)
	}
	assert.Empty(t, m.running())

	_, err := m.Start(Options{Command: []string{sh(t)}}, nil)
	require.Error(t, err, "a terminal does not start while the host shuts down")
	assert.Equal(t, "START_FAILED", appErr(t, err).Code)
}

func TestACreditReportAfterTheSessionEndedChangesNothing(t *testing.T) {
	m, _ := newTestManager(t)
	m.DeliveryCredit("no-such-session").Delivered(1 << 20)
	m.DeliveryCredit("").Delivered(-5)
}

// The watchdog keeps a terminal alive when the transport's credit does not come, within a ceiling: it
// steps a paused reader after a stall, at most FlowStallCeilingBytes in all until real credit comes again,
// and never for a client that acknowledges (its pause is its own).
func TestTheWatchdogStepsAPausedReaderUpToTheCeilingAndNeverForAClientThatAcknowledges(t *testing.T) {
	returns := func(f *flowControl, within time.Duration) bool {
		done := make(chan struct{})
		stop := make(chan struct{})
		defer close(stop)
		go func() { f.wait(stop); close(done) }()
		select {
		case <-done:
			return true
		case <-time.After(within):
			return false
		}
	}
	var steps []int
	var mu sync.Mutex
	f := newFlowControl(10*time.Millisecond, func(stepped int) { mu.Lock(); steps = append(steps, stepped); mu.Unlock() })
	given := 0
	for given+FlowHighBytes <= FlowStallCeilingBytes {
		f.sent(FlowHighBytes)
		require.True(t, returns(f, 5*time.Second), "a stalled transport still trickles: the watchdog stepped (given so far %d)", given)
		mu.Lock()
		given = steps[len(steps)-1]
		mu.Unlock()
	}
	// What is left of the budget is less than a cycle: the reader runs out of steps, at the ceiling exactly,
	// and waits for real credit.
	exhausted := false
	for range 10 {
		f.sent(FlowHighBytes)
		if !returns(f, 300*time.Millisecond) {
			exhausted = true
			break
		}
	}
	require.True(t, exhausted, "past the ceiling the reader waits for real credit")
	mu.Lock()
	last := steps[len(steps)-1]
	mu.Unlock()
	assert.Equal(t, FlowStallCeilingBytes, last, "it gave the ceiling and no more")
	f.delivered(1)
	assert.True(t, returns(f, 5*time.Second), "real credit starts the watchdog's count again")

	g := newFlowControl(10*time.Millisecond, nil)
	g.ack(0)
	g.sent(FlowHighBytes)
	assert.False(t, returns(g, 300*time.Millisecond), "a client that acknowledges pauses the shell as long as it likes")
}

// A transport whose credit never comes does not freeze a terminal at the high mark and does not let it grow
// without bound either: it costs the host the high mark plus the ceiling.
func TestATransportThatNeverCreditsTricklesAndIsBoundedByTheCeiling(t *testing.T) {
	m, sink := newTransportManager(t)
	m.SetFlowStall(40 * time.Millisecond)
	info, err := m.Start(Options{Command: []string{sh(t), "-c", "yes flow-control-flood"}}, nil)
	require.NoError(t, err)
	assert.Equal(t, FlowStallCeilingBytes, info.Limits.FlowStallCeilingBytes)

	require.Eventually(t, func() bool { return sink.size() > FlowHighBytes+FlowStepBytes }, 30*time.Second, 10*time.Millisecond, "the watchdog never stepped")
	bound := FlowHighBytes + FlowStallCeilingBytes + 2*DefaultReadBufferSize
	var plateau int
	require.Eventually(t, func() bool {
		before := sink.size()
		time.Sleep(400 * time.Millisecond)
		plateau = sink.size()
		return plateau == before
	}, 60*time.Second, 10*time.Millisecond, "it never settled")
	assert.LessOrEqual(t, plateau, bound, "the high mark plus the ceiling, and one read")
	assert.Greater(t, plateau, FlowHighBytes+FlowStallCeilingBytes-2*FlowStepBytes, "it used the ceiling")

	m.DeliveryCredit(info.ID).Delivered(plateau)
	require.Eventually(t, func() bool { return sink.size() > plateau }, 20*time.Second, 5*time.Millisecond, "real credit set it going again")
}
