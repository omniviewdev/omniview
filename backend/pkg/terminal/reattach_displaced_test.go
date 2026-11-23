//go:build !windows

package terminal

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// 9. A PAGE THAT WAS DISPLACED.

// A duplicated tab shares the page key of the tab it was copied from, and the later attach takes the terminal.
// The older tab cannot know it was displaced when the user closes it and its page says DetachTerminal, as a
// leaving page may: the host refuses it, because the terminal belongs to another window now, and tells it what it
// tells of a terminal that is not there. The page that owns the terminal keeps it, and no lease runs.
func TestAPageThatWasDisplacedCannotDetachTheTerminalThePageThatTookOverOwns(t *testing.T) {
	m, sink := newPageManager(t)
	info := m.startKeyed(t, `printf 'A\n'; sleep 30`, "w-old", Options{})
	sink.waitFor(t, info.ID, "A\r\n")
	_, err := m.Attach(info.ID, "w-new", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	s := m.session(t, info.ID)

	for _, caller := range []Owner{"w-old", "w-elsewhere", nil} {
		_, err = m.Detach(info.ID, caller, DetachRequest{PageKey: testKey})
		require.Error(t, err, "caller %v holds the key, and the terminal is another window's", caller)
		assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, err).Type, "told what is told of a terminal that is not there")
	}
	detached, owner, timer, _ := s.state()
	assert.False(t, detached, "the terminal is still attached")
	assert.Equal(t, Owner("w-new"), owner, "to the window that took it over")
	assert.False(t, timer, "no lease runs")
	assert.False(t, s.flow.isHeld(), "and its output is still read")
	assert.True(t, m.List("w-new", "")[0].Attached)

	// The window that owns it detaches it, and once nobody owns it the key says it again without harm.
	first, err := m.Detach(info.ID, "w-new", DetachRequest{PageKey: testKey})
	require.NoError(t, err)
	again, err := m.Detach(info.ID, "w-old", DetachRequest{PageKey: testKey})
	require.NoError(t, err, "nobody owns it now: the key is enough")
	assert.Equal(t, first.LeaseExpiresUnixMs, again.LeaseExpiresUnixMs, "and the lease runs once")
	detached, owner, timer, _ = s.state()
	assert.True(t, detached)
	assert.Nil(t, owner)
	assert.True(t, timer)
}

