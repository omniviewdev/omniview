//go:build !windows

package terminal

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE CLOSE ON THE STREAM (docs/ui-next/terminal-channel-protocol.md sections 4 and 8). The page sends `close` (0x06) on its stream. The
// terminal ends only when that stream is the current holder, decided in the same step under the terminal's lock that decides the
// holder; from a watcher (a displaced stream) it ends nothing and the stream is sent `close-refused` (0x8a). A close can no longer end
// a terminal another stream holds. The order of the pairs is forced by decisions made by hand.

func TestTheHoldersCloseOnItsStreamEndsTheTerminalAndTellsTheStreamHowItEnded(t *testing.T) {
	m, info, s, _ := wireTerminal(t, `sleep 600`)
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	a.closeTerminal()
	guarded(t, "holder-close-ends", func() {
		st := a.waitClosed()
		require.Len(t, st.ended, 1, "the holder is told how it ended")
		assert.Equal(t, EndClosed, st.ended[0].Reason)
		assert.Zero(t, st.closeRefused)
		assert.True(t, s.hasExited() || s.ending.Load(), "the terminal is ending")
		m.awaitGone([]*session{s})
		err := m.CloseChannel(info.Cap)
		require.Error(t, err, "and its capability opens nothing")
		assert.Equal(t, ChannelNotFound().Error(), err.Error())
	})
}

func TestADisplacedHoldersCloseIsRefusedAndTheNewHolderKeepsTheTerminalAndIsNotToldOfAnEnd(t *testing.T) {
	m, info, s, dev := wireTerminal(t, `sleep 600`)
	dev.openAll()
	a := m.attach(t, info.Cap, nil)
	a.waitReady()
	b := m.attach(t, info.Cap, nil)
	b.waitReady()
	a.waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })
	a.closeTerminal()
	guarded(t, "displaced-close-refused", func() {
		st := a.waitFor("close-refused", func(st pageState) bool { return st.closeRefused >= 1 })
		assert.Equal(t, wCloseRefused, st.order[len(st.order)-1])
		assert.Empty(t, st.ended)
		assert.False(t, a.isClosed(), "a refused close leaves the watcher a watcher")
		assert.False(t, s.settled().set, "the terminal's end was not decided")
		assert.False(t, gone(info.PID), "the shell runs")
		assert.True(t, s.channelStats().held)
		assert.Empty(t, b.state().ended, "the holder is told of no end")
		assert.False(t, b.isClosed())
	})
	guarded(t, "displaced-close-refused", func() {
		b.input("still")
		b.waitFor("applied 5", appliedIs(5))
		b.close()
		st := a.waitClosed()
		assert.Equal(t, 1, st.released, "and the watcher is told the terminal is free, as before")
	})
}

func TestEveryWatchersCloseIsRefusedAndTheirReleaseStillComes(t *testing.T) {
	m, info, s, _ := wireTerminal(t, `sleep 600`)
	pages := make([]*chanPage, 0, 4)
	for range 4 {
		p := m.attach(t, info.Cap, nil)
		p.waitReady()
		if n := len(pages); n > 0 {
			pages[n-1].waitFor("taken-over", func(st pageState) bool { return st.takenOver == 1 })
		}
		pages = append(pages, p)
	}
	for _, p := range pages[:3] {
		p.closeTerminal()
	}
	guarded(t, "displaced-close-refused", func() {
		for i, p := range pages[:3] {
			p.waitFor("close-refused", func(st pageState) bool { return st.closeRefused >= 1 })
			assert.False(t, p.isClosed(), "watcher %d", i)
		}
		assert.False(t, s.settled().set)
	})
	guarded(t, "displaced-close-refused", func() {
		pages[3].close()
		for _, p := range pages[:3] {
			assert.Equal(t, 1, p.waitClosed().released)
		}
	})
}

// The close against a takeover, both orders. The takeover first: the close is the displaced stream's and is refused. The close first: the
// terminal's end is decided in the step that decides the holder, so the stream that attaches after it finds a terminal that is not
// claimable (not-found) and the holder is told the end.
func TestACloseAndATakeoverAtOnceHaveOneOutcomeInEitherOrder(t *testing.T) {
	t.Run("the takeover is first", func(t *testing.T) {
		m, info, s, _ := wireTerminal(t, `sleep 600`)
		a := m.attach(t, info.Cap, nil)
		a.waitReady()
		b := m.attach(t, info.Cap, nil)
		b.waitReady()
		a.closeTerminal()
		guarded(t, "displaced-close-refused", func() {
			a.waitFor("close-refused", func(st pageState) bool { return st.closeRefused >= 1 })
			assert.False(t, s.settled().set)
		})
	})
	t.Run("the close is first", func(t *testing.T) {
		m, info, s, _ := wireTerminal(t, `sleep 600`)
		a := m.attach(t, info.Cap, nil)
		a.waitReady()
		a.closeTerminal()
		guarded(t, "holder-close-ends", func() {
			require.Eventually(t, func() bool { return s.settled().set }, settle, 1e6, "the close decided the end")
		})
		guarded(t, "holder-close-ends", func() {
			b := m.attach(t, info.Cap, nil)
			st := b.waitClosed()
			assert.Equal(t, 1, st.notFound, "a terminal whose end is decided cannot be claimed")
			assert.Zero(t, st.takenOver)
			assert.Equal(t, 1, len(a.waitClosed().ended), "the holder is told the end")
		})
	})
}

// A close that is the first frame of a stream is not an attach: the one not-found, as for any frame that is not an attach. A stream
// that is not attached ends nothing.
func TestACloseThatIsTheFirstFrameOfAStreamEndsNothing(t *testing.T) {
	m, info, s, _ := wireTerminal(t, `sleep 600`)
	_, frame := firstFrame(t, m, closeFrame())
	guarded(t, "unattached-close-ends-nothing", func() {
		assert.Equal(t, []byte{wNotFound}, frame)
		assert.False(t, s.settled().set)
		assert.False(t, gone(info.PID))
	})
}
