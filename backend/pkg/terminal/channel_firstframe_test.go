//go:build !windows

package terminal

import (
	"bytes"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE FIRST FRAME (S2 of the review of PR 704). A stream is a connection of the transport, and the transport holds a limited number
// of them; Wails' stream route has no ping and no read deadline, so a socket that sends nothing keeps its slot, and the goroutine of
// the host that waits for its first frame, for ever: 4,096 idle sockets fill the connection cap of the transport and a real page
// cannot attach. The host closes a stream that has sent nothing when the first-frame wait is over, with no answer, and a stream that
// shows its capability in time is never closed by that wait. The wait is on the manager's clock, so these tests move the clock and
// never sleep: an event that must come (the host arms the wait, the stream returns) is waited for with a bound that only a missing
// event reaches.

// A stream that sends nothing is closed when the wait is over, and not a moment before. The clock moves to a millisecond before the
// deadline, where the stream is open and the wait is still armed, and then to the deadline.
func TestAStreamThatSendsNothingIsClosedWhenTheFirstFrameWaitIsOverAndNotBefore(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := withFakeClock(m)
	wait := m.channel.firstFrame
	f := newFakeChannel(t)
	served := make(chan struct{})
	go func() {
		defer close(served)
		m.ServeChannel(f)
	}()

	guarded(t, "first-frame-deadline", func() {
		require.Eventually(t, func() bool { return clock.pending() >= 1 }, settle, time.Millisecond,
			"the host never armed a deadline for the first frame of a stream that sends nothing")
		clock.Advance(wait - time.Millisecond)
		assert.Equal(t, 1, clock.pending(), "a millisecond before the deadline the wait is still armed")
		assert.False(t, f.isClosed(), "and the stream is open")
		select {
		case <-served:
			assert.Fail(t, "the host stopped serving the stream a millisecond before the deadline")
		default:
		}

		clock.Advance(time.Millisecond)
		select {
		case <-served:
		case <-time.After(settle):
			require.Fail(t, "the host never stopped serving a stream that sent nothing for the whole first-frame wait")
		}
		assert.True(t, f.isClosed(), "the host closed the stream when the wait was over")
		assert.Empty(t, f.allFrames(), "and gave it no answer: a stream that shows nothing is told nothing")
	})
}

// A stream that shows its capability in time is not closed when the wait is over: the host stops the wait once the first frame has
// come. The clock moves twice the wait, and the stream then carries a line to the shell and its echo back, which is what makes the
// effect of a wait that was not stopped observable: the stream is closed by the time the line is typed, and no sleep is needed.
func TestAStreamThatShowsItsCapabilityInTimeIsNotClosedWhenTheFirstFrameWaitIsOver(t *testing.T) {
	m, _ := newChannelManager(t, smallChannel)
	clock := withFakeClock(m)
	info := m.startChannel(t, `stty -echo -opost; printf 'up\n'; exec cat`, Options{})
	page := m.attach(t, info.Cap, nil)
	page.waitBytes(len("up\n")) // the host read the first frame and took the terminal: its wait for the first frame is over

	guarded(t, "first-frame-wait-stopped", func() {
		clock.Advance(2 * m.channel.firstFrame)
		page.input("ping\n")
		st := page.waitFor("the line it typed, back from the shell", func(s pageState) bool { return bytes.Contains(s.bytes(), []byte("up\nping\n")) })
		assert.False(t, page.isClosed(), "the stream that showed its capability in time is open after the first-frame wait")
		assert.Empty(t, st.faults)
	})
}
