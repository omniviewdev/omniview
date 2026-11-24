//go:build !windows

package terminal

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 10. THE INPUT SEQUENCE ACROSS AN ATTACH.

// The queue that orders a terminal's input is the terminal's, not the page's: an attach does not reset it. A
// page that attaches to a terminal whose page before it sent numbers 1 to N has to continue at N+1, and only the
// host knows N: so Attached and Listed say which number the terminal takes next (at least 1), as it stands: the
// lowest number not yet taken. Unsequenced calls (zero) do not move it, a call ahead of it waits and does not
// move it, and a terminal that ended takes no input and says 0.
func TestAnAttachAndAListSayWhichInputSequenceNumberTheTerminalTakesNext(t *testing.T) {
	m, sink := newPageManager(t)
	info := m.startKeyed(t, `stty -echo; cat`, "w1", Options{})

	listed := m.List("w1", "")
	require.Len(t, listed, 1)
	assert.Equal(t, uint64(1), listed[0].NextInputSeq, "nothing was sent: the first number")

	require.NoError(t, m.Write(info.ID, 1, []byte("a\n")))
	require.NoError(t, m.Resize(info.ID, 2, 30, 100))
	require.NoError(t, m.Write(info.ID, 0, []byte("b\n")))
	require.NoError(t, m.Write(info.ID, 3, []byte("c\n")))
	assert.Equal(t, uint64(4), m.List("w1", "")[0].NextInputSeq, "a write and a resize take a number each; an unsequenced call takes none")

	// The page goes, and a page that never saw those numbers attaches.
	assert.Equal(t, Released{Detached: 1, Ended: 0}, m.ReleaseOwned("w1", ClosedByWindow))
	assert.Equal(t, uint64(4), m.List(nil, testKey)[0].NextInputSeq, "a detached terminal keeps its place in the sequence")
	attached, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	assert.Equal(t, uint64(4), attached.NextInputSeq, "the attach does not reset the sequence, and says where it stands")

	// The new page continues from it; what the old page had is stale.
	require.NoError(t, m.Write(info.ID, attached.NextInputSeq, []byte("d\n")))
	assert.Equal(t, "SEQUENCE_STALE", appError(t, m.Write(info.ID, 1, []byte("x\n"))).Code)
	assert.Equal(t, uint64(5), m.List("w2", "")[0].NextInputSeq)
	again, err := m.Attach(info.ID, "w2", AttachRequest{})
	require.NoError(t, err)
	assert.Equal(t, uint64(5), again.NextInputSeq, "and so does the next attach")

	// A call ahead of the number waits for its predecessors: the terminal still takes the lower number next.
	ahead := make(chan error, 1)
	go func() { ahead <- m.Write(info.ID, 7, []byte("g\n")) }()
	queued := m.session(t, info.ID)
	require.Eventually(t, func() bool { return queued.heldOps() == 1 }, 20*time.Second, 5*time.Millisecond, "the call ahead of its number is held")
	assert.Equal(t, uint64(5), m.List("w2", "")[0].NextInputSeq, "a call that waits has not been taken")
	require.NoError(t, m.Write(info.ID, 5, []byte("e\n")))
	require.NoError(t, m.Write(info.ID, 6, []byte("f\n")))
	require.NoError(t, <-ahead)
	assert.Equal(t, uint64(8), m.List("w2", "")[0].NextInputSeq)

	sink.waitFor(t, info.ID, "a\r\n")
	sink.waitFor(t, info.ID, "g\r\n")
}

// heldOps is how many sequenced calls wait in the terminal's input queue for a predecessor that has not come.
func (s *session) heldOps() int {
	s.queue.mu.Lock()
	defer s.queue.mu.Unlock()
	return len(s.queue.held)
}

// A terminal that ended while no page was attached takes no input, and says so with 0, listed and attached.
func TestATerminalThatEndedTakesNoInputAndSaysSo(t *testing.T) {
	m, sink := newPageManager(t)
	info := m.startKeyed(t, `stty -echo; printf 'bye\n'; read x; exit 0`, "w1", Options{})
	sink.waitFor(t, info.ID, "bye\r\n")
	require.NoError(t, m.Write(info.ID, 1, []byte("go\n")))
	sink.waitEnd(t, info.ID)
	require.Eventually(t, func() bool {
		listed := m.List(nil, testKey)
		return len(listed) == 1 && listed[0].Ended != nil
	}, 30*time.Second, 10*time.Millisecond)
	assert.Equal(t, uint64(0), m.List(nil, testKey)[0].NextInputSeq, "it takes no input")
	attached, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	require.NotNil(t, attached.Ended)
	assert.Equal(t, uint64(0), attached.NextInputSeq)
}
