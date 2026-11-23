//go:build !windows

package terminal

import (
	"cmp"
	"crypto/subtle"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// A terminal that has a page key outlives the page that opened it. When its window goes away it is DETACHED:
// its owner is gone, its reader is held (the shell blocks in its own write and the host buffers nothing), and a
// lease runs. A page that comes back lists the terminals of its key, attaches (the lease ends, the terminal
// belongs to the new window, the reader is let go), and is handed, in one step that is ordered with the
// output, the bytes it lacks. A lease that runs out ends the terminal as a close does. The lock order is
// Manager.mu, then the session's mu, then its outMu, then the flow's own.

// errEndingByItself says an attach found a terminal whose shell ended by itself: it is ending, and will leave
// its end for the page that is attaching.
var errEndingByItself = errors.New("the terminal is ending by itself")

// checkOwner refuses an owner that cannot be compared: the manager compares owners, and comparing two values
// that have no equality panics. The VALUE is asked, not its type: a struct with an interface field is a
// comparable type and panics when that field holds a slice.
func checkOwner(owner Owner) error {
	if owner != nil && !reflect.ValueOf(owner).Comparable() {
		return invalidError("the owner of a terminal must be comparable.")
	}
	return nil
}

// checkPageKey refuses a key that is too short to be a secret, or too long, or not made of visible ASCII.
func checkPageKey(key string) error {
	if key == "" {
		return nil
	}
	if len(key) < MinPageKeyBytes || len(key) > MaxPageKeyBytes {
		return invalidError(fmt.Sprintf("page_key must be %d to %d characters; got %d.", MinPageKeyBytes, MaxPageKeyBytes, len(key)))
	}
	for i := range len(key) {
		if c := key[i]; c <= ' ' || c > '~' {
			return invalidError("page_key must be visible ASCII characters, with no spaces.")
		}
	}
	return nil
}

// resolveKeep reads what keeps a terminal for its page: the key, and the lease, which is the default when the
// opener gave none. A terminal without a key has no lease. A lease without a key, one below zero and one over the
// most are refused, naming the field.
func resolveKeep(opts Options) (time.Duration, error) {
	if err := checkPageKey(opts.PageKey); err != nil {
		return 0, err
	}
	switch {
	case opts.LeaseMs < 0 || opts.LeaseMs > int(LeaseMax/time.Millisecond):
		return 0, invalidError(fmt.Sprintf("lease_ms must be from 0 to %d; got %d.", int(LeaseMax/time.Millisecond), opts.LeaseMs))
	case opts.PageKey == "" && opts.LeaseMs != 0:
		return 0, invalidError("lease_ms means something only with a page_key: a terminal without one ends with its window.")
	case opts.PageKey == "":
		return 0, nil
	case opts.LeaseMs == 0:
		return LeaseDefault, nil
	}
	return time.Duration(opts.LeaseMs) * time.Millisecond, nil
}

// leaseOf is the lease a detach asks for: the terminal's own when none is asked for, and never more than the
// most.
func leaseOf(own time.Duration, askedMs int) time.Duration {
	if askedMs <= 0 {
		return own
	}
	return min(LeaseMax, time.Duration(min(askedMs, int(LeaseMax/time.Millisecond)))*time.Millisecond)
}

// ---- the output ----

// record numbers a read of the shell's output: the offset it has is the number of bytes written before it. The
// offset, the replay ring and the credit counted for the read are one step under the output lock, so that an
// attach, which takes its snapshot under it, sees a read wholly or not at all.
func (s *session) record(data []byte) uint64 {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	offset := s.ring.end
	s.flow.sent(len(data))
	s.ring.write(data)
	return offset
}

// next is the offset of the next byte the shell will write: the length of its output so far.
func (s *session) next() uint64 {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	return s.ring.end
}

// retained is everything the ring keeps: what the legacy attach hands over.
func (s *session) retained() []byte {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	return s.ring.bytes()
}

// noteSize is told, by the pty device, of a size it applied, and logs it at the offset of the output written so
// far.
func (s *session) noteSize(rows, cols uint16) {
	s.outMu.Lock()
	defer s.outMu.Unlock()
	s.ring.noteSize(Size{Cols: int(cols), Rows: int(rows)})
}

// emit hands a read to the sink: with its offset when the terminal has a page key and the sink takes offsets,
// as it always was otherwise.
func (m *Manager) emit(s *session, offset uint64, data []byte) {
	if s.pageKey != "" && m.offsets != nil {
		m.offsets.OutputAt(s.id, offset, data)
		return
	}
	m.sink.Output(s.id, data)
}

// ---- who may act ----

// holdsKey reports whether key is the one the terminal was opened with. The key is the page's secret: the
// comparison takes the same time whatever the key says, and a terminal without a key is held by none.
func (s *session) holdsKey(key string) bool {
	return s.pageKey != "" && subtle.ConstantTimeCompare([]byte(s.pageKey), []byte(key)) == 1
}

// mayActLocked reports whether a caller may attach, detach or list the terminal: the key opens it, and so does
// the window that owns it. The caller holds s.mu.
func (s *session) mayActLocked(caller Owner, key string) bool {
	return s.holdsKey(key) || (caller != nil && s.owner != nil && s.owner == caller)
}

// ---- the lease ----

// detachLocked leaves the terminal waiting for a page for lease: its owner goes, its reader is held, and the
// lease runs. A terminal that is already detached stays as it is. It returns when the lease ends. The caller
// holds s.mu.
func (s *session) detachLocked(lease time.Duration) time.Time {
	if s.detached {
		return s.leaseEnd
	}
	s.detached = true
	s.attached = false
	s.owner = nil
	s.flow.hold()
	s.leaseGen++
	gen := s.leaseGen
	s.leaseLen = lease
	s.leaseEnd = time.Now().Add(lease)
	s.leaseTimer = time.AfterFunc(lease, func() { s.expire(gen) })
	return s.leaseEnd
}

// takeOverLocked makes owner the owner of the terminal: a lease that is running is over (the timer is
// stopped, and one that fires anyway finds its number is no longer the lease's). The caller holds s.mu.
func (s *session) takeOverLocked(owner Owner) {
	s.leaseGen++
	if s.leaseTimer != nil {
		s.leaseTimer.Stop()
		s.leaseTimer = nil
	}
	s.detached = false
	s.attached = true
	s.owner = owner
	s.leaseEnd = time.Time{}
	s.leaseLen = 0
}

// expire is what a lease that ran out does: end the terminal the way a close does, unless the lease is no longer
// the one that applies (a page attached, or the terminal is already ending). Whether it still applies and
// whether the terminal is ended are decided in one step under s.mu, so that an attach and an expiry that come
// together have exactly one winner.
func (s *session) expire(gen uint64) {
	s.mu.Lock()
	if gen != s.leaseGen || !s.detached || s.fate.set || s.ending.Load() {
		s.mu.Unlock()
		return
	}
	s.fate = fate{set: true, closedBy: ClosedByDetachTimeout, failure: nil}
	s.mu.Unlock()
	s.startClose()
}

// stopLease ends whatever lease is running, for good: the terminal is gone.
func (s *session) stopLease() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.leaseGen++
	if s.leaseTimer != nil {
		s.leaseTimer.Stop()
		s.leaseTimer = nil
	}
}

