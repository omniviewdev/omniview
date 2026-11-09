package resourceauthoring

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

var (
	// ErrSuperseded is the cancellation cause of a request replaced by a newer
	// request for the same document.
	ErrSuperseded = errors.New("completion request superseded by a newer request")
	// ErrStaleRevision rejects a request whose document revision is older than
	// one the host already saw for that document.
	ErrStaleRevision = errors.New("completion request is for a stale document revision")
)

type documentKey struct {
	owner    string
	document string
}

type documentState struct {
	highest uint64
	active  *activeRequest
	touched time.Time
}

type activeRequest struct {
	revision uint64
	cancel   context.CancelCauseFunc
}

// Sessions enforces "one active request per document and owner" with
// supersession, so a burst of keystrokes never queues work: each new request
// cancels the one in flight, and a request older than one already seen is
// refused. It keeps one small record per document, bounded by Policy.MaxDocuments
// and expired after Policy.DocumentIdleTTL, and no request payload.
//
// Eviction only forgets a document's highest revision; a late response of an
// evicted document is still discarded by the client's own identity check.
type Sessions struct {
	mu     sync.Mutex
	docs   map[documentKey]*documentState
	policy Policy
	now    func() time.Time
}

// NewSessions returns an empty registry.
func NewSessions(policy Policy) *Sessions {
	return &Sessions{docs: map[documentKey]*documentState{}, policy: policy, now: time.Now}
}

// Len reports the number of tracked documents.
func (s *Sessions) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.docs)
}

// Begin registers a request for revision of document. It returns a context that
// is cancelled with ErrSuperseded when a newer request for the document begins,
// and a release function the caller must call exactly when the request ends.
//
// A revision lower than the highest seen is refused. An equal revision (for
// example a moved cursor) is allowed: the newer arrival supersedes the older.
func (s *Sessions) Begin(ctx context.Context, owner, document string, revision uint64) (context.Context, func(), error) {
	now := s.now()
	key := documentKey{owner: owner, document: document}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	state := s.docs[key]
	if state == nil {
		if len(s.docs) >= s.policy.MaxDocuments && !s.evictLocked() {
			return ctx, nil, resourcev2.NewError("RESOURCE_LIMIT", "Too many documents have a completion request in flight.")
		}
		state = &documentState{}
		s.docs[key] = state
	}
	if revision < state.highest {
		return ctx, nil, fmt.Errorf("%w: %w", context.Canceled, ErrStaleRevision)
	}
	if state.active != nil {
		state.active.cancel(ErrSuperseded)
	}
	state.highest = revision
	state.touched = now
	requestCtx, cancel := context.WithCancelCause(ctx)
	active := &activeRequest{revision: revision, cancel: cancel}
	state.active = active
	release := func() {
		s.mu.Lock()
		if state.active == active {
			state.active = nil
		}
		state.touched = s.now()
		s.mu.Unlock()
		cancel(nil)
	}
	return requestCtx, release, nil
}

// Superseded converts a cancelled request's error into one that names the
// cause, so callers and tests can tell supersession from a client cancel.
func Superseded(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		if cause := context.Cause(ctx); errors.Is(cause, ErrSuperseded) {
			return fmt.Errorf("%w: %w", err, ErrSuperseded)
		}
		return err
	}
	return nil
}

// pruneLocked forgets idle documents past the TTL.
func (s *Sessions) pruneLocked(now time.Time) {
	for key, state := range s.docs {
		if state.active == nil && now.Sub(state.touched) > s.policy.DocumentIdleTTL {
			delete(s.docs, key)
		}
	}
}

// evictLocked forgets the least recently used document with no request in
// flight. It reports false when every tracked document is busy.
func (s *Sessions) evictLocked() bool {
	var oldest documentKey
	var found bool
	var oldestTime time.Time
	for key, state := range s.docs {
		if state.active != nil {
			continue
		}
		if !found || state.touched.Before(oldestTime) {
			oldest, oldestTime, found = key, state.touched, true
		}
	}
	if found {
		delete(s.docs, oldest)
	}
	return found
}

// SupersededError classifies the outcome of a request whose context was
// cancelled by supersession: whatever failure a cancelled step reported, the
// request ended because a newer one replaced it, so the error is a cancellation
// carrying ErrSuperseded. Any other error passes through unchanged.
func SupersededError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if ctx.Err() != nil && errors.Is(context.Cause(ctx), ErrSuperseded) {
		return fmt.Errorf("%w: %w", context.Canceled, ErrSuperseded)
	}
	return err
}
