package mcprelay

import (
	"context"
	"errors"
	"maps"
	"sort"
	"time"

	"github.com/google/uuid"
)

const confirmationTimeout = 2 * time.Minute

type pendingEntry struct {
	payload  PendingConfirmation
	decision chan bool
}

// awaitConfirmation publishes the request and blocks until the user decides,
// the caller gives up, or the timeout passes.
func (r *Relay) awaitConfirmation(ctx context.Context, payload PendingConfirmation) (approved bool, reason string) {
	if ctx.Err() != nil {
		return false, "cancelled"
	}
	// Consent must be reachable before the caller is allowed to wait for it.
	// No window manager (or a failed focus request) is not implicit consent.
	if r.showConfirmation == nil || r.showConfirmation() != nil {
		if r.authority != nil {
			r.authority.Record(ctx, "consent-unavailable")
		}
		return false, "unavailable"
	}
	if r.authority != nil {
		payload = r.authority.Confirmation(ctx, payload)
		r.authority.Record(ctx, "consent-requested")
	}
	payload.Target.Scope = maps.Clone(payload.Target.Scope)
	payload.ID = uuid.NewString()
	payload.RequestedAt = time.Now()
	entry := &pendingEntry{payload: payload, decision: make(chan bool, 1)}

	r.confirmMu.Lock()
	r.pending[payload.ID] = entry
	r.confirmMu.Unlock()

	r.emit(EventConfirmationRequested, payload)

	timer := time.NewTimer(confirmationTimeout)
	defer timer.Stop()

	select {
	case approved = <-entry.decision:
		if approved {
			reason = "approved"
		} else {
			reason = "denied"
		}
	case <-ctx.Done():
		reason = "cancelled"
	case <-timer.C:
		reason = "timeout"
	}

	r.confirmMu.Lock()
	delete(r.pending, payload.ID)
	r.confirmMu.Unlock()

	r.emit(EventConfirmationResolved, ConfirmationResolved{ID: payload.ID, Approved: approved, Reason: reason})
	if r.authority != nil {
		r.authority.Record(ctx, "consent-"+reason)
	}
	return approved, reason
}

// ResolveConfirmation records the user's decision for a pending call.
func (r *Relay) ResolveConfirmation(id string, approved bool) error {
	r.confirmMu.Lock()
	entry, ok := r.pending[id]
	if ok {
		delete(r.pending, id)
	}
	r.confirmMu.Unlock()
	if !ok {
		return errors.New("no pending confirmation " + id)
	}
	select {
	case entry.decision <- approved:
	default:
	}
	return nil
}

// ListPendingConfirmations returns the open requests, oldest first.
func (r *Relay) ListPendingConfirmations() []PendingConfirmation {
	r.confirmMu.Lock()
	out := make([]PendingConfirmation, 0, len(r.pending))
	for _, entry := range r.pending {
		payload := entry.payload
		payload.Target.Scope = maps.Clone(payload.Target.Scope)
		out = append(out, payload)
	}
	r.confirmMu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].RequestedAt.Before(out[j].RequestedAt) })
	return out
}