type releaseResult int

const (
	releaseNone releaseResult = iota
	releaseDetached
	releaseEnd
)

// release is what a window going away does to a terminal it owns: a terminal with a page key is detached, any
// other is to be ended.
func (s *session) release(owner Owner) releaseResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.owner == nil || s.owner != owner || s.fate.set || s.ending.Load() {
		return releaseNone
	}
	if s.pageKey == "" {
		return releaseEnd
	}
	s.detachLocked(s.lease)
	return releaseDetached
}

// ReleaseOwned is what a window going away does to its terminals: those that have a page key are detached and
// kept for their lease, any other is ended, with by as the reason. When it returns the ended ones are gone.
func (m *Manager) ReleaseOwned(owner Owner, by ClosedBy) Released {
	var done Released
	if owner == nil || checkOwner(owner) != nil {
		return done
	}
	var ending []*session
	for _, s := range m.sessionList() {
		switch s.release(owner) {
		case releaseDetached:
			done.Detached++
		case releaseEnd:
			s.beginClose(by)
			ending = append(ending, s)
			done.Ended++
		case releaseNone:
		}
	}
	m.awaitGone(ending)
	return done
}

// CloseUnlessTakenOver ends a terminal that a call failed to hand to owner's window (the window was retired
// while the call ran), unless another window took it over meanwhile: a terminal that belongs to another window
// stays as it is. One that still belongs to owner, or that is detached (the retirement of the failed window
// found it), is ended the way a close ends it. It says whether it ended the terminal. The ownership is read and
// the terminal is ended in one step under the session's lock, so that an attach that comes together with it has
// exactly one winner.
func (m *Manager) CloseUnlessTakenOver(sessionID string, owner Owner) bool {
	s, err := m.live(sessionID)
	if err != nil || checkOwner(owner) != nil {
		return false
	}
	s.mu.Lock()
	if (s.owner != nil && s.owner != owner) || s.fate.set || s.ending.Load() {
		s.mu.Unlock()
		return false
	}
	s.fate = fate{set: true, closedBy: ClosedByWindow, failure: nil}
	s.mu.Unlock()
	s.startClose()
	m.awaitGone([]*session{s})
	return true
}

