//go:build !windows

package terminal

import (
	"context"
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
	now := m.clock.Now()
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
	s.offerUntil = m.clock.Now().Add(ttl)
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
	case s.offerOpenLocked(m.clock.Now()) && !s.fate.set && !s.ending.Load():
		replaced := s.takeOverLocked(owner)
		s.mu.Unlock()
		m.told(s, replaced)
		return nil
	default:
		s.mu.Unlock()
		return apperror.SessionNotFound(sessionID)
	}
}

// CloseOwned ends a session at the request of the window that holds it, or dismisses the end that a terminal that ended
// by itself left for the window that attached it, and when it returns the session is gone (CloseSession). Any other
// caller is told what is told of an id that never was.
//
// Who holds the session is read and the end is decided in one step, under the session's lock: a window that lost the
// terminal to another (an offer that was used) a moment ago does not end what the other holds, and a claim that comes
// after the decision is refused (Claim), because a terminal whose end is decided is nobody's to take. A caller that
// checked first and closed after would end the terminal of whichever window had taken it in between.
func (m *Manager) CloseOwned(sessionID string, owner Owner) error {
	if !validCaller(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	s, err := m.live(sessionID)
	if err != nil {
		if m.dismissEnded(sessionID, owner) {
			return nil
		}
		return err
	}
	s.mu.Lock()
	if !s.heldBy(owner) {
		s.mu.Unlock()
		return apperror.SessionNotFound(sessionID)
	}
	// A shell that ended by itself in the meantime already has its fate: its own end stands, and this call waits for it.
	decided := !s.fate.set
	if decided {
		s.fate = fate{set: true, closedBy: ClosedByRequest, failure: nil}
	}
	s.mu.Unlock()
	if decided {
		m.hookBeforeEnd(sessionID)
		s.startClose()
	}
	m.awaitGone([]*session{s})
	return nil
}

// dismissEnded forgets the end that a terminal that ended by itself left, when owner is the window that holds it (the
// one the terminal belonged to when it ended, or the last that attached the end), and says whether it did. The window
// is read and the end is forgotten in one step, under m.mu, where Attach hands the end to another window.
func (m *Manager) dismissEnded(id string, owner Owner) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.clock.Now()
	at := slices.IndexFunc(m.tombs, func(t *tombstone) bool {
		return t.id == id && now.Before(t.until) && t.owner != nil && t.owner == owner
	})
	if at < 0 {
		return false
	}
	m.tombs = slices.Delete(m.tombs, at, at+1)
	return true
}

