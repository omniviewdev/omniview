package resourceauthoring

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testSessions() (*Sessions, *time.Time) {
	now := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	sessions := NewSessions(DefaultPolicy())
	sessions.now = func() time.Time { return now }
	return sessions, &now
}

func TestNewerRequestSupersedesTheActiveOne(t *testing.T) {
	sessions, _ := testSessions()
	first, releaseFirst, err := sessions.Begin(t.Context(), "owner", "doc", 1)
	require.NoError(t, err)
	defer releaseFirst()
	require.NoError(t, first.Err())

	second, releaseSecond, err := sessions.Begin(t.Context(), "owner", "doc", 2)
	require.NoError(t, err)
	defer releaseSecond()
	assert.ErrorIs(t, first.Err(), context.Canceled, "the older request is cancelled when the newer begins")
	assert.ErrorIs(t, context.Cause(first), ErrSuperseded)
	assert.NoError(t, second.Err())
	assert.ErrorIs(t, Superseded(first), ErrSuperseded)
	assert.ErrorIs(t, Superseded(first), context.Canceled)
	assert.NoError(t, Superseded(second))

	// The same revision (a moved cursor) is also superseded by the newer arrival.
	third, releaseThird, err := sessions.Begin(t.Context(), "owner", "doc", 2)
	require.NoError(t, err)
	defer releaseThird()
	assert.ErrorIs(t, context.Cause(second), ErrSuperseded)
	assert.NoError(t, third.Err())
}

func TestAnOlderRevisionIsRefused(t *testing.T) {
	sessions, _ := testSessions()
	_, release, err := sessions.Begin(t.Context(), "owner", "doc", 5)
	require.NoError(t, err)
	release()
	_, _, err = sessions.Begin(t.Context(), "owner", "doc", 4)
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrStaleRevision)
	assert.ErrorIs(t, err, context.Canceled, "a refused request reports as cancelled")
	// Refusal does not disturb the newer revision's bookkeeping.
	_, release, err = sessions.Begin(t.Context(), "owner", "doc", 5)
	require.NoError(t, err)
	release()
}

func TestDocumentsAndOwnersAreIndependent(t *testing.T) {
	sessions, _ := testSessions()
	a, releaseA, err := sessions.Begin(t.Context(), "owner-1", "doc", 10)
	require.NoError(t, err)
	defer releaseA()
	b, releaseB, err := sessions.Begin(t.Context(), "owner-2", "doc", 1)
	require.NoError(t, err, "another owner's document of the same id has its own revisions")
	defer releaseB()
	c, releaseC, err := sessions.Begin(t.Context(), "owner-1", "other", 1)
	require.NoError(t, err)
	defer releaseC()
	assert.NoError(t, a.Err())
	assert.NoError(t, b.Err())
	assert.NoError(t, c.Err())
	assert.Equal(t, 3, sessions.Len())
}

func TestReleaseEndsTheRequestWithoutForgettingTheRevision(t *testing.T) {
	sessions, _ := testSessions()
	ctx, release, err := sessions.Begin(t.Context(), "owner", "doc", 3)
	require.NoError(t, err)
	release()
	assert.Error(t, ctx.Err(), "release cancels the request's context")
	assert.NotErrorIs(t, context.Cause(ctx), ErrSuperseded, "an ordinary end is not a supersession")
	later, releaseLater, err := sessions.Begin(t.Context(), "owner", "doc", 4)
	require.NoError(t, err)
	defer releaseLater()
	assert.NoError(t, later.Err())
	_, _, err = sessions.Begin(t.Context(), "owner", "doc", 2)
	assert.ErrorIs(t, err, ErrStaleRevision, "the highest revision is remembered after release")
	release() // a second release is harmless
}

