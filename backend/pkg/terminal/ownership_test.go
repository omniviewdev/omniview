//go:build !windows

package terminal

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// 11. WHO HOLDS A SESSION.

func notFound(t *testing.T, err error, id string) {
	t.Helper()
	require.Error(t, err)
	assert.Equal(t, apperror.TypeSessionNotFound, appErr(t, err).Type, "told what is told of a session that is not there")
	assert.Equal(t, apperror.SessionNotFound(id).Error(), err.Error(), "and nothing of whose it is")
}

// A session is held by the window that owns it and by no other. Every other caller (a window with no session of its
// own, a caller that is no window, one whose owner cannot even be compared) is told what is told of an id that never
// was, so that an id says nothing of what it names. A terminal that is detached belongs to nobody until a page
// attaches it, and then to that page alone.
func TestOnlyTheWindowThatOwnsASessionIsAuthorizedForIt(t *testing.T) {
	m, _ := newPageManager(t)
	plain, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, "wA")
	require.NoError(t, err)
	keyed := m.startKeyed(t, `sleep 30`, "wA", Options{})

	for _, id := range []string{plain.ID, keyed.ID} {
		require.NoError(t, m.Authorize(id, "wA"), "the window that opened it")
		for _, stranger := range []Owner{"wB", nil, 0, []int{1}} {
			notFound(t, m.Authorize(id, stranger), id)
		}
	}
	notFound(t, m.Authorize("no-such-session", "wA"), "no-such-session")

	m.ReleaseOwned("wA", ClosedByWindow)
	notFound(t, m.Authorize(keyed.ID, "wA"), keyed.ID)
	notFound(t, m.Authorize(keyed.ID, "wB"), keyed.ID)
	_, err = m.Attach(keyed.ID, "wB", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	require.NoError(t, m.Authorize(keyed.ID, "wB"), "the page that took it over")
	notFound(t, m.Authorize(keyed.ID, "wA"), keyed.ID)
}

// A window lists the running sessions it holds and no other's.
func TestAWindowListsOnlyTheSessionsItHolds(t *testing.T) {
	m, _ := newPageManager(t)
	mine, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, "wA")
	require.NoError(t, err)
	theirs, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, "wB")
	require.NoError(t, err)
	parked := m.startKeyed(t, `sleep 30`, "wA", Options{})
	m.ReleaseOwned("wA", ClosedByWindow)
	again, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, "wA")
	require.NoError(t, err)

	idsOf := func(owner Owner) []string {
		var out []string
		for _, s := range m.SessionsOf(owner) {
			out = append(out, s.ID)
		}
		return out
	}
	assert.Equal(t, []string{again.ID}, idsOf("wA"), "what the window holds now: not the terminal its window left detached, not another's")
	assert.Equal(t, []string{theirs.ID}, idsOf("wB"))
	assert.Empty(t, idsOf("wC"))
	assert.Empty(t, idsOf(nil))
	assert.Empty(t, idsOf([]int{1}))
	_, _ = mine, parked
}