// hookBeforeEnd runs the test's hold at the instant between the decision to end a terminal and the end (Manager.beforeEnd).
func (m *Manager) hookBeforeEnd(id string) {
	if m.beforeEnd != nil {
		m.beforeEnd(id)
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

// Revoke takes back the owner's offer of its session: the next window that claims it finds none (the move of a tab that
// did not happen: the drop was refused, or the window that was to take it went away). Only the window that holds the
// session revokes; an offer that is not open is nothing to take back, and no error.
func (m *Manager) Revoke(sessionID string, owner Owner) error {
	if !validCaller(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	s, err := m.live(sessionID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.heldBy(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	s.offerUntil = time.Time{}
	return nil
}

// THE CALLS THAT NAME A TERMINAL BY ITS ID.
//
// Who holds the terminal is read and what the call does is done in one step, under the session's lock (withHeld): a window
// that lost the terminal a moment ago (an offer that was used) is not let to type into it, resize it, credit its flow or read
// what it is doing after the window that took it has begun to, and a window that holds it is not told that it does not
// because the answer came in the other order. Input and resizes are ordered by the terminal's input queue, which takes
// them in under the lock (admission is the decision) and applies them later, in the order it took them in: the input of the
// window that claims the terminal follows what the window that gave it away had in line. The window is told what is told of
// an id that never was, whoever it is, whatever the call.

// withHeld runs act, under the session's lock, for the window that holds the session; any other caller is told what is told
// of an id that never was. A session that is ending is not found.
func (m *Manager) withHeld(sessionID string, owner Owner, act func(s *session) error) error {
	if !validCaller(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	s, err := m.live(sessionID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.heldBy(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	return act(s)
}

// admitHeld hands the operation to the input queue of the terminal, in the step that reads who holds it (withHeld).
func (m *Manager) admitHeld(sessionID string, owner Owner, o *op) error {
	return m.withHeld(sessionID, owner, func(s *session) error { return s.queue.admit(o) })
}

// WriteOwned applies input to a terminal for the window that holds it, and returns when it is applied (Write).
func (m *Manager) WriteOwned(sessionID string, owner Owner, seq uint64, data []byte) error {
	o := newOp(opWrite, seq)
	o.data = data
	if err := m.admitHeld(sessionID, owner, o); err != nil {
		return err
	}
	m.hookAfterAdmit(sessionID)
	return <-o.done
}

// ResizeOwned sets the size of a terminal for the window that holds it, in the order of its other input, and returns when it
// is applied (Resize).
func (m *Manager) ResizeOwned(sessionID string, owner Owner, seq uint64, rows, cols int) error {
	o := newOp(opResize, seq)
	err := m.withHeld(sessionID, owner, func(s *session) error {
		var sizeErr error
		if o.rows, o.cols, sizeErr = checkSize(rows, cols); sizeErr != nil {
			return sizeErr
		}
		return s.queue.admit(o)
	})
	if err != nil {
		return err
	}
	m.hookAfterAdmit(sessionID)
	return <-o.done
}

// AckOwned credits a terminal with the bytes the window that holds it took in (Ack). The last acknowledgement of a shell that
// ended races its CLOSE: a window that held a terminal that ended, and is remembered, is answered and credits nothing.
func (m *Manager) AckOwned(sessionID string, owner Owner, n int) error {
	if !validCaller(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	m.mu.RLock()
	s := m.sessions[sessionID]
	var heldEnded, remembered bool
	if s == nil {
		heldEnded = m.holdsEndedLocked(sessionID, owner)
		remembered = slices.ContainsFunc(m.ended, func(e endedSession) bool { return e.id == sessionID })
	}
	m.mu.RUnlock()
	if s == nil {
		if !heldEnded || !remembered {
			return apperror.SessionNotFound(sessionID)
		}
		return negativeAck(n)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.heldBy(owner) {
		return apperror.SessionNotFound(sessionID)
	}
	if err := negativeAck(n); err != nil {
		return err
	}
	if !s.ending.Load() {
		s.flow.ack(n)
	}
	return nil
}

// negativeAck is what a count of bytes below zero is told.
func negativeAck(n int) error {
	if n < 0 {
		return invalidError("bytes must not be negative.")
	}
	return nil
}

// BusyOwned says whether a program other than the shell holds the foreground of a terminal, to the window that holds it
// (Busy). The groups are read under the lock; the name of the program is not part of the decision.
func (m *Manager) BusyOwned(sessionID string, owner Owner) (Foreground, error) {
	var shell, group int
	var known bool
	err := m.withHeld(sessionID, owner, func(s *session) error {
		shell, group, known = s.groups()
		if s.ending.Load() {
			// The session ended while it was asked: the descriptor is closed, or about to be.
			return apperror.SessionNotFound(sessionID)
		}
		return nil
	})
	switch {
	case err != nil:
		return Foreground{}, err
	case !known:
		return UnknownForeground(ReasonQueryFailed), nil
	default:
		return foregroundOf(shell, group), nil
	}
}

// CwdOwned says which directory the shell of a terminal is in, to the window that holds it (Cwd).
func (m *Manager) CwdOwned(sessionID string, owner Owner) (Directory, error) {
	var out Directory
	err := m.withHeld(sessionID, owner, func(s *session) error {
		path, reason := s.directory()
		if s.ending.Load() {
			return apperror.SessionNotFound(sessionID)
		}
		out = Directory{Path: path, Reason: reason}
		return nil
	})
	return out, err
}

// GetOwned is the facts of a terminal, for the window that holds it (GetSession).
func (m *Manager) GetOwned(sessionID string, owner Owner) (*sdkexec.Session, error) {
	var out *sdkexec.Session
	err := m.withHeld(sessionID, owner, func(s *session) error {
		out = s.snapshotLocked()
		return nil
	})
	return out, err
}

// DetachOwned marks a terminal as not attached, for the window that holds it (DetachSession).
func (m *Manager) DetachOwned(sessionID string, owner Owner) (*sdkexec.Session, error) {
	var out *sdkexec.Session
	err := m.withHeld(sessionID, owner, func(s *session) error {
		s.attached = false
		out = s.snapshotLocked()
		return nil
	})
	if err == nil {
		m.log.Debugw(context.Background(), "session detached", "session", sessionID)
	}
	return out, err
}

// AttachOwned makes the window the holder of the terminal (it is, or its owner offered the terminal and the offer is open:
// Claim), marks the terminal as attached and returns its output, in one step (AttachSession). A terminal whose end is
// decided is not taken. The window that lost the terminal is told, after the lock is let go.
func (m *Manager) AttachOwned(sessionID string, owner Owner) (*sdkexec.Session, []byte, error) {
	if !validCaller(owner) {
		return nil, nil, apperror.SessionNotFound(sessionID)
	}
	s, err := m.live(sessionID)
	if err != nil {
		return nil, nil, err
	}
	s.mu.Lock()
	var replaced *Detachment
	switch {
	case s.heldBy(owner):
	case s.offerOpenLocked(m.clock.Now()) && !s.fate.set && !s.ending.Load():
		replaced = s.takeOverLocked(owner)
	default:
		s.mu.Unlock()
		return nil, nil, apperror.SessionNotFound(sessionID)
	}
	data := s.retained()
	s.flow.reset()
	s.attached = true
	out := s.snapshotLocked()
	s.mu.Unlock()
	m.told(s, replaced)
	m.log.Debugw(context.Background(), "session attached", "session", sessionID, "bufferSize", len(data))
	return out, data, nil
}