func TestIdleDocumentsExpireAndLeastRecentlyUsedAreEvicted(t *testing.T) {
	sessions, now := testSessions()
	_, release, err := sessions.Begin(t.Context(), "owner", "doc", 9)
	require.NoError(t, err)
	release()
	*now = now.Add(DefaultPolicy().DocumentIdleTTL + time.Second)
	_, release, err = sessions.Begin(t.Context(), "owner", "doc", 1)
	require.NoError(t, err, "the idle record expired, so a restarted editor may reuse the id")
	release()
	assert.Equal(t, 1, sessions.Len())

	policy := DefaultPolicy()
	policy.MaxDocuments = 3
	bounded := NewSessions(policy)
	tick := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	bounded.now = func() time.Time { tick = tick.Add(time.Second); return tick }
	var releases []func()
	for i := range 3 {
		_, release, err := bounded.Begin(t.Context(), "owner", fmt.Sprintf("doc-%d", i), 1)
		require.NoError(t, err)
		releases = append(releases, release)
	}
	_, _, err = bounded.Begin(t.Context(), "owner", "doc-busy", 1)
	require.Error(t, err, "every tracked document has a request in flight")
	assert.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	assert.Equal(t, 3, bounded.Len())
	releases[1]()
	_, release, err = bounded.Begin(t.Context(), "owner", "doc-new", 1)
	require.NoError(t, err, "the idle document is evicted for the new one")
	release()
	assert.Equal(t, 3, bounded.Len())
	for _, release := range []func(){releases[0], releases[2]} {
		release()
	}
}

// Under concurrency the registry keeps one live request per document: when every
// goroutine of a burst has begun, exactly the highest revision is still running.
func TestConcurrentBurstsKeepOneActiveRequestPerDocument(t *testing.T) {
	sessions := NewSessions(DefaultPolicy())
	const documents, revisions, owners = 4, 200, 2
	type outcome struct {
		doc      string
		revision uint64
		err      error
		ctx      context.Context
		release  func()
	}
	outcomes := make(chan outcome, documents*revisions*owners)
	var group sync.WaitGroup
	for owner := range owners {
		for doc := range documents {
			for i := range revisions {
				group.Add(1)
				go func() {
					defer group.Done()
					time.Sleep(time.Duration(rand.IntN(200)) * time.Microsecond)
					name := fmt.Sprintf("o%d/d%d", owner, doc)
					ctx, release, err := sessions.Begin(t.Context(), fmt.Sprintf("owner-%d", owner), fmt.Sprintf("doc-%d", doc), uint64(i))
					outcomes <- outcome{doc: name, revision: uint64(i), err: err, ctx: ctx, release: release}
				}()
			}
		}
	}
	group.Wait()
	close(outcomes)
	live := map[string][]uint64{}
	refused := 0
	var releases []func()
	for o := range outcomes {
		if o.err != nil {
			assert.ErrorIs(t, o.err, ErrStaleRevision)
			refused++
			continue
		}
		releases = append(releases, o.release)
		if o.ctx.Err() == nil {
			live[o.doc] = append(live[o.doc], o.revision)
		} else {
			assert.ErrorIs(t, context.Cause(o.ctx), ErrSuperseded)
		}
	}
	require.Len(t, live, documents*owners)
	for doc, revs := range live {
		require.Len(t, revs, 1, "%s has exactly one live request", doc)
		assert.Equal(t, uint64(revisions-1), revs[0], "%s: the live request is the newest revision", doc)
	}
	assert.Less(t, refused, documents*revisions*owners)
	assert.LessOrEqual(t, sessions.Len(), DefaultPolicy().MaxDocuments)
	for _, release := range releases {
		release()
	}
}

func TestSupersededErrorNamesItsCause(t *testing.T) {
	assert.NoError(t, Superseded(t.Context()))
	cancelled, cancel := context.WithCancelCause(t.Context())
	cancel(errors.New("client left"))
	err := Superseded(cancelled)
	assert.ErrorIs(t, err, context.Canceled)
	assert.NotErrorIs(t, err, ErrSuperseded)
}

func TestBeginIsCheapAndBounded(t *testing.T) {
	sessions := NewSessions(DefaultPolicy())
	var calls atomic.Int64
	start := time.Now()
	for i := range 5000 {
		_, release, err := sessions.Begin(t.Context(), "owner", "doc", uint64(i))
		require.NoError(t, err)
		release()
		calls.Add(1)
	}
	assert.Less(t, time.Since(start), 2*time.Second)
	assert.Equal(t, 1, sessions.Len(), "one record per document however many keystrokes")
}