func (m *Manager) sessionList() []*session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out
}

// Detach leaves a terminal waiting for a page for a lease, as a window going away does, without ending the
// window: the page says it is leaving. Zero is the terminal's own lease, and more than LeaseMax is cut to it;
// the answer says the lease that applies. A terminal that is detached stays as it is.
func (m *Manager) Detach(sessionID string, caller Owner, req DetachRequest) (Detached, error) {
	var none Detached
	if err := checkOwner(caller); err != nil {
		return none, err
	}
	if req.LeaseMs < 0 {
		return none, invalidError("lease_ms must not be negative.")
	}
	s, err := m.live(sessionID)
	if err != nil {
		return none, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case !s.mayActLocked(caller, req.PageKey):
		return none, apperror.SessionNotFound(sessionID)
	case s.pageKey == "":
		return none, notReattachableError(sessionID)
	case s.fate.set || s.ending.Load():
		return none, apperror.SessionNotFound(sessionID)
	}
	end := s.detachLocked(leaseOf(s.lease, req.LeaseMs))
	return Detached{LeaseMs: int(s.leaseLen / time.Millisecond), LeaseExpiresUnixMs: end.UnixMilli()}, nil
}

// ---- the attach ----

// Attach hands a page the terminal it left, in one step that is ordered with the output: the replay is exactly
// the bytes from the offset the page has (or from the start of what the host kept) to the end, the events that
// follow it continue at that end, with no byte lost and none repeated, and the terminal belongs to the caller
// from then on. Whoever has the key, or is the window that owns the terminal, may attach; any other is told
// what is told of a terminal that is not there.
func (m *Manager) Attach(sessionID string, caller Owner, req AttachRequest) (*Attached, error) {
	if err := checkOwner(caller); err != nil {
		return nil, err
	}
	s, tomb := m.find(sessionID)
	if s != nil {
		attached, err := s.attach(caller, req)
		if !errors.Is(err, errEndingByItself) {
			return attached, err
		}
		// The shell ended by itself: it leaves its end, and the page that is attaching is owed it.
		s.awaitDone(closeWait)
		_, tomb = m.find(sessionID)
	}
	if tomb == nil || !tomb.holdsKey(req.PageKey) {
		return nil, apperror.SessionNotFound(sessionID)
	}
	return tomb.attached(req.FromOffset)
}