// The owner may OFFER a session: the next window to claim it holds it (the move of a tab to another window), once
// and for a short time. An offer is a right to claim and no access: nobody else is authorized meanwhile, only the
// owner offers, and the window that was told it lost the session is told. The owner claims its own session without
// an offer.
func TestAnOfferLetsTheNextWindowClaimASessionOnceAndOnlyTheOwnerMakesIt(t *testing.T) {
	m, sink := newPageManager(t)
	clock := withFakeClock(m)
	info, err := m.Start(Options{Command: []string{sh(t), "-c", `sleep 30`}}, "wA")
	require.NoError(t, err)

	notFound(t, m.Offer(info.ID, "wB", OfferTTL), info.ID)
	notFound(t, m.Claim(info.ID, "wB"), info.ID)
	require.NoError(t, m.Offer(info.ID, "wA", OfferTTL))
	require.NoError(t, m.Authorize(info.ID, "wA"), "the owner holds it while the offer is open")
	notFound(t, m.Authorize(info.ID, "wB"), info.ID)
	require.NoError(t, m.Claim(info.ID, "wB"))
	require.NoError(t, m.Authorize(info.ID, "wB"))
	notFound(t, m.Authorize(info.ID, "wA"), info.ID)
	notFound(t, m.Claim(info.ID, "wC"), info.ID)
	assert.Equal(t, []Detachment{{By: DetachedByTakeover, Attachment: 0}}, sink.detachments(info.ID), "the window that lost it is told")

	require.NoError(t, m.Claim(info.ID, "wB"), "the owner claims its own session")
	require.NoError(t, m.Offer(info.ID, "wB", 50*time.Millisecond))
	clock.Advance(50*time.Millisecond - time.Nanosecond)
	require.NoError(t, m.Authorize(info.ID, "wB"), "an offer that is still open changes nothing")
	clock.Advance(time.Nanosecond)
	notFound(t, m.Claim(info.ID, "wC"), info.ID)
	require.NoError(t, m.Authorize(info.ID, "wB"), "an offer that ran out changes nothing")
}

// What a window is told after its session ended: it may still acknowledge it (the last acknowledgement races the
// CLOSE); a stranger is told what is told of an id that never was. A terminal that ended by itself while no page
// was attached leaves its end for the page that attaches it, and that page, and no other, may dismiss it.
func TestAnEndedSessionAndTheEndOfAKeyedTerminalAreHeldByTheirLastWindow(t *testing.T) {
	m, sink := newPageManager(t)
	plain, err := m.Start(Options{Command: []string{sh(t), "-c", `printf 'bye\n'`}}, "wA")
	require.NoError(t, err)
	sink.waitEnd(t, plain.ID)
	require.NoError(t, m.Authorize(plain.ID, "wA"), "its window may still acknowledge it")
	notFound(t, m.Authorize(plain.ID, "wB"), plain.ID)

	keyed := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "wA", Options{})
	sink.waitFor(t, keyed.ID, "up\r\n")
	m.endTheShellWith(keyed.ID, 0, "go\n")
	sink.waitEnd(t, keyed.ID)
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, 20*time.Second, 5*time.Millisecond)
	_, err = m.Attach(keyed.ID, "wB", AttachRequest{PageKey: testKey})
	require.NoError(t, err)
	require.NoError(t, m.Authorize(keyed.ID, "wB"), "the page that attached its end")
	notFound(t, m.Authorize(keyed.ID, "wC"), keyed.ID)
	require.NoError(t, m.CloseSession(keyed.ID), "dismisses it")
}

// An attach that is refused owns nothing (CodeRabbit): a caller that asks for the end of a terminal from an offset that
// is past it is told so, and does not take the end from the window that holds it.
func TestARefusedAttachOfAnEndedTerminalDoesNotTakeItFromTheWindowThatHoldsIt(t *testing.T) {
	m, sink := newPageManager(t)
	keyed := m.startKeyed(t, `stty -echo; printf 'up\n'; read x; exit 0`, "wA", Options{})
	sink.waitFor(t, keyed.ID, "up\r\n")
	m.endTheShellWith(keyed.ID, 0, "go\n")
	sink.waitEnd(t, keyed.ID)
	require.Eventually(t, func() bool { return m.tombstoneCount() == 1 }, 20*time.Second, 5*time.Millisecond)
	_, err := m.Attach(keyed.ID, "wB", AttachRequest{PageKey: testKey})
	require.NoError(t, err)

	past := uint64(1) << 40
	_, err = m.Attach(keyed.ID, "wC", AttachRequest{PageKey: testKey, FromOffset: &past})
	require.Error(t, err, "an offset past the end of the output is refused")
	require.NoError(t, m.Authorize(keyed.ID, "wB"), "the window that held the end still holds it")
	notFound(t, m.Authorize(keyed.ID, "wC"), keyed.ID)
}
