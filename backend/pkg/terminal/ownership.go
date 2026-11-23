//go:build !windows

package terminal

import (
	"slices"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// A session belongs to one window at a time: the window that opened it, until another window takes it (the page
// that attaches a detached terminal with its key, or the window that claims it after its owner offered it).
// Every call that names a session by its id alone (the bare-id bindings) asks Authorize first, and a caller that
// does not hold the session is told what is told of an id that never was, so that an id says nothing of what it
// names, whose it is, or that it is. A terminal that is detached belongs to nobody until a page attaches it.

// validCaller says whether owner can be taken for a window: some value that can be compared (ValidOwner).
func validCaller(owner Owner) bool { return ValidOwner(owner) }

// ownerNow is the window the session belongs to at this moment: none while it is detached.
func (s *session) ownerNow() Owner {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.owner
}

// heldBy says whether owner is the window the session belongs to, and the session is not detached. The caller
// holds s.mu.
func (s *session) heldBy(owner Owner) bool {
	return owner != nil && s.owner != nil && !s.detached && s.owner == owner
}

// offerOpenLocked says whether the owner's offer of the session is open at now. The caller holds s.mu.
func (s *session) offerOpenLocked(now time.Time) bool {
	return !s.offerUntil.IsZero() && now.Before(s.offerUntil)
}

// Authorize says nothing when owner holds the session, and what is said of an id that never was when it does not.
// It holds a session that is running and belongs to owner, the end of a session that owner had (the last
// acknowledgement of a shell that exited races its CLOSE) and the end a tombstone keeps for the window that has
// attached it.
func (m *Manager) Authorize(sessionID string, owner Owner) error {
	if !validCaller(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	m.mu.RLock()
	s := m.sessions[sessionID]
	held := s == nil && m.holdsEndedLocked(sessionID, owner)
	m.mu.RUnlock()
	if s != nil {
		s.mu.Lock()
		held = s.heldBy(owner)
		s.mu.Unlock()
	}
	if !held {
		return apperror.SessionNotFound(sessionID)
	}
	return nil
}

// holdsEndedLocked says whether owner holds what is left of a session that ended: the tombstone of a terminal
// that ended by itself, or the memory of one that ended. The caller holds m.mu.
func (m *Manager) holdsEndedLocked(id string, owner Owner) bool {
	now := time.Now()
	for _, t := range m.tombs {
		if t.id == id && now.Before(t.until) {
			return t.owner != nil && t.owner == owner
		}
	}
	return slices.ContainsFunc(m.ended, func(e endedSession) bool { return e.id == id && e.owner != nil && e.owner == owner })
}

// Offer opens the owner's offer of its session to the next window that claims it, for ttl (cut to OfferTTL; zero
// is OfferTTL): the move of a tab to another window. Only the window that holds the session offers it, and the
// offer gives it nobody's access: it is a right to Claim.
func (m *Manager) Offer(sessionID string, owner Owner, ttl time.Duration) error {
	if !validCaller(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	s, err := m.live(sessionID)
	if err != nil {
		return err
	}
	if ttl <= 0 || ttl > OfferTTL {
		ttl = OfferTTL
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.heldBy(owner) || s.fate.set || s.ending.Load() {
		return apperror.SessionNotFound(sessionID)
	}
	s.offerUntil = time.Now().Add(ttl)
	return nil
}

// Claim makes owner the window the session belongs to, when it already is, or when its owner offered it and the
// offer is open: the offer is used once, and the window that lost the session is told (Detachment). Any other
// caller is told what is told of an id that never was.
func (m *Manager) Claim(sessionID string, owner Owner) error {
	if !validCaller(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	s, err := m.live(sessionID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	switch {
	case s.heldBy(owner):
		s.mu.Unlock()
		return nil
	case s.offerOpenLocked(time.Now()) && !s.fate.set && !s.ending.Load():
		replaced := s.takeOverLocked(owner)
		s.mu.Unlock()
		m.told(s, replaced)
		return nil
	default:
		s.mu.Unlock()
		return apperror.SessionNotFound(sessionID)
	}
}

// SessionsOf lists the running sessions that belong to owner: not another window's, and not a terminal that is
// detached.
func (m *Manager) SessionsOf(owner Owner) []*sdkexec.Session {
	if !validCaller(owner) {
		return nil
	}
	m.mu.RLock()
	sessions := make([]*session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.mu.RUnlock()
	var out []*sdkexec.Session
	for _, s := range sessions {
		s.mu.Lock()
		held := s.heldBy(owner) && !s.ending.Load()
		s.mu.Unlock()
		if held {
			out = append(out, s.snapshot())
		}
	}
	return out
}