func (s *session) attach(caller Owner, req AttachRequest) (*Attached, error) {
	view, err := s.takeOver(caller, req)
	if err != nil {
		return nil, err
	}
	// The directory and the foreground are read from the system, outside the locks.
	path, reason := s.directory()
	busy := UnknownForeground(ReasonQueryFailed)
	if shell, group, known := s.groups(); known {
		busy = foregroundOf(shell, group)
	}
	return &Attached{Session: s.info, Replay: view.replay(), Cwd: Directory{Path: path, Reason: reason}, Busy: busy, Ended: nil}, nil
}

// takeOver is the atomic part of an attach: under s.mu the caller is checked, the replay is taken under the
// output lock together with the reader's credit (what was in flight and the old client's acknowledgements are
// forgotten, and the hold is over), and the terminal is the caller's, with no lease running. Nothing is changed
// when anything is refused.
func (s *session) takeOver(caller Owner, req AttachRequest) (replayView, error) {
	var none replayView
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case !s.mayActLocked(caller, req.PageKey):
		return none, apperror.SessionNotFound(s.id)
	case s.pageKey == "":
		return none, notReattachableError(s.id)
	case s.fate.set || s.ending.Load():
		if s.fate.closedBy == "" {
			return none, errEndingByItself
		}
		return none, apperror.SessionNotFound(s.id)
	}
	s.outMu.Lock()
	view, err := s.ring.view(req.FromOffset)
	if err == nil {
		s.flow.restart()
	}
	s.outMu.Unlock()
	if err != nil {
		return none, err
	}
	s.takeOverLocked(caller)
	return view, nil
}

// awaitDone waits, for at most wait, for the session to be gone.
func (s *session) awaitDone(wait time.Duration) {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-s.done:
	case <-timer.C:
	}
}

// ---- the list ----