// A page that holds a terminal is told, on its own event, when it does not: another page took it over, the page
// detached it, or its window went away. The event carries the number of the attachment that ended, so that the
// page that took the terminal over (whose number is the next one, said in its answer) is not confused by the
// event that displaced the other. An attach that displaces nobody, a call that is refused and a retirement that
// finds nothing of its own say nothing.
func TestAPageIsToldWhenItsTerminalIsTakenOverOrDetachedAndWhichAttachmentItWas(t *testing.T) {
	m, sink := newPageManager(t)
	info := m.startKeyed(t, `sleep 30`, "w1", Options{})

	second, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	assert.Equal(t, uint64(1), second.Attachment, "the window that opened the terminal held attachment 0")
	third, err := m.Attach(info.ID, "w3", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	assert.Equal(t, uint64(2), third.Attachment)

	_, err = m.Attach(info.ID, "w5", AttachRequest{PageKey: otherTestKey})
	require.Error(t, err, "a refused attach takes nothing")
	past := uint64(1) << 40
	_, err = m.Attach(info.ID, "w5", AttachRequest{PageKey: testKey, FromOffset: &past})
	require.Error(t, err, "and neither does one the host cannot answer")

	_, err = m.Detach(info.ID, "w3", DetachRequest{})
	require.NoError(t, err)
	_, err = m.Detach(info.ID, "w3", DetachRequest{PageKey: testKey})
	require.NoError(t, err, "a terminal that is detached stays detached, and says nothing")

	fourth, err := m.Attach(info.ID, "w4", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	assert.Equal(t, uint64(3), fourth.Attachment, "only the attaches that succeeded were counted")

	assert.Equal(t, Released{Detached: 0, Ended: 0}, m.ReleaseOwned("w1", ClosedByWindow), "the late retirement of the first window")
	assert.Equal(t, Released{Detached: 1, Ended: 0}, m.ReleaseOwned("w4", ClosedByWindow))
	fifth, err := m.Attach(info.ID, "w6", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	assert.Equal(t, uint64(4), fifth.Attachment)
	// A window that attaches the terminal it already holds (a native window that reloaded in place keeps its
	// identity) takes the next attachment, and the page it replaces is told as well.
	sixth, err := m.Attach(info.ID, "w6", AttachRequest{})
	require.NoError(t, err, "the owner needs no key")
	assert.Equal(t, uint64(5), sixth.Attachment)

	assert.Equal(t, []Detachment{
		{By: DetachedByTakeover, Attachment: 0},
		{By: DetachedByTakeover, Attachment: 1},
		{By: DetachedByRequest, Attachment: 2},
		{By: DetachedByWindow, Attachment: 3},
		{By: DetachedByTakeover, Attachment: 4},
	}, sink.detachments(info.ID), "exactly the attachments that ended, with why")

	plain, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, "w7")
	require.NoError(t, err)
	assert.Equal(t, Released{Detached: 0, Ended: 1}, m.ReleaseOwned("w7", ClosedByWindow))
	assert.Empty(t, sink.detachments(plain.ID), "a terminal without a key is ended with its window: nobody is told it was detached")
}

// An attach answers in one step that is ordered with the output: an event whose bytes the replay holds is out
// before the attach answers. A read that was numbered and was still on its way to the sink would otherwise reach
// the page after the answer, below the offset the replay ends at.
func TestAnAttachDoesNotAnswerWhileAReadItsReplayHoldsIsOnItsWayToTheSink(t *testing.T) {
	m, sink := newPageManager(t)
	gate := make(chan struct{})
	release := sync.OnceFunc(func() { close(gate) })
	t.Cleanup(release)
	entered := make(chan struct{}, 1)
	var (
		first     sync.Once
		answered  atomic.Bool
		replayEnd atomic.Uint64
		stale     atomic.Int32
	)
	// The sink holds the first event, which is recorded, numbered and in the ring, until the test lets it go.
	sink.setHook(func(_ string, offset uint64, data []byte) {
		first.Do(func() {
			entered <- struct{}{}
			<-gate
		})
		if answered.Load() && offset+uint64(len(data)) <= replayEnd.Load() {
			stale.Add(1)
		}
	})
	info := m.startKeyed(t, `printf 'A\n'; sleep 30`, "w1", Options{})
	select {
	case <-entered:
	case <-time.After(20 * time.Second):
		t.Fatal("the first read never reached the sink")
	}

	type answer struct {
		attached *Attached
		err      error
	}
	got := make(chan answer, 1)
	go func() {
		attached, err := m.Attach(info.ID, "w2", AttachRequest{PageKey: testKey})
		if err == nil {
			replayEnd.Store(attached.Replay.End)
		}
		answered.Store(true)
		got <- answer{attached, err}
	}()
	early := false
	select {
	case a := <-got:
		early = true
		got <- a
	case <-time.After(300 * time.Millisecond):
	}
	release()
	var res answer
	select {
	case res = <-got:
	case <-time.After(20 * time.Second):
		t.Fatal("the attach never answered")
	}
	require.NoError(t, res.err)
	assert.False(t, early, "the attach answered while a read its replay holds was still on its way to the sink")
	assert.Equal(t, "A\r\n", string(res.attached.Replay.Data))
	assert.Zero(t, stale.Load(), "an event below the end of the replay reached the sink after the attach answered")
}

// A tombstone is freed when its lease is over, by a timer, not by the next terminal that ends; the one timer is
// the manager's own, waits for the tombstone that expires first, and does not outlive the manager.
func TestTombstonesThatExpiredAreFreedByATimerAndTheTimerStopsWithTheManager(t *testing.T) {
	m, sink := newPageManager(t)
	short := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "w1", Options{LeaseMs: 2000})
	sink.waitFor(t, short.ID, "up\r\n")
	require.NoError(t, m.Write(short.ID, 0, []byte("go\n")))
	sink.waitEnd(t, short.ID)
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, 10*time.Second, 5*time.Millisecond,
		"the shell ended by itself and left its end")
	assert.True(t, m.tombstoneTimerArmed())

	// Nothing else happens: no list, no attach, no other terminal ends.
	require.Eventually(t, func() bool { return m.tombstoneCount() == 0 }, 10*time.Second, 20*time.Millisecond,
		"the tombstone is freed when its lease is over")
	assert.False(t, m.tombstoneTimerArmed(), "and no timer waits for what is gone")

	long := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "w2", Options{LeaseMs: 60000})
	sink.waitFor(t, long.ID, "up\r\n")
	require.NoError(t, m.Write(long.ID, 0, []byte("go\n")))
	sink.waitEnd(t, long.ID)
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, 10*time.Second, 5*time.Millisecond)
	assert.True(t, m.tombstoneTimerArmed(), "the timer waits for the tombstone of a lease of a minute")

	m.Shutdown()
	assert.False(t, m.tombstoneTimerArmed(), "the shutdown stops it")
	assert.Zero(t, m.tombstoneCount(), "and the host that quits keeps nothing")
}