// List says which terminals a page may attach: those whose key it holds, and those its window owns. A terminal
// without a key is never listed, and the key never is. A terminal that ended by itself while no page was
// attached is listed with how it ended, for what is left of its lease.
func (m *Manager) List(caller Owner, key string) []Listed {
	if checkOwner(caller) != nil {
		caller = nil
	}
	m.mu.RLock()
	sessions := make([]*session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	tombs := slices.Clone(m.tombs)
	m.mu.RUnlock()

	out := make([]Listed, 0, len(sessions)+len(tombs))
	for _, s := range sessions {
		if listed, ok := s.listed(caller, key); ok {
			out = append(out, listed)
		}
	}
	now := time.Now()
	for _, t := range tombs {
		if t.holdsKey(key) && now.Before(t.until) {
			out = append(out, t.listed())
		}
	}
	slices.SortFunc(out, func(a, b Listed) int {
		return cmp.Or(a.CreatedAt.Compare(b.CreatedAt), strings.Compare(a.ID, b.ID))
	})
	return out
}

// listed is the terminal as a page sees it in a list; it says false for a terminal the caller may not see. A
// terminal that is ending because the host ended it is not listed; one whose shell ended by itself is, until its
// end is kept.
func (s *session) listed(caller Owner, key string) (Listed, bool) {
	var none Listed
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pageKey == "" || (s.fate.set && s.fate.closedBy != "") || !s.mayActLocked(caller, key) {
		return none, false
	}
	s.outMu.Lock()
	next, first, size := s.ring.end, s.ring.start(), s.ring.size(s.ring.end)
	s.outMu.Unlock()
	var expires int64
	if s.detached {
		expires = s.leaseEnd.UnixMilli()
	}
	return Listed{
		ID: s.id, CreatedAt: s.info.CreatedAt, PID: s.info.PID, Shell: s.info.Shell, Labels: nonNil(s.labels), Params: nonNil(s.params),
		Size: size, Attached: !s.detached, NextOffset: next, ReplayStart: first, LeaseExpiresUnixMs: expires, Ended: nil,
	}, true
}

// ---- what is left of a terminal that ended while no page was attached ----

// tombstone is the end of a terminal that has a page key and ended by itself, and what it wrote: the page that
// comes back reads how it ended, for what is left of the lease it was kept under.
type tombstone struct {
	id     string
	key    string
	info   Session
	labels map[string]string
	params map[string]string
	ring   *replayRing
	end    End
	until  time.Time
}

func (t *tombstone) holdsKey(key string) bool {
	return subtle.ConstantTimeCompare([]byte(t.key), []byte(key)) == 1
}

func (t *tombstone) attached(from *uint64) (*Attached, error) {
	view, err := t.ring.view(from)
	if err != nil {
		return nil, err
	}
	return &Attached{
		Session: t.info, Replay: view.replay(), Cwd: Directory{Path: "", Reason: ReasonEnded}, Busy: UnknownForeground(ReasonEnded), Ended: new(t.end),
	}, nil
}

func (t *tombstone) listed() Listed {
	return Listed{
		ID: t.id, CreatedAt: t.info.CreatedAt, PID: t.info.PID, Shell: t.info.Shell, Labels: nonNil(t.labels), Params: nonNil(t.params),
		Size: t.ring.size(t.ring.end), Attached: false, NextOffset: t.ring.end, ReplayStart: t.ring.start(),
		LeaseExpiresUnixMs: t.until.UnixMilli(), Ended: new(t.end),
	}
}

// keepTombstone remembers how a terminal ended, when a page may be waiting to read it: the terminal has a key and
// its shell ended by itself (a close of the host's has nothing to tell). The oldest tombstone goes when there
// are TombstoneLimit.
func (m *Manager) keepTombstone(s *session, end End) {
	if s.pageKey == "" || end.Reason == EndClosed {
		return
	}
	s.outMu.Lock()
	frozen := s.ring.freeze()
	s.outMu.Unlock()
	now := time.Now()
	t := &tombstone{
		id: s.id, key: s.pageKey, info: s.info, labels: s.labels, params: s.params, ring: frozen, end: end, until: s.tombstoneDeadline(now),
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneTombstonesLocked(now)
	m.tombs = append(m.tombs, t)
	if len(m.tombs) > TombstoneLimit {
		m.tombs = slices.Delete(m.tombs, 0, len(m.tombs)-TombstoneLimit)
	}
}

// tombstoneDeadline is when the tombstone of the terminal is forgotten: the end of the lease in effect when it
// ended, which is the lease a page detached it with when it was detached, and the terminal's own lease from now
// when it was attached.
func (s *session) tombstoneDeadline(now time.Time) time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.detached {
		return s.leaseEnd
	}
	return now.Add(s.lease)
}

// pruneTombstonesLocked forgets the tombstones whose lease has passed. The caller holds m.mu.
func (m *Manager) pruneTombstonesLocked(now time.Time) {
	m.tombs = slices.DeleteFunc(m.tombs, func(t *tombstone) bool { return !now.Before(t.until) })
}

// find is the session of an id, or the tombstone of one that ended and is kept.
func (m *Manager) find(id string) (*session, *tombstone) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if s := m.sessions[id]; s != nil {
		return s, nil
	}
	now := time.Now()
	for _, t := range m.tombs {
		if t.id == id && now.Before(t.until) {
			return nil, t
		}
	}
	return nil, nil
}

// dropTombstone forgets a tombstone, and says whether there was one.
func (m *Manager) dropTombstone(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.dropTombstoneLocked(id)
}

// dropTombstoneLocked is dropTombstone for a caller that holds m.mu.
func (m *Manager) dropTombstoneLocked(id string) bool {
	before := len(m.tombs)
	m.tombs = slices.DeleteFunc(m.tombs, func(t *tombstone) bool { return t.id == id })
	return len(m.tombs) != before
}
